// Read-only diagnostic: prints the OAuth scopes actually granted to the stored
// Google refresh token. Does NOT write/modify anything. Run:
//   node packages/backend/scripts/check-google-scopes.mjs
//
// It exchanges the refresh token for a short-lived access token and prints the
// `scope` string Google returns — the authoritative list of what this token can
// do. Use it to tell "token is missing gmail/drive scopes" apart from "API not
// enabled in Cloud Console".

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

const SECRET_PATH =
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET_PATH ??
  path.join(DATA_DIR, "google-client-secret.json");
const TOKEN_PATH =
  process.env.GOOGLE_CALENDAR_TOKEN_PATH ??
  path.join(DATA_DIR, "google-token.json");

const EXPECTED = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

function readJson(p, label) {
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    console.error(`MISSING ${label}: ${p}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`INVALID JSON ${label}: ${p}`);
    process.exit(1);
  }
}

function postForm(host, pathName, form) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        path: pathName,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const secret = readJson(SECRET_PATH, "client secret file");
const cfg = secret.installed ?? secret.web;
if (!cfg?.client_id || !cfg?.client_secret) {
  console.error("Client secret file missing client_id/client_secret.");
  process.exit(1);
}
const token = readJson(TOKEN_PATH, "token file");
if (!token.refresh_token) {
  console.error("Token file has no refresh_token. Re-run npm run google-auth.");
  process.exit(1);
}

const res = await postForm("oauth2.googleapis.com", "/token", {
  client_id: cfg.client_id,
  client_secret: cfg.client_secret,
  refresh_token: token.refresh_token,
  grant_type: "refresh_token",
});

let parsed;
try {
  parsed = JSON.parse(res.data);
} catch {
  console.error(`Token endpoint returned non-JSON (status ${res.status}).`);
  process.exit(1);
}

if (parsed.error) {
  console.error(`Refresh FAILED: ${parsed.error} — ${parsed.error_description ?? ""}`);
  console.error("Token is invalid/revoked. Re-run npm run google-auth.");
  process.exit(1);
}

const granted = (parsed.scope ?? "").split(/\s+/).filter(Boolean);
console.log("\nGranted scopes on stored refresh token:");
for (const s of granted) console.log("  ✓ " + s);

const missing = EXPECTED.filter((e) => !granted.includes(e));
if (missing.length) {
  console.log("\nMISSING expected scopes:");
  for (const m of missing) console.log("  ✗ " + m);
  console.log(
    "\n→ Token does NOT have these scopes. Cause = consent/scope problem,\n" +
      "  NOT an API-enabled problem. Fix: add scopes to the OAuth consent\n" +
      "  screen, then revoke old grant + re-run npm run google-auth.",
  );
} else {
  console.log(
    "\n→ All expected scopes present. If Gmail/Drive still fail, cause is\n" +
      "  likely the API not enabled in Cloud Console (check curl logs for\n" +
      "  'accessNotConfigured' / 'has not been used').",
  );
}
