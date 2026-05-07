# Gmail To Gmail Proxy

This project presents a Gmail-compatible SMTP server and sends accepted
messages through the Gmail API with Google OAuth.

The intended flow is:

1. Gmail2 signs in with Google in the web app.
2. The app stores the Gmail2 OAuth token and creates a random SMTP password.
3. Gmail1's "Send mail as" feature connects to this proxy using that generated
   SMTP username and password.
4. The proxy receives the raw MIME message, base64url-encodes it, and calls the
   Gmail2 Gmail API `users.messages.send` endpoint.
5. Gmail1 is authorized separately and bound to Gmail2.
6. After Gmail2 sends, the proxy reads Gmail2's actual raw sent MIME and appends
   it into Gmail1 Sent Mail over IMAP.

Gmail2 requests `https://www.googleapis.com/auth/gmail.send` and
`https://www.googleapis.com/auth/gmail.readonly`. The readonly scope is needed
to read Gmail2's actual sent raw MIME after `messages.send`. Gmail1 requests
`https://mail.google.com/` so the proxy can authenticate to Gmail IMAP with
XOAUTH2 and append the sent copy.

## Setup

1. Have a domain name with valid SSL certificates and update `SMTP_HOST`,
   `SMTP_KEY_FILE`, and `SMTP_CERT_FILE` in `.env`.
2. Create a Google Cloud project and enable the Gmail API.
3. Configure the OAuth consent screen and add the Gmail send scope, Gmail
   readonly scope, plus `https://mail.google.com/`.
4. Create an OAuth 2.0 Client ID for a Web application.
5. Add `https://<HOST>/auth` and `https://<HOST>/auth/gmail1` as authorized
   redirect URIs.
6. Add the OAuth client details to `GOOGLE_APPS` in `.env`. Multiple client
   registrations are supported. The default app for new users is the first
   entry, or set `GOOGLE_APPS_DEFAULT_ID` explicitly.

   ```json
   [
     {
       "id": "GOOGLE_CLIENT_ID_1",
       "secret": "GOOGLE_CLIENT_SECRET_1"
     },
     {
       "id": "GOOGLE_CLIENT_ID_2",
       "secret": "GOOGLE_CLIENT_SECRET_2"
     }
   ]
   ```

7. Generate your own `SESSION_SECRET` to manage session encryption.
8. Run `docker-compose up`.

## Certificates (Route53)

Reference: https://certbot-dns-route53.readthedocs.io/en/stable/

```sh
docker run --rm -v \
  "$(pwd)/certificates:/etc/letsencrypt/" \
  -e "AWS_ACCESS_KEY_ID=<YOUR_KEY_ID>" \
  -e "AWS_SECRET_ACCESS_KEY=<YOUR_SECRET_KEY>" \
  certbot/dns-route53 \
  certonly \
  --non-interactive \
  --agree-tos \
  --email <YOUR_EMAIL> \
  --dns-route53 \
  -d <YOUR_SMTP_HOST>
```

Then update:

- `SMTP_KEY_FILE`: `certificates/live/<YOUR_SMTP_HOST>/privkey.pem`
- `SMTP_CERT_FILE`: `certificates/live/<YOUR_SMTP_HOST>/fullchain.pem`

## Certificates (Cloudflare)

Reference: https://certbot-dns-cloudflare.readthedocs.io/en/stable/

```sh
docker run --rm -v \
  "$(pwd)/certificates:/etc/letsencrypt/" \
  -v "<LOCAL_SECRET_FILE>:/root/.secrets/cloudflare.ini" \
  certbot/dns-cloudflare \
  certonly \
  --non-interactive \
  --agree-tos \
  --key-type rsa \
  --cert-name <YOUR_SMTP_HOST> \
  --email <YOUR_EMAIL> \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d <YOUR_SMTP_HOST>
```

Then update:

- `SMTP_KEY_FILE`: `certificates/live/<YOUR_SMTP_HOST>/privkey.pem`
- `SMTP_CERT_FILE`: `certificates/live/<YOUR_SMTP_HOST>/fullchain.pem`

## Usage

Visit the web app, authenticate Gmail2 with Google, authorize Gmail1 from the
configuration page, and copy the displayed SMTP credentials into Gmail1's "Send
mail as" settings.

You can test a local send after authenticating by entering the Docker shell and
running:

```sh
npm run smtp:test -- <GMAIL_ADDRESS> <TARGET_EMAIL>
```

The test script ignores certificate errors because it connects to `localhost`.
Gmail itself requires a valid certificate for the SMTP host.
