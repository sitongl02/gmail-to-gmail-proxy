import "source-map-support/register.js";
import "localenv";
import Server from "smtp-server";
import {
  getApp,
  getCredentials,
  getGmail1Credentials,
  getGmailMessageRaw,
  GoogleOAuthCredentials,
  sendGmailMessage,
  trashGmailMessagesByRfc822MessageId,
} from "../lib/google.js";
import fs from "node:fs";
import { getSentCopyBinding, getUser, User } from "../lib/db.js";
import { onMailForwarded } from "../lib/hooks.js";
import Cache from "node-cache";
import {
  createMailLog,
  type UpdateMailLogInput,
  updateMailLog,
} from "../lib/mail-log.js";
import { appendToGmailSent } from "../lib/gmail-imap.js";

type SessionUser = {
  user: User;
  credentials: GoogleOAuthCredentials;
  smtpUsername: string;
};

const cert =
  process.env.SMTP_KEY_FILE && process.env.SMTP_CERT_FILE
    ? {
        key: fs.readFileSync(process.env.SMTP_KEY_FILE),
        cert: fs.readFileSync(process.env.SMTP_CERT_FILE),
      }
    : {};

const cache = new Cache({ stdTTL: 60, checkperiod: 60 });

const server = new Server.SMTPServer({
  authMethods: ["PLAIN", "LOGIN"],
  onConnect(session, callback) {
    return callback();
  },
  ...cert,
  async onAuth(auth, session, callback) {
    try {
      const user = await getUser(auth.username);
      if (!user || user.smtp_password !== auth.password) {
        throw new Error("Invalid username or password.");
      }
      const credentials = await getCredentials(
        user.email,
        user.email,
        getApp(user.app_id)
      );
      callback(null, {
        user: {
          user,
          credentials,
          smtpUsername: auth.username,
        } as SessionUser,
      });
    } catch (err) {
      callback(new Error("Invalid username or password."));
    }
  },
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    let mailLogPath: string | undefined;
    stream
      .on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      })
      .on("error", (err) => callback(err))
      .on("end", async () => {
        try {
          const raw = Buffer.concat(chunks);
          const msg = raw.toString("base64");
          const rawMime = raw.toString("utf8");
          // unfortunately, gmail seems to send the same message multiple times when sending to multiple recipients so we must dedupe
          const messageId = extractMessageId(rawMime);
          const sessionUser = session.user as any as SessionUser;
          mailLogPath = await createMailLog({
            user_email: sessionUser.user.email,
            smtp_username: sessionUser.smtpUsername,
            mail_from: getEnvelopeAddress(session.envelope.mailFrom),
            rcpt_to: session.envelope.rcptTo.map(
              (recipient) => recipient.address
            ),
            message_id: messageId,
            raw_mime: rawMime,
            raw_mime_base64: msg,
            size_bytes: raw.length,
          });
          if (messageId) {
            if (cache.get(messageId)) {
              await updateMailLog(mailLogPath, {
                status: "duplicate_skipped",
              });
              return callback();
            }
            cache.set(messageId, true);
          }
          const gmailResponse = await sendGmailMessage(
            sessionUser.credentials,
            raw
          );
          const sentCopyLogFields = await getSentCopyLogFields(
            sessionUser,
            gmailResponse,
            messageId
          );
          try {
            await updateMailLog(mailLogPath, {
              status: "sent",
              gmail_response: gmailResponse,
              ...sentCopyLogFields,
            });
          } catch (logErr) {
            console.error("Failed to update sent mail log", logErr);
          }
          try {
            onMailForwarded(sessionUser.user.email, msg);
          } catch (hookErr) {
            console.error("Mail forwarded hook failed", hookErr);
          }
          callback();
        } catch (err: any) {
          if (mailLogPath) {
            try {
              await updateMailLog(mailLogPath, {
                status: "failed",
                error: serializeError(err),
              });
            } catch (logErr) {
              console.error("Failed to update mail log", logErr);
            }
          }
          callback(err);
        }
      });
  },
}).on("error", (err) => {
  // prevent unhandled error from crashing the server
  console.log(err);
});

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function getEnvelopeAddress(address: false | { address: string }) {
  return address ? address.address : undefined;
}

async function getSentCopyLogFields(
  sessionUser: SessionUser,
  gmailResponse: { id?: string },
  originalMessageId?: string
): Promise<UpdateMailLogInput> {
  const fields: UpdateMailLogInput = {};
  try {
    if (!gmailResponse.id) {
      throw new Error("Gmail API send response did not include message id.");
    }

    fields.gmail_sent_message_id = gmailResponse.id;
    const sentRaw = await getGmailMessageRaw(
      sessionUser.credentials,
      gmailResponse.id
    );
    const sentRawMime = sentRaw.toString("utf8");
    fields.sent_raw_mime = sentRawMime;
    fields.sent_raw_mime_base64 = sentRaw.toString("base64");
    fields.sent_raw_message_id = extractMessageId(sentRawMime);

    const binding = await getSentCopyBinding(sessionUser.user.email);
    if (!binding) {
      fields.sent_copy_status = "not_configured";
      return fields;
    }

    fields.sent_copy_gmail1_email = binding.gmail1_email;
    const gmail1Credentials = await getGmail1Credentials(
      binding.gmail1_email,
      binding.gmail1_email,
      getApp(binding.gmail1.app_id)
    );
    const appendResult = await appendToGmailSent({
      email: binding.gmail1_email,
      accessToken: gmail1Credentials.access_token,
      raw: sentRaw,
    });
    fields.sent_copy_status = "appended";
    fields.sent_copy_mailbox = appendResult.mailbox;
    fields.sent_copy_append_response = appendResult.response;
    const deleteResult = await trashGmailMessagesByRfc822MessageId(
      gmail1Credentials,
      originalMessageId
    );
    fields.sent_copy_delete_status = deleteResult.status;
    fields.sent_copy_delete_message_id = deleteResult.rfc822_message_id;
    fields.sent_copy_delete_gmail_message_ids = deleteResult.gmail_message_ids;
    fields.sent_copy_delete_deleted_count = deleteResult.trashed_count;
    fields.sent_copy_delete_responses = deleteResult.responses;
    fields.sent_copy_delete_error = deleteResult.error;
    fields.sent_copy_delete_skipped_reason = deleteResult.skipped_reason;
    return fields;
  } catch (err) {
    return {
      ...fields,
      sent_copy_status: "failed",
      sent_copy_error: serializeError(err),
    };
  }
}

function extractMessageId(rawMime: string) {
  return rawMime.match(/^Message-ID:\s*(.*)$/im)?.[1]?.trim();
}

const port = Number(process.env.SMTP_PORT ?? 587);
server.listen(port, () => {
  console.log(`SMTP server listening on port ${port}`);
  process.on("SIGINT", () => {
    console.log("SMTP server shutting down");
    cache.close();
    server.close(() => {
      console.log("SMTP server exiting");
      process.exit(0);
    });
  });
});
