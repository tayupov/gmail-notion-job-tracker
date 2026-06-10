import { google, type gmail_v1 } from "googleapis";
import { config } from "./config.js";
import type { Email } from "./schema.js";

/** Builds an OAuth2 client; the refresh token mints access tokens on demand. */
function gmailClient(): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
  );
  auth.setCredentials({ refresh_token: config.google.refreshToken });
  return google.gmail({ version: "v1", auth });
}

/** Reads a header value (case-insensitive) from a message payload. */
function header(
  payload: gmail_v1.Schema$MessagePart | undefined,
  name: string,
): string {
  const found = payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

/** Decodes a base64url-encoded body segment to UTF-8 text. */
function decode(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}

/**
 * Walks the MIME tree and returns the first text/plain body found, falling
 * back to stripped text/html if no plain part exists.
 */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  const plain = findPart(payload, "text/plain");
  if (plain) return decode(plain.body?.data);

  const html = findPart(payload, "text/html");
  if (html) {
    return decode(html.body?.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Single-part message with the body directly on the payload.
  return decode(payload.body?.data);
}

/** Depth-first search for the first part matching the given MIME type. */
function findPart(
  part: gmail_v1.Schema$MessagePart,
  mimeType: string,
): gmail_v1.Schema$MessagePart | undefined {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const match = findPart(child, mimeType);
    if (match) return match;
  }
  return undefined;
}

/** Normalises the Gmail internalDate (epoch ms string) to an ISO date. */
function isoDate(internalDate: string | null | undefined): string {
  if (!internalDate) return "";
  return new Date(Number(internalDate)).toISOString().slice(0, 10);
}

/** Fetches recent inbox emails, distilled to the fields the LLM needs. */
export async function fetchRecentEmails(): Promise<Email[]> {
  const gmail = gmailClient();

  const list = await gmail.users.messages.list({
    userId: "me",
    q: config.gmailQuery,
    maxResults: config.maxEmails,
  });

  const ids = (list.data.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));

  const emails = await Promise.all(
    ids.map(async (id): Promise<Email> => {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
      const payload = msg.data.payload ?? undefined;
      const body = extractBody(payload).slice(0, config.maxBodyChars);
      return {
        id,
        from: header(payload, "From"),
        subject: header(payload, "Subject"),
        date: isoDate(msg.data.internalDate),
        body,
      };
    }),
  );

  return emails;
}
