import fs from "node:fs";
import http from "node:http";
import { google } from "googleapis";
import {
  GOOGLE_CLIENT_SECRET_PATH,
  GOOGLE_TOKEN_PATH,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_OAUTH_REDIRECT_PORT,
} from "../src/config.js";
import { extractClientConfig } from "../src/services/googleCalendar.js";

/**
 * One-time Google OAuth setup (Step 10). Runs the loopback (127.0.0.1) consent
 * flow and stores ONLY the refresh token to the gitignored token file.
 *
 * Requests the narrow Calendar events scope (GOOGLE_CALENDAR_SCOPES), enough to
 * write events through Google APIs. This app only exposes approval-gated create.
 * Secrets and tokens are never logged; we print the consent URL and a success
 * path only.
 *
 * Run with: `npm run google-auth -w @claude-agent/backend`.
 */
async function main(): Promise<void> {
  let secretRaw: string;
  try {
    secretRaw = fs.readFileSync(GOOGLE_CLIENT_SECRET_PATH, "utf8");
  } catch {
    throw new Error(
      `Client secret not found at ${GOOGLE_CLIENT_SECRET_PATH}. ` +
        "Download an OAuth Desktop-app client secret JSON and save it there.",
    );
  }
  const cfg = extractClientConfig(JSON.parse(secretRaw));

  const redirectUri = `http://127.0.0.1:${GOOGLE_OAUTH_REDIRECT_PORT}`;
  const client = new google.auth.OAuth2(
    cfg.client_id,
    cfg.client_secret,
    redirectUri,
  );

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-consent
    scope: GOOGLE_CALENDAR_SCOPES,
  });

  const code = await waitForCode(authUrl, redirectUri);
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh_token returned. Revoke prior access and re-run so Google " +
        "issues a fresh refresh token.",
    );
  }

  // Store ONLY the refresh token (never log it). 0600 = owner read/write only.
  fs.writeFileSync(
    GOOGLE_TOKEN_PATH,
    JSON.stringify({ refresh_token: tokens.refresh_token }, null, 2),
    { mode: 0o600 },
  );
  console.log(`\nSaved refresh token to ${GOOGLE_TOKEN_PATH}`);
  console.log("Set GOOGLE_CALENDAR_ENABLED=1 to activate the connector.");
}

/** Start a tiny loopback server, print the consent URL, resolve with the code. */
function waitForCode(authUrl: string, redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", redirectUri);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.end(`Authorization failed: ${error}. You can close this tab.`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (!code) {
          res.statusCode = 400;
          res.end("Missing authorization code.");
          return;
        }
        res.end("Authorization complete. You can close this tab.");
        server.close();
        resolve(code);
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.on("error", reject);
    server.listen(GOOGLE_OAUTH_REDIRECT_PORT, "127.0.0.1", () => {
      console.log(
        "Open this URL in your browser, sign in, and grant Calendar event access:\n",
      );
      console.log(authUrl);
      console.log(`\nWaiting for redirect on ${redirectUri} ...`);
    });
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nGoogle auth setup failed:", message);
  process.exit(1);
});
