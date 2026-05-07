import { NextResponse } from "next/server";
import { getSessionUser } from "../shared";
import { getSentCopyBinding } from "../../../lib/db";

export async function GET() {
  const user = await getSessionUser();
  const sentCopyBinding = await getSentCopyBinding(user.email);
  return NextResponse.json({
    email: user.email,
    smtp_password: user.smtp_password,
    smtp_host: process.env.SMTP_HOST,
    smtp_port: Number(process.env.SMTP_PORT ?? 587),
    sent_copy_gmail1_email: sentCopyBinding?.gmail1_email ?? null,
  });
}
