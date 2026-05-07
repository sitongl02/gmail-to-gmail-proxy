import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import {
  exchangeForCredentials,
  getApp,
  getAuthorizationUrl,
} from "../../lib/google";
import qs from "node:querystring";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { SessionData } from "../../lib/state";
import { onNewLogin } from "../../lib/hooks";

function getCallbackUrl(req: NextRequest) {
  const host = req.headers.get("host") ?? "localhost";
  const protocol = host.includes("localhost") ? "http" : "https";
  const callbackUrl = new URL("/auth", `${protocol}://${host}`).toString();
  return callbackUrl;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    return finishAuth(req, code);
  }

  const redirectUrl = getAuthorizationUrl(getCallbackUrl(req), getApp());
  return NextResponse.redirect(redirectUrl);
}

export async function POST(req: NextRequest) {
  const body = qs.parse(await req.text()) as {
    code: string;
    state: string;
  };
  return finishAuth(req, body.code);
}

async function finishAuth(req: NextRequest, code: string) {
  let success = false;
  try {
    const session = await getIronSession<SessionData>(await cookies(), {
      password: process.env.SESSION_SECRET!,
      cookieName: process.env.SESSION_COOKIE!,
    });
    const { email } = await exchangeForCredentials(
      getCallbackUrl(req),
      code,
      getApp()
    );
    session.email = email;
    await session.save();
    await onNewLogin(email);
    success = true;
  } catch (err) {
    console.error("OAuth callback failed", err);
  }
  // it's crazy but for some reason redirects are treated as errors!
  // https://nextjs.org/docs/app/building-your-application/routing/redirecting#redirects-in-nextconfigjs
  return redirect(success ? "/configuration" : "/");
}
