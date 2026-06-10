/**
 * One-time LOCAL helper to mint a Gmail refresh token.
 *
 * Prereqs: a Google Cloud OAuth "Desktop app" client with the Gmail API
 * enabled, and GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET set in your .env.
 *
 * Run:  npm run get-token
 * It opens a consent screen, captures the redirect on a loopback port, and
 * prints the refresh token to paste into .env / GitHub Secrets as
 * GOOGLE_REFRESH_TOKEN.
 */
import "dotenv/config";
import http from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in your environment (.env). Set it and retry.`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-auth
    scope: SCOPES,
  });

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "", REDIRECT_URI);
        const c = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        if (err) {
          res.end(`Authorization failed: ${err}. You can close this tab.`);
          server.close();
          reject(new Error(err));
          return;
        }
        if (c) {
          res.end("Authorization received. You can close this tab and return to the terminal.");
          server.close();
          resolve(c);
        } else {
          res.statusCode = 400;
          res.end("No authorization code in request.");
        }
      } catch (e) {
        reject(e as Error);
      }
    });
    server.listen(PORT, () => {
      console.log("\nOpen this URL in your browser to authorize (read-only Gmail access):\n");
      console.log(authUrl + "\n");
      // Best-effort auto-open on macOS/Linux/Windows.
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      exec(`${opener} "${authUrl}"`, () => {});
    });
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token was returned. Revoke prior access at " +
        "https://myaccount.google.com/permissions and run this again.",
    );
    process.exit(1);
  }

  console.log("\n✅ Success. Add this to your .env and GitHub Secrets:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
