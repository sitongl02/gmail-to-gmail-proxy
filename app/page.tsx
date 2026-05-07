import { ArrowRight, KeyRound, Server, ShieldCheck } from "lucide-react";
import { Header } from "./components/header";
import { Footer } from "./components/footer";
import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Header />

        <div className="mt-16 bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-start space-x-4">
            <KeyRound className="h-6 w-6 text-amber-500 flex-shrink-0 mt-1" />
            <div className="pr-10">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                The SMTP Bridge
              </h2>
              <p className="text-gray-600 leading-relaxed">
                Gmail's "Send mail as" setup still expects an SMTP server,
                username, and password. This proxy provides that SMTP surface
                to Gmail, then uses Google OAuth on the server side so the
                message can be sent through the authenticated Gmail account
                without storing a Google account password.
              </p>
            </div>
          </div>

          <div className="mt-12 flex items-start space-x-4">
            <Server className="h-6 w-6 text-green-500 flex-shrink-0 mt-1" />
            <div className="pr-10">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                The Gmail API Path
              </h2>
              <p className="text-gray-600 leading-relaxed">
                The SMTP server accepts the MIME email from Gmail, encodes it
                as a base64url string, and forwards it to Google's{" "}
                <a
                  className="text-blue-500"
                  rel="noopener"
                  target="_blank"
                  href="https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send"
                >
                  users.messages.send
                </a>{" "}
                endpoint.
              </p>
              <ul className="text-gray-600 leading-relaxed list-disc pl-6 mt-4">
                <li>Gmail connects to this proxy over SMTP with TLS.</li>
                <li>The proxy authenticates Gmail with a generated SMTP password.</li>
                <li>
                  The proxy sends through the Gmail API using the user's Google
                  OAuth token.
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex items-start space-x-4">
            <ShieldCheck className="h-6 w-6 text-blue-500 flex-shrink-0 mt-1" />
            <div className="pr-10">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                Permissions
              </h2>
              <p className="text-black bg-gray-200 p-4 mt-4">
                The Gmail permission requested is{" "}
                <code>https://www.googleapis.com/auth/gmail.send</code>, which
                is used to send mail only. The OAuth login also requests{" "}
                <code>openid email</code> so the app can identify which Gmail
                address owns the generated SMTP credentials.
              </p>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-100">
            <div className="flex flex-col items-center">
              <a
                className="inline-flex items-center px-8 py-4 border border-transparent text-lg font-medium rounded-xl text-white bg-[#05a6f0] hover:bg-[#0490d3] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#05a6f0] transition-all duration-200 hover:scale-105"
                href="/auth"
              >
                <Image
                  src="/gmail.webp"
                  alt="Gmail Logo"
                  className="h-5 w-5 mr-3"
                  width={20}
                  height={20}
                />
                Sign in with Google
                <ArrowRight className="ml-3 h-5 w-5" />
              </a>
              <p className="mt-4 text-sm text-gray-500">
                Secure authentication through Google's official{" "}
                <a
                  className="text-blue-500"
                  rel="noopener"
                  target="_blank"
                  href="https://developers.google.com/identity/protocols/oauth2/web-server"
                >
                  OAuth 2.0 flow
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
