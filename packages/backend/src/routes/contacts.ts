import type { FastifyInstance } from "fastify";
import { fetchGoogleContacts, isContactsEnabled, ContactsError } from "../services/googleContacts.js";

/**
 * Google Contacts routes (Step 18).
 *
 * Read-only. Fails closed: disabled / config / auth / API errors return
 * { available: false, contacts: [] } — never expose error details.
 */
export async function contactsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/contacts", async (_req, reply) => {
    if (!isContactsEnabled()) {
      return reply.send({ available: false, contacts: [] });
    }
    try {
      const contacts = await fetchGoogleContacts();
      return reply.send({ available: true, contacts });
    } catch (err) {
      if (err instanceof ContactsError) {
        app.log.warn({ reason: err.reason }, "Contacts fetch failed");
      }
      return reply.send({ available: false, contacts: [] });
    }
  });

  app.get<{ Querystring: { q?: string } }>(
    "/api/contacts/search",
    async (req, reply) => {
      if (!isContactsEnabled()) {
        return reply.send({ available: false, contacts: [] });
      }
      const q = (req.query.q ?? "").trim().toLowerCase();
      try {
        const all = await fetchGoogleContacts();
        const contacts = q
          ? all.filter(
              (c) =>
                c.name.toLowerCase().includes(q) ||
                (c.email ?? "").toLowerCase().includes(q),
            )
          : all;
        return reply.send({ available: true, contacts });
      } catch (err) {
        if (err instanceof ContactsError) {
          app.log.warn({ reason: err.reason }, "Contacts search failed");
        }
        return reply.send({ available: false, contacts: [] });
      }
    },
  );
}
