import { ImapFlow, type AppendResponseObject, type ListResponse } from "imapflow";

export type AppendToGmailSentInput = {
  email: string;
  accessToken: string;
  raw: Buffer;
};

export type AppendToGmailSentResult = {
  mailbox: string;
  response: AppendResponseObject;
};

export async function appendToGmailSent({
  email,
  accessToken,
  raw,
}: AppendToGmailSentInput): Promise<AppendToGmailSentResult> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: email,
      accessToken,
    },
    logger: false,
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    const mailboxes = await client.list();
    const mailbox = findSentMailbox(mailboxes);
    await client.mailboxOpen(mailbox);
    const response = await client.append(mailbox, raw, ["\\Seen"]);
    if (!response) {
      throw new Error("IMAP APPEND did not return a success response.");
    }
    return {
      mailbox,
      response,
    };
  } finally {
    if (connected) {
      await client.logout().catch(() => client.close());
    } else {
      client.close();
    }
  }
}

function findSentMailbox(mailboxes: ListResponse[]) {
  const sentBySpecialUse = mailboxes.find(
    (mailbox) =>
      mailbox.specialUse === "\\Sent" || mailbox.flags?.has("\\Sent")
  );
  if (sentBySpecialUse) {
    return sentBySpecialUse.path;
  }

  const sentByName = mailboxes.find((mailbox) =>
    /(^|[/\\])sent( mail)?$/i.test(mailbox.path)
  );
  if (sentByName) {
    return sentByName.path;
  }

  const gmailSent = mailboxes.find((mailbox) =>
    /^\[gmail\][./]sent mail$/i.test(mailbox.path)
  );
  if (gmailSent) {
    return gmailSent.path;
  }

  throw new Error("Could not find Gmail Sent Mail mailbox via IMAP LIST.");
}
