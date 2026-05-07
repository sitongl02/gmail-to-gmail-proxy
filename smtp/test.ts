import "source-map-support/register";
import "localenv";
import nodemailer from "nodemailer";
import { getUser } from "../lib/db";

(async () => {
  const [authEmail, to, from = authEmail] = process.argv.slice(2);

  const user = await getUser(authEmail);

  if (!user) {
    throw new Error(`User ${authEmail} not found.`);
  }

  const transporter = nodemailer.createTransport({
    host: "localhost",
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: {
      user: authEmail,
      pass: user.smtp_password,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  await transporter.sendMail({
    from,
    to,
    subject: "Hello!",
    text: "Hello from your relay!",
  });
})();
