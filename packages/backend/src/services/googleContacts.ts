import { google } from "googleapis";
import { GOOGLE_CONTACTS_ENABLED, GOOGLE_CONTACTS_MAX_RESULTS } from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import { buildOAuthClient, GoogleCalendarError } from "./googleCalendar.js";
import type { Contact } from "../schemas/googleContacts.js";

/**
 * Google Contacts connector (Step 18).
 *
 * SAFETY BOUNDARIES — identical contract to googleCalendar.ts and gmail.ts:
 * - Read-only: no write actions exist for contacts.
 * - FAILS CLOSED. Disabled flag, missing/invalid credential files, or any API
 *   error throw ContactsError; callers degrade gracefully to available:false.
 * - NEVER LOGS SECRETS. Reuses the same OAuth client + credentials as the
 *   Google Calendar and Gmail connectors.
 *
 * OAuth note: contacts.readonly scope is required in addition to Calendar/Gmail
 * scopes. Re-run `npm run google-auth` once to get a fresh token.
 */

export type ContactsFailureReason = "disabled" | "config" | "auth" | "api";

export class ContactsError extends Error {
  constructor(
    public readonly reason: ContactsFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "ContactsError";
  }
}

/** Whether the Contacts connector is enabled. DB config overrides env-var. */
export function isContactsEnabled(): boolean {
  const dbValue = getConfigBool("google_contacts_enabled");
  if (dbValue !== null) return dbValue;
  return GOOGLE_CONTACTS_ENABLED;
}

/** Build an authenticated People API client. Throws ContactsError on failure. */
function buildPeopleClient() {
  try {
    const auth = buildOAuthClient();
    return google.people({ version: "v1", auth });
  } catch (err) {
    if (err instanceof GoogleCalendarError) {
      throw new ContactsError("config", err.message);
    }
    throw new ContactsError("config", "Failed to build Contacts OAuth client.");
  }
}

/**
 * Fetch the user's Google Contacts, capped at GOOGLE_CONTACTS_MAX_RESULTS.
 * Returns name + primary email (+ phone when present). Sorted by display name.
 * Throws ContactsError on any failure.
 */
export async function fetchGoogleContacts(limit?: number): Promise<Contact[]> {
  if (!isContactsEnabled()) {
    throw new ContactsError("disabled", "Google Contacts is not enabled.");
  }

  const people = buildPeopleClient();
  const pageSize = Math.min(limit ?? GOOGLE_CONTACTS_MAX_RESULTS, 1000);

  let allConnections: Contact[] = [];
  let pageToken: string | undefined;

  do {
    const res = await people.people.connections.list({
      resourceName: "people/me",
      personFields: "names,emailAddresses,phoneNumbers",
      pageSize: Math.min(pageSize - allConnections.length, 200),
      pageToken,
      sortOrder: "FIRST_NAME_ASCENDING",
    });

    const connections = res.data.connections ?? [];
    for (const person of connections) {
      const name =
        person.names?.[0]?.displayName ??
        person.names?.[0]?.givenName ??
        null;
      if (!name) continue;

      const email = person.emailAddresses?.[0]?.value ?? undefined;
      const phone = person.phoneNumbers?.[0]?.value ?? undefined;

      allConnections.push({
        resourceName: person.resourceName ?? "",
        name,
        email,
        phone,
      });
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && allConnections.length < pageSize);

  return allConnections.slice(0, pageSize);
}
