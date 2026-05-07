import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import {
  exchangeForGmail1Credentials,
  getApp,
  getGmail1AuthorizationUrl,
} from "../../../lib/google";
import qs from "node:querystring";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { SessionData } from "../../../lib/state";
import { getUser, setSentCopyBinding } from "../../../lib/db";

function getCallbackUrl(req: NextRequest) {
  const host = req.headers.get("host") ?? "localhost";
  const protocol = host.includes("localhost") ? "http" : "https";
  return new URL("/auth/gmail1", `${protocol}://${host}`).toString();
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    return finishAuth(req, code);
  }

  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return redirect("/");
  }

  const redirectUrl = getGmail1AuthorizationUrl(
    getCallbackUrl(req),
    getApp(sessionUser.app_id)
  );
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
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      throw new Error("No Gmail2 session found for Gmail1 binding.");
    }

    const { email: gmail1Email } = await exchangeForGmail1Credentials(
      getCallbackUrl(req),
      code,
      getApp(sessionUser.app_id)
    );
    await setSentCopyBinding(sessionUser.email, gmail1Email);
    success = true;
  } catch (err) {
    console.error("Gmail1 OAuth callback failed", err);
  }
  return redirect(
    success ? "/configuration?gmail1=connected" : "/configuration?gmail1=failed"
  );
}

async function getSessionUser() {
  const session = await getIronSession<SessionData>(await cookies(), {
    password: process.env.SESSION_SECRET!,
    cookieName: process.env.SESSION_COOKIE!,
  });
  if (!session?.email) {
    return undefined;
  }
  return getUser(session.email);
}
