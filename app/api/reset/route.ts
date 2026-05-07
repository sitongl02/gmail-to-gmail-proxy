import { updateUserSmtpPassword } from "../../../lib/db";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSessionUser } from "../shared";
import { getSentCopyBinding } from "../../../lib/db";

export async function POST() {
  const user = await getSessionUser();
  const updatedUser = await updateUserSmtpPassword(
    user.email,
    crypto.randomBytes(16).toString("hex")
  );
  const sentCopyBinding = await getSentCopyBinding(user.email);
  return NextResponse.json({
    email: updatedUser?.email,
    smtp_password: updatedUser?.smtp_password,
    smtp_host: process.env.SMTP_HOST,
    smtp_port: Number(process.env.SMTP_PORT ?? 587),
    sent_copy_gmail1_email: sentCopyBinding?.gmail1_email ?? null,
  });
}
