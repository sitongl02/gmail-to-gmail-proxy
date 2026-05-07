import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type MailLogStatus =
  | "received"
  | "sent"
  | "failed"
  | "duplicate_skipped";

export type CreateMailLogInput = {
  user_email: string;
  smtp_username: string;
  mail_from?: string;
  rcpt_to: string[];
  message_id?: string;
  raw_mime: string;
  raw_mime_base64: string;
  size_bytes: number;
};

export type UpdateMailLogInput = {
  status: MailLogStatus;
  gmail_response?: unknown;
  error?: string;
};

type MailLogRecord = CreateMailLogInput & {
  id: string;
  created_at: string;
  updated_at: string;
  status: MailLogStatus;
  gmail_response?: unknown;
  error?: string;
};

export async function createMailLog(input: CreateMailLogInput) {
  const now = new Date();
  const id = `${formatDateForFile(now)}-${crypto.randomUUID()}`;
  const filePath = await getLogPath(now, id);
  const record: MailLogRecord = {
    id,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    status: "received",
    ...input,
  };
  await writeJson(filePath, record);
  return filePath;
}

export async function updateMailLog(
  filePath: string,
  input: UpdateMailLogInput
) {
  const existing = JSON.parse(await fs.readFile(filePath, "utf8"));
  const updated: MailLogRecord = {
    ...existing,
    status: input.status,
    updated_at: new Date().toISOString(),
    gmail_response: input.gmail_response,
    error: input.error,
  };
  await writeJson(filePath, updated);
}

function getLogRoot() {
  return process.env.MAIL_LOG_DIR ?? path.join(process.cwd(), "data", "mail-logs");
}

async function getLogPath(date: Date, id: string) {
  const dir = path.join(getLogRoot(), formatDateForDir(date));
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${id}.json`);
}

async function writeJson(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(tempPath, filePath);
}

function formatDateForDir(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateForFile(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
