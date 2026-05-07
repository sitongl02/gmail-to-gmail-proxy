import { NextResponse } from "next/server";
import { getSessionUser } from "../shared";

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({
    email: user.email,
    smtp_password: user.smtp_password,
    smtp_host: process.env.SMTP_HOST,
    smtp_port: Number(process.env.SMTP_PORT ?? 587),
  });
}
