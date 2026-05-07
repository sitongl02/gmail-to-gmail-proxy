import qs from "node:querystring";
import rp from "request-promise-native";
import { getUser, upsert } from "./db";
import crypto from "node:crypto";
import { throatNamespace } from "./throat";
import _ from "lodash";

type GoogleAppRegistration = { id: string; secret: string };

export type GoogleOAuthCredentials = {
  token_type: string;
  scope: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires: number;
};

type GoogleIdTokenClaims = {
  aud?: string | string[];
  email?: string;
  email_verified?: boolean | string;
  exp?: number;
};

type GoogleUserInfo = {
  email?: string;
  email_verified?: boolean | string;
};

const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
];
let appsArray: GoogleAppRegistration[] | undefined;
let apps: Record<string, GoogleAppRegistration> | undefined;

export function getApp(id?: string) {
  const configuredApps = getApps();
  const clientDefaultId =
    process.env.GOOGLE_APPS_DEFAULT_ID ?? getAppsArray()[0].id;
  const appId = id ?? clientDefaultId;
  if (!configuredApps[appId]) {
    throw new Error(`No client found for ${appId}.`);
  }
  return configuredApps[appId];
}

function getAppsArray(): GoogleAppRegistration[] {
  if (!appsArray) {
    if (!process.env.GOOGLE_APPS) {
      throw new Error("GOOGLE_APPS is not configured.");
    }
    const parsedApps: GoogleAppRegistration[] = JSON.parse(
      process.env.GOOGLE_APPS
    );
    if (!parsedApps.length) {
      throw new Error("GOOGLE_APPS must contain at least one OAuth client.");
    }
    appsArray = parsedApps;
  }
  return appsArray!;
}

function getApps(): Record<string, GoogleAppRegistration> {
  if (!apps) {
    apps = _.keyBy(getAppsArray(), "id");
  }
  return apps!;
}

export const getCredentials = throatNamespace(
  1,
  async (email: string, app: GoogleAppRegistration) => {
    const user = await getUser(email);
    const token = user?.token;
    if (!token) {
      throw new Error(`No token found for ${email}.`);
    }
    const credentials: GoogleOAuthCredentials = token;
    if (credentials.expires < Date.now() + 5 * 60 * 1000) {
      return refreshCredentials(email, credentials, app);
    }
    return credentials;
  }
);

export function getAuthorizationUrl(
  redirectUrl: string,
  app: GoogleAppRegistration
) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs.stringify({
    client_id: app.id,
    response_type: "code",
    redirect_uri: redirectUrl,
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state: JSON.stringify({}),
  })}`;
}

export async function exchangeForCredentials(
  redirectUrl: string,
  code: string,
  app: GoogleAppRegistration
) {
  const credentials: GoogleOAuthCredentials = await rp.post(
    "https://oauth2.googleapis.com/token",
    {
      form: {
        client_id: app.id,
        code,
        redirect_uri: redirectUrl,
        grant_type: "authorization_code",
        client_secret: app.secret,
      },
      json: true,
    }
  );
  credentials.expires = Date.now() + credentials.expires_in * 1000;
  const { email } = await setCredentials(credentials, app);
  return { email, credentials };
}

async function refreshCredentials(
  email: string,
  credentials: GoogleOAuthCredentials,
  app: GoogleAppRegistration
) {
  const token: GoogleOAuthCredentials = await rp.post(
    "https://oauth2.googleapis.com/token",
    {
      form: {
        client_id: app.id,
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
        client_secret: app.secret,
      },
      json: true,
    }
  );
  token.expires = Date.now() + token.expires_in * 1000;
  token.refresh_token = token.refresh_token ?? credentials.refresh_token;
  token.id_token = token.id_token ?? credentials.id_token;
  await setCredentials(token, app, email);
  return token;
}

export async function setCredentials(
  credentials: GoogleOAuthCredentials,
  app: GoogleAppRegistration,
  emailOverride?: string
) {
  const email = emailOverride ?? (await getEmail(credentials, app));
  await upsert(
    "Tokens",
    [
      {
        email,
        token: JSON.stringify(credentials),
        smtp_password: crypto.randomBytes(16).toString("hex"),
        updated_at: new Date().toISOString(),
        app_id: app.id,
      },
    ],
    { ignoreIfSetFields: ["smtp_password"] }
  );
  return {
    email,
    credentials,
  };
}

export async function sendGmailMessage(
  credentials: GoogleOAuthCredentials,
  raw: Buffer
) {
  return rp.post(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
      },
      body: {
        raw: toBase64Url(raw),
      },
      json: true,
    }
  );
}

async function getEmail(
  credentials: GoogleOAuthCredentials,
  app: GoogleAppRegistration
) {
  if (credentials.id_token) {
    const claims = parseIdToken(credentials.id_token);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const isExpired = claims.exp && claims.exp * 1000 <= Date.now();
    if (audiences.includes(app.id) && claims.email && !isExpired) {
      return claims.email;
    }
  }

  const userInfo: GoogleUserInfo = await rp.get(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
      },
      json: true,
    }
  );
  if (!userInfo.email) {
    throw new Error("Google account email was not returned.");
  }
  return userInfo.email;
}

function parseIdToken(idToken: string): GoogleIdTokenClaims {
  const [, payload] = idToken.split(".");
  if (!payload) {
    throw new Error("Invalid Google ID token.");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function toBase64Url(raw: Buffer) {
  return raw
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
