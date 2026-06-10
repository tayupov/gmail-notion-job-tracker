import { config } from "./config.js";
import { fetchRecentEmails } from "./gmail.js";
import {
  createRow,
  readDatabaseSchema,
  readExistingRows,
  updateRow,
} from "./notion.js";
import { extractActions } from "./llm.js";
import type { Action, ExistingRow } from "./schema.js";

/**
 * Belt-and-suspenders guard on top of the LLM's instructions: drop updates that
 * wouldn't change the status, and updates whose pageId doesn't actually exist.
 */
function filterNoOps(actions: Action[], existing: ExistingRow[]): Action[] {
  const byId = new Map(existing.map((r) => [r.pageId, r]));
  return actions.filter((a) => {
    if (a.action !== "update") return true;
    if (!a.pageId || !byId.has(a.pageId)) {
      console.warn(
        `  ⚠︎ skipping update with unknown pageId for "${a.company}"`,
      );
      return false;
    }
    const row = byId.get(a.pageId)!;
    if (row.status === a.status) return false; // no real change
    return true;
  });
}

async function run(): Promise<void> {
  console.log(
    `Application tracker — ${new Date().toISOString()}${config.dryRun ? " (DRY RUN)" : ""}`,
  );

  // 1. Recent email
  const emails = await fetchRecentEmails();
  console.log(`Fetched ${emails.length} recent email(s) [${config.gmailQuery}]`);
  if (emails.length === 0) {
    console.log("Nothing to process.");
    return;
  }

  // 2. Current Notion state
  const schema = await readDatabaseSchema();
  const existing = await readExistingRows(schema);
  console.log(`Read ${existing.length} existing application row(s) from Notion`);

  // 3. Extract changes with Claude
  const proposed = await extractActions(emails, existing);
  const actions = filterNoOps(proposed, existing);
  console.log(`Claude proposed ${proposed.length} action(s); ${actions.length} actionable after filtering`);

  if (actions.length === 0) {
    console.log("No changes to apply.");
    return;
  }

  // 4. Apply
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const a of actions) {
    const label = `${a.action.toUpperCase()} "${a.company}"${a.position ? ` — ${a.position}` : ""} → ${a.status}`;
    console.log(`  • ${label}  (${a.reasoning})`);

    if (config.dryRun) continue;

    try {
      if (a.action === "create") {
        await createRow(schema, a);
        created++;
      } else {
        await updateRow(schema, a);
        updated++;
      }
    } catch (err) {
      failed++;
      console.error(`    ✗ failed: ${(err as Error).message}`);
    }
  }

  if (config.dryRun) {
    console.log(`Dry run complete — ${actions.length} action(s) would be applied.`);
  } else {
    console.log(`Done — created ${created}, updated ${updated}, failed ${failed}.`);
  }

  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
