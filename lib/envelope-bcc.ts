declare module "nodemailer/lib/addressparser/index.js" {
  export type ParsedAddress = {
    address?: string;
    group?: ParsedAddress[];
  };

  export default function addressParser(value: string): ParsedAddress[];
}

import addressParser, {
  type ParsedAddress,
} from "nodemailer/lib/addressparser/index.js";

export type EnvelopeBccResult = {
  raw: Buffer;
  addedBcc: string[];
};

export function addEnvelopeOnlyRecipientsAsBcc(
  raw: Buffer,
  envelopeRecipients: string[]
): EnvelopeBccResult {
  const split = splitHeadersAndBody(raw);
  if (!split) {
    return { raw, addedBcc: [] };
  }

  const headerText = split.headers.toString("utf8");
  const headerRecipients = getHeaderRecipients(headerText);
  const seen = new Set(headerRecipients.map(normalizeAddress).filter(Boolean));
  const addedBcc = uniqueAddresses(
    envelopeRecipients.filter((recipient) => {
      const normalized = normalizeAddress(recipient);
      return normalized && !seen.has(normalized);
    })
  );

  if (!addedBcc.length) {
    return { raw, addedBcc: [] };
  }

  const bccHeader = `Bcc: ${addedBcc.map(formatAddress).join(", ")}`;
  const updatedHeaders = Buffer.from(
    `${headerText}${split.newline}${bccHeader}`,
    "utf8"
  );
  return {
    raw: Buffer.concat([updatedHeaders, split.separator, split.body]),
    addedBcc,
  };
}

function splitHeadersAndBody(raw: Buffer) {
  const crlfSeparator = Buffer.from("\r\n\r\n");
  const lfSeparator = Buffer.from("\n\n");
  const crlfIndex = raw.indexOf(crlfSeparator);
  const lfIndex = raw.indexOf(lfSeparator);

  if (crlfIndex === -1 && lfIndex === -1) {
    return undefined;
  }

  const useCrLf =
    crlfIndex !== -1 && (lfIndex === -1 || crlfIndex <= lfIndex);
  const index = useCrLf ? crlfIndex : lfIndex;
  const separator = useCrLf ? crlfSeparator : lfSeparator;

  return {
    headers: raw.subarray(0, index),
    separator,
    body: raw.subarray(index + separator.length),
    newline: useCrLf ? "\r\n" : "\n",
  };
}

function getHeaderRecipients(headerText: string) {
  return getHeaderValues(headerText, new Set(["to", "cc", "bcc"])).flatMap(
    parseAddressList
  );
}

function getHeaderValues(headerText: string, names: Set<string>) {
  const values: string[] = [];
  let currentName: string | undefined;
  let currentValue: string[] = [];

  for (const line of headerText.split(/\r?\n/)) {
    if (/^[\t ]/.test(line) && currentName) {
      currentValue.push(line.trim());
      continue;
    }

    if (currentName && names.has(currentName)) {
      values.push(currentValue.join(" "));
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      currentName = undefined;
      currentValue = [];
      continue;
    }

    currentName = line.slice(0, separatorIndex).trim().toLowerCase();
    currentValue = [line.slice(separatorIndex + 1).trim()];
  }

  if (currentName && names.has(currentName)) {
    values.push(currentValue.join(" "));
  }

  return values;
}

function parseAddressList(value: string) {
  return flattenParsedAddresses(addressParser(value))
    .map((entry) => entry.address)
    .filter((address): address is string => Boolean(address));
}

function flattenParsedAddresses(entries: ParsedAddress[]): ParsedAddress[] {
  return entries.flatMap((entry) =>
    entry.group?.length ? flattenParsedAddresses(entry.group) : [entry]
  );
}

function uniqueAddresses(addresses: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const address of addresses) {
    const normalized = normalizeAddress(address);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(address.trim());
  }
  return unique;
}

function normalizeAddress(address: string) {
  return address.trim().replace(/^<|>$/g, "").toLowerCase();
}

function formatAddress(address: string) {
  return `<${address.trim().replace(/^<|>$/g, "")}>`;
}
