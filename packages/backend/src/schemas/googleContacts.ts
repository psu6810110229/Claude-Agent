import { z } from "zod";

export const contactSchema = z.object({
  resourceName: z.string(),
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

export type Contact = z.infer<typeof contactSchema>;

export const contactListResponseSchema = z.object({
  contacts: z.array(contactSchema),
  available: z.boolean(),
});

export type ContactListResponse = z.infer<typeof contactListResponseSchema>;
