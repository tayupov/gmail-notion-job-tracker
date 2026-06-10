import { z } from "zod";

/**
 * Application states. These MUST match the option names of the Notion `Status`
 * property exactly — it is a `status`-type property, and the API cannot create
 * new options for it, so any value not in this list would fail to write.
 */
export const StatusEnum = z.enum([
  "Not Applied",
  "Applied",
  "Interview Scheduled",
  "Interviewing",
  "Offer Received",
  "Accepted",
  "Rejected",
]);
export type Status = z.infer<typeof StatusEnum>;

/** A single email distilled to what the LLM needs to reason about it. */
export interface Email {
  id: string;
  from: string;
  subject: string;
  /** ISO date (YYYY-MM-DD) the email was received. */
  date: string;
  body: string;
}

/** An application already tracked in Notion, used as dedup/state context. */
export interface ExistingRow {
  pageId: string;
  company: string;
  position: string;
  status: string;
}

/**
 * One change the LLM proposes. `create` adds a new row; `update` patches the
 * existing row identified by `pageId`. Field values are null when not present
 * in the source email.
 */
export const ActionSchema = z.object({
  action: z.enum(["create", "update"]),
  /** Required for `update`; null for `create`. Must match an existing pageId. */
  pageId: z.string().nullable(),
  company: z.string(),
  position: z.string().nullable(),
  status: StatusEnum,
  /** ISO date (YYYY-MM-DD); for new applications, the email date. */
  applicationDate: z.string().nullable(),
  salaryRange: z.string().nullable(),
  jobUrl: z.string().nullable(),
  contactPerson: z.string().nullable(),
  /** Always set — this is the Notion title property, so it's the row's name. */
  notes: z.string(),
  /** Short justification, for logs only — never written to Notion. */
  reasoning: z.string(),
});
export type Action = z.infer<typeof ActionSchema>;

export const ActionsSchema = z.object({
  actions: z.array(ActionSchema),
});
export type Actions = z.infer<typeof ActionsSchema>;
