# Gmail To Gmail Proxy

This project presents a Gmail-compatible SMTP server and sends accepted
messages through the Gmail API with Google OAuth.

The intended flow is:

1. A user signs in with Google in the web app.
2. The app stores the Google OAuth token and creates a random SMTP password.
3. Gmail's "Send mail as" feature connects to this proxy using that generated
   SMTP username and password.
4. The proxy receives the raw MIME message, base64url-encodes it, and calls the
   Gmail API `users.messages.send` endpoint.

The Gmail API permission requested is
`https://www.googleapis.com/auth/gmail.send`. The OAuth login also requests
`openid email` so the app can identify the Gmail address that owns the SMTP
credentials.

## Setup

1. Have a domain name with valid SSL certificates and update `SMTP_HOST`,
   `SMTP_KEY_FILE`, and `SMTP_CERT_FILE` in `.env`.
2. Create a Google Cloud project and enable the Gmail API.
3. Configure the OAuth consent screen and add the Gmail send scope.
4. Create an OAuth 2.0 Client ID for a Web application.
5. Add `https://<HOST>/auth` as an authorized redirect URI.
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

Visit the web app, authenticate with Google, and copy the displayed SMTP
credentials into Gmail's "Send mail as" settings.

You can test a local send after authenticating by entering the Docker shell and
running:

```sh
npm run smtp:test -- <GMAIL_ADDRESS> <TARGET_EMAIL>
```

The test script ignores certificate errors because it connects to `localhost`.
Gmail itself requires a valid certificate for the SMTP host.
