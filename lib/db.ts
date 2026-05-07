import type { Database } from "sqlite";
import _ from "lodash";
import type { GoogleOAuthCredentials } from "./google";

export type Connection = Database;

let db: Connection | undefined;

export type User = {
  email: string;
  token: GoogleOAuthCredentials;
  smtp_password: string;
  app_id: string;
};

export type Gmail1Account = {
  email: string;
  token: GoogleOAuthCredentials;
  app_id: string;
};

export type SentCopyBinding = {
  gmail2_email: string;
  gmail1_email: string;
  gmail1: Gmail1Account;
};

export async function getDb() {
  if (!db) {
    const filename = process.env.SQLITE_PATH!;
    const sqlite3 = (await import("sqlite3")).default;
    const { open } = await import("sqlite");
    db = await open({
      filename,
      driver: sqlite3.Database,
    });
    // create schema
    await db.exec(`
      CREATE TABLE IF NOT EXISTS Tokens (
        email TEXT NOT NULL PRIMARY KEY,
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT (datetime('now')),
        updated_at TIMESTAMP DEFAULT (datetime('now')),
        smtp_password TEXT NOT NULL,
        app_id TEXT
      );

      CREATE TABLE IF NOT EXISTS Aliases (
        email TEXT NOT NULL PRIMARY KEY,
        user_email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT (datetime('now')),
        updated_at TIMESTAMP DEFAULT (datetime('now')),
        FOREIGN KEY(user_email) REFERENCES Tokens(email)
      );

      CREATE TABLE IF NOT EXISTS Gmail1Tokens (
        email TEXT NOT NULL PRIMARY KEY,
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT (datetime('now')),
        updated_at TIMESTAMP DEFAULT (datetime('now')),
        app_id TEXT
      );

      CREATE TABLE IF NOT EXISTS SentCopyBindings (
        gmail2_email TEXT NOT NULL PRIMARY KEY,
        gmail1_email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT (datetime('now')),
        updated_at TIMESTAMP DEFAULT (datetime('now')),
        FOREIGN KEY(gmail2_email) REFERENCES Tokens(email),
        FOREIGN KEY(gmail1_email) REFERENCES Gmail1Tokens(email)
      );
    `);
  }
  return db;
}

export async function endDb() {
  if (db) {
    await db.close();
    db = undefined;
  }
}

export async function getUser(email?: string): Promise<User | undefined> {
  const db = await getDb();
  const result = await db.get<{
    email: string;
    token: string;
    smtp_password: string;
    app_id: string;
  }>(
    `
      SELECT Tokens.*
      FROM Tokens
      WHERE Tokens.email = ?
      UNION ALL
      SELECT Tokens.*
      FROM Aliases
      JOIN Tokens ON Tokens.email = Aliases.user_email
      WHERE Aliases.email = ?
      LIMIT 1
    `,
    email,
    email
  );
  return result
    ? {
        email: result.email,
        token: JSON.parse(result.token),
        smtp_password: result.smtp_password,
        app_id: result.app_id,
      }
    : undefined;
}

export async function upsertAlias(email: string, user_email: string) {
  await upsert("Aliases", [
    {
      email,
      user_email,
      updated_at: new Date().toISOString(),
    },
  ]);
}

export async function getGmail1Account(
  email: string
): Promise<Gmail1Account | undefined> {
  const db = await getDb();
  const result = await db.get<{
    email: string;
    token: string;
    app_id: string;
  }>(`SELECT * FROM Gmail1Tokens WHERE email = ?`, email);
  return result
    ? {
        email: result.email,
        token: JSON.parse(result.token),
        app_id: result.app_id,
      }
    : undefined;
}

export async function upsertGmail1Account(
  email: string,
  token: GoogleOAuthCredentials,
  app_id: string
) {
  await upsert("Gmail1Tokens", [
    {
      email,
      token: JSON.stringify(token),
      updated_at: new Date().toISOString(),
      app_id,
    },
  ]);
  return await getGmail1Account(email);
}

export async function setSentCopyBinding(
  gmail2_email: string,
  gmail1_email: string
) {
  await upsert("SentCopyBindings", [
    {
      gmail2_email,
      gmail1_email,
      updated_at: new Date().toISOString(),
    },
  ]);
  return await getSentCopyBinding(gmail2_email);
}

export async function getSentCopyBinding(
  gmail2_email: string
): Promise<SentCopyBinding | undefined> {
  const db = await getDb();
  const result = await db.get<{
    gmail2_email: string;
    gmail1_email: string;
    token: string;
    app_id: string;
  }>(
    `
      SELECT
        SentCopyBindings.gmail2_email,
        SentCopyBindings.gmail1_email,
        Gmail1Tokens.token,
        Gmail1Tokens.app_id
      FROM SentCopyBindings
      JOIN Gmail1Tokens ON Gmail1Tokens.email = SentCopyBindings.gmail1_email
      WHERE SentCopyBindings.gmail2_email = ?
    `,
    gmail2_email
  );
  return result
    ? {
        gmail2_email: result.gmail2_email,
        gmail1_email: result.gmail1_email,
        gmail1: {
          email: result.gmail1_email,
          token: JSON.parse(result.token),
          app_id: result.app_id,
        },
      }
    : undefined;
}

export async function updateUserSmtpPassword(
  email: string,
  smtp_password: string
) {
  const db = await getDb();
  await db.run(
    `UPDATE Tokens SET smtp_password = ? WHERE email = ?`,
    smtp_password,
    email
  );
  return await getUser(email);
}

export async function upsert<T extends { [f: string]: any }>(
  table: string,
  arr: Array<T>,
  options?: {
    ignoreIfSetFields?: Array<keyof T>;
  }
) {
  if (!arr.length) {
    return;
  }

  const db = await getDb();
  const fields = _.keys(_.first(arr));
  const ignoreIfSetFields = new Set(options?.ignoreIfSetFields);

  for (const row of arr) {
    const placeholders = fields.map(() => "?").join(",");
    const updateClauses = fields
      .filter((f) => !ignoreIfSetFields.has(f as keyof T))
      .map((f) => `${f} = excluded.${f}`)
      .join(",");
    const query = `
      INSERT INTO ${table} (${fields.join(",")})
      VALUES (${placeholders})
      ON CONFLICT DO UPDATE SET
      ${updateClauses}
    `;
    await db.run(
      query,
      _.map(fields, (f) => row[f])
    );
  }
}
