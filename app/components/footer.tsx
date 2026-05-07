export function Footer() {
  return (
    <div className="text-center py-12">
      <p className="text-s text-gray-400 max-w-3xl mx-auto">
        <a
          rel="noopener"
          href="https://developers.google.com/workspace/gmail/api/guides/sending"
          target="_blank"
        >
          Sending Guide
        </a>{" "}
        |{" "}
        <a
          rel="noopener"
          href="https://developers.google.com/workspace/gmail/api/auth/scopes"
          target="_blank"
        >
          Scopes
        </a>
      </p>
    </div>
  );
}
