import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type MailLogStatus =
  | "received"
  | "sent"
  | "failed"
  | "duplicate_skipped"
  | "merged_into_send";

export type SentCopyStatus = "not_configured" | "appended" | "failed";

export type CreateMailLogInput = {
  user_email: string;
  smtp_username: string;
  mail_from?: string;
  rcpt_to: string[];
  message_id?: string;
  raw_mime: string;
  raw_mime_base64: string;
  gmail_send_bcc_added?: string[];
  gmail_send_raw_mime?: string;
  gmail_send_raw_mime_base64?: string;
  size_bytes: number;
};

export type UpdateMailLogInput = {
  status?: MailLogStatus;
  gmail_response?: unknown;
  gmail_sent_message_id?: string;
  gmail_send_bcc_added?: string[];
  gmail_send_envelope_recipients?: string[];
  gmail_send_raw_mime?: string;
  gmail_send_raw_mime_base64?: string;
  merged_into_mail_log?: string;
  duplicate_reason?: string;
  sent_raw_message_id?: string;
  sent_raw_mime?: string;
  sent_raw_mime_base64?: string;
  sent_copy_gmail1_email?: string;
  sent_copy_status?: SentCopyStatus;
  sent_copy_mailbox?: string;
  sent_copy_append_response?: unknown;
  sent_copy_delete_status?: string;
  sent_copy_delete_message_id?: string;
  sent_copy_delete_gmail_message_ids?: string[];
  sent_copy_delete_matched_uids?: number[];
  sent_copy_delete_deleted_count?: number;
  sent_copy_delete_responses?: unknown[];
  sent_copy_delete_error?: string;
  sent_copy_delete_skipped_reason?: string;
  sent_copy_error?: string;
  error?: string;
};

type MailLogRecord = CreateMailLogInput & {
  id: string;
  created_at: string;
  updated_at: string;
  status: MailLogStatus;
  gmail_response?: unknown;
  gmail_sent_message_id?: string;
  gmail_send_bcc_added?: string[];
  gmail_send_envelope_recipients?: string[];
  gmail_send_raw_mime?: string;
  gmail_send_raw_mime_base64?: string;
  merged_into_mail_log?: string;
  duplicate_reason?: string;
  sent_raw_message_id?: string;
  sent_raw_mime?: string;
  sent_raw_mime_base64?: string;
  sent_copy_gmail1_email?: string;
  sent_copy_status?: SentCopyStatus;
  sent_copy_mailbox?: string;
  sent_copy_append_response?: unknown;
  sent_copy_delete_status?: string;
  sent_copy_delete_message_id?: string;
  sent_copy_delete_gmail_message_ids?: string[];
  sent_copy_delete_matched_uids?: number[];
  sent_copy_delete_deleted_count?: number;
  sent_copy_delete_responses?: unknown[];
  sent_copy_delete_error?: string;
  sent_copy_delete_skipped_reason?: string;
  sent_copy_error?: string;
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
  const updated: MailLogRecord = dropUndefined({
    ...existing,
    ...input,
    updated_at: new Date().toISOString(),
  });
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
  await fs.writeFile(
    tempPath,
    `${JSON.stringify(value, jsonReplacer, 2)}\n`,
    {
      mode: 0o600,
    }
  );
  await fs.rename(tempPath, filePath);
}

function dropUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

function formatDateForDir(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateForFile(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
