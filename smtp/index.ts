import "source-map-support/register.js";
import "localenv";
import Server from "smtp-server";
import {
  getApp,
  getCredentials,
  GoogleOAuthCredentials,
  sendGmailMessage,
} from "../lib/google.js";
import fs from "node:fs";
import { getUser, User } from "../lib/db.js";
import { onMailForwarded } from "../lib/hooks.js";
import Cache from "node-cache";
import { createMailLog, updateMailLog } from "../lib/mail-log.js";

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
          const messageId = rawMime.match(/^Message-ID: (.*)$/im)?.[1];
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
          await updateMailLog(mailLogPath, {
            status: "sent",
            gmail_response: gmailResponse,
          });
          onMailForwarded(sessionUser.user.email, msg);
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
