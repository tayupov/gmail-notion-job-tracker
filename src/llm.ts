import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "./config.js";
import { ActionsSchema, type Action, type Email, type ExistingRow } from "./schema.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM = `You maintain a job-application tracker for someone who is actively applying to jobs.

You are given (a) a batch of recent emails and (b) the applications already tracked in a Notion table. Produce a list of changes to apply.

Rules:
- Only act on emails that clearly relate to a specific job application: application confirmations ("thanks for applying"), online assessments / coding tests, interview invitations or scheduling, offers, and rejections. IGNORE everything else (newsletters, job alerts/recommendations, marketing, recruiter cold-outreach with no application, receipts, etc.).
- Decide whether each relevant email is a NEW application or an UPDATE to one that is already tracked. Match against the existing applications by company AND role/position (allow for minor wording differences). If it matches an existing row, emit an "update" with that row's exact pageId. Otherwise emit a "create" with pageId set to null.
- Map every application to exactly ONE of these status values (use these exact strings):
    - "Applied"             — application confirmation received, or an online assessment / coding test was sent.
    - "Interview Scheduled" — an interview was invited or a specific interview time was scheduled.
    - "Interviewing"        — clearly mid-process across multiple rounds (e.g. an email referencing a next/further round after one already happened).
    - "Offer Received"      — an offer was extended.
    - "Accepted"            — the user accepted an offer.
    - "Rejected"            — the application was declined / rejected.
  Do NOT use "Not Applied" — that is reserved for rows the user creates manually.
- Do NOT emit an action if it would not change anything: if an existing row already has the status implied by the email, skip it. Only report genuine new applications or genuine status changes.
- For new applications, set applicationDate to the email's date (YYYY-MM-DD). For updates, leave applicationDate null unless the email states a different application date.
- Extract company, position, salaryRange, jobUrl, and contactPerson (the recruiter/hiring-contact name, if the email names one) when present; otherwise use null. Never invent data.
- ALWAYS write a short "notes" string (this is the row's title in Notion, so it must never be empty). Make it a concise human-readable summary, e.g. "Applied — confirmation email", "Phone screen scheduled for Jun 14", "Rejected after final round".
- If there is nothing to do, return an empty actions array.`;

/** Renders emails and existing rows into a compact prompt block. */
function buildUserMessage(emails: Email[], existing: ExistingRow[]): string {
  const existingBlock =
    existing.length > 0
      ? existing
          .map(
            (r) =>
              `- pageId=${r.pageId} | company="${r.company}" | position="${r.position}" | status="${r.status}"`,
          )
          .join("\n")
      : "(none yet)";

  const emailBlock = emails
    .map(
      (e, i) =>
        `### Email ${i + 1} (date ${e.date})\nFrom: ${e.from}\nSubject: ${e.subject}\n\n${e.body}`,
    )
    .join("\n\n");

  return `## Applications already tracked\n${existingBlock}\n\n## Recent emails\n${emailBlock}`;
}

/** Asks Claude to turn emails + existing state into a list of changes. */
export async function extractActions(
  emails: Email[],
  existing: ExistingRow[],
): Promise<Action[]> {
  if (emails.length === 0) return [];

  // `parse` lives on the beta namespace in this SDK version and auto-adds the
  // `structured-outputs-2025-11-13` beta header.
  const response = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(emails, existing) }],
    output_format: betaZodOutputFormat(ActionsSchema),
  });

  return response.parsed_output?.actions ?? [];
}
