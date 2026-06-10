import "dotenv/config";

/** Reads a required env var or throws a clear error listing what's missing. */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.example for the full list.`,
    );
  }
  return value.trim();
}

export const config = {
  anthropicApiKey: required("ANTHROPIC_API_KEY"),

  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    refreshToken: required("GOOGLE_REFRESH_TOKEN"),
  },

  notion: {
    token: required("NOTION_TOKEN"),
    databaseId: required("NOTION_DATABASE_ID"),
  },

  /** When true, log proposed actions but make no writes to Notion. */
  dryRun: (process.env.DRY_RUN ?? "false").toLowerCase() === "true",

  /** Gmail search query controlling which messages are fetched. */
  gmailQuery: process.env.GMAIL_QUERY?.trim() || "newer_than:1d in:inbox",

  /** Hard cap on how many recent messages to pull per run. */
  maxEmails: 40,

  /** Per-email body truncation, in characters, before sending to the LLM. */
  maxBodyChars: 2000,

  /** Model used for extraction. */
  model: "claude-haiku-4-5",
} as const;
