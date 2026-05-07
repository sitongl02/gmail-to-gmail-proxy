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
import { addEnvelopeOnlyRecipientsAsBcc } from "../lib/envelope-bcc.js";

type SessionUser = {
  user: User;
  credentials: GoogleOAuthCredentials;
  smtpUsername: string;
};

type PendingSendEntry = {
  mailLogPath: string;
  raw: Buffer;
  messageId: string;
  sessionUser: SessionUser;
  envelopeRecipients: string[];
};

type PendingSend = {
  messageId: string;
  entries: PendingSendEntry[];
  envelopeRecipients: Set<string>;
  timer?: NodeJS.Timeout;
  resolve: () => void;
  reject: (err: unknown) => void;
  promise: Promise<void>;
  flushing: boolean;
};

type SentCacheValue = {
  primaryMailLogPath: string;
  envelopeRecipients: string[];
  gmailResponse: unknown;
};

const cert =
  process.env.SMTP_KEY_FILE && process.env.SMTP_CERT_FILE
    ? {
        key: fs.readFileSync(process.env.SMTP_KEY_FILE),
        cert: fs.readFileSync(process.env.SMTP_CERT_FILE),
      }
    : {};

const sentCache = new Cache({ stdTTL: 60, checkperiod: 60 });
const pendingSends = new Map<string, PendingSend>();
const aggregationDelayMs = Number(
  process.env.SMTP_SEND_AGGREGATION_MS ?? 2000
);

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
          const envelopeRecipients = session.envelope.rcptTo.map(
            (recipient) => recipient.address
          );
          // unfortunately, gmail seems to send the same message multiple times when sending to multiple recipients so we must dedupe
          const messageId = extractMessageId(rawMime);
          const sessionUser = session.user as any as SessionUser;
          mailLogPath = await createMailLog({
            user_email: sessionUser.user.email,
            smtp_username: sessionUser.smtpUsername,
            mail_from: getEnvelopeAddress(session.envelope.mailFrom),
            rcpt_to: envelopeRecipients,
            message_id: messageId,
            raw_mime: rawMime,
            raw_mime_base64: msg,
            size_bytes: raw.length,
          });
          if (messageId) {
            await sendAggregatedMessage({
              mailLogPath,
              raw,
              messageId,
              sessionUser,
              envelopeRecipients,
            });
          } else {
            await sendSingleMessage(
              mailLogPath,
              sessionUser,
              raw,
              envelopeRecipients,
              messageId
            );
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

async function sendSingleMessage(
  mailLogPath: string,
  sessionUser: SessionUser,
  raw: Buffer,
  envelopeRecipients: string[],
  messageId?: string
) {
  const gmailSend = addEnvelopeOnlyRecipientsAsBcc(raw, envelopeRecipients);
  const gmailSendMsg = gmailSend.raw.toString("base64");
  const gmailResponse = await sendGmailMessage(
    sessionUser.credentials,
    gmailSend.raw
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
      gmail_send_bcc_added: gmailSend.addedBcc,
      gmail_send_envelope_recipients: envelopeRecipients,
      gmail_send_raw_mime: gmailSend.addedBcc.length
        ? gmailSend.raw.toString("utf8")
        : undefined,
      gmail_send_raw_mime_base64: gmailSend.addedBcc.length
        ? gmailSendMsg
        : undefined,
      ...sentCopyLogFields,
    });
  } catch (logErr) {
    console.error("Failed to update sent mail log", logErr);
  }
  try {
    onMailForwarded(sessionUser.user.email, gmailSendMsg);
  } catch (hookErr) {
    console.error("Mail forwarded hook failed", hookErr);
  }
  return gmailResponse;
}

async function sendAggregatedMessage(entry: PendingSendEntry) {
  const cached = sentCache.get<SentCacheValue>(entry.messageId);
  if (cached) {
    await updateMailLog(entry.mailLogPath, {
      status: "duplicate_skipped",
      duplicate_reason: "message_id_already_sent",
      merged_into_mail_log: cached.primaryMailLogPath,
      gmail_response: cached.gmailResponse,
      gmail_send_envelope_recipients: cached.envelopeRecipients,
    });
    return;
  }

  let pending = pendingSends.get(entry.messageId);
  if (!pending) {
    pending = createPendingSend(entry.messageId);
    pendingSends.set(entry.messageId, pending);
  }

  if (pending.flushing) {
    await pending.promise;
    const cachedAfterFlush = sentCache.get<SentCacheValue>(entry.messageId);
    await updateMailLog(entry.mailLogPath, {
      status: "duplicate_skipped",
      duplicate_reason: "message_id_send_already_flushing",
      merged_into_mail_log: cachedAfterFlush?.primaryMailLogPath,
      gmail_response: cachedAfterFlush?.gmailResponse,
      gmail_send_envelope_recipients: cachedAfterFlush?.envelopeRecipients,
    });
    return;
  }

  pending.entries.push(entry);
  for (const recipient of entry.envelopeRecipients) {
    pending.envelopeRecipients.add(recipient);
  }
  schedulePendingSend(pending);
  await pending.promise;
}

function createPendingSend(messageId: string): PendingSend {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    messageId,
    entries: [],
    envelopeRecipients: new Set(),
    resolve,
    reject,
    promise,
    flushing: false,
  };
}

function schedulePendingSend(pending: PendingSend) {
  if (pending.timer) {
    clearTimeout(pending.timer);
  }
  pending.timer = setTimeout(() => {
    flushPendingSend(pending).catch((err) => pending.reject(err));
  }, aggregationDelayMs);
  pending.timer.unref();
}

async function flushPendingSend(pending: PendingSend) {
  pending.flushing = true;
  const [primary, ...merged] = pending.entries;
  if (!primary) {
    pending.resolve();
    pendingSends.delete(pending.messageId);
    return;
  }

  try {
    const envelopeRecipients = [...pending.envelopeRecipients];
    const gmailResponse = await sendSingleMessage(
      primary.mailLogPath,
      primary.sessionUser,
      primary.raw,
      envelopeRecipients,
      primary.messageId
    );
    sentCache.set(pending.messageId, {
      primaryMailLogPath: primary.mailLogPath,
      envelopeRecipients,
      gmailResponse,
    });
    await Promise.all(
      merged.map((entry) =>
        updateMailLog(entry.mailLogPath, {
          status: "merged_into_send",
          merged_into_mail_log: primary.mailLogPath,
          gmail_response: gmailResponse,
          gmail_send_envelope_recipients: envelopeRecipients,
        })
      )
    );
    pending.resolve();
  } catch (err) {
    pending.reject(err);
  } finally {
    pendingSends.delete(pending.messageId);
  }
}

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
    sentCache.close();
    for (const pending of pendingSends.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    }
    server.close(() => {
      console.log("SMTP server exiting");
      process.exit(0);
    });
  });
});
