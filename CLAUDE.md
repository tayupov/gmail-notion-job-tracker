# CLAUDE.md

## What this is

A small, headless job-application tracker. Twice a day a **GitHub Actions cron**
([.github/workflows/track.yml](.github/workflows/track.yml)) reads recent Gmail,
uses **Claude Haiku 4.5** to detect new applications and status changes, and
syncs them into a **Notion** database. No server; all secrets live in GitHub
Secrets / local `.env`.

Pipeline ([src/main.ts](src/main.ts)): fetch recent email → read current Notion
rows → ask Claude for a list of changes → apply create/update to Notion.

## Commands

```bash
npm run track              # run the pipeline (writes to Notion)
DRY_RUN=true npm run track # log proposed actions, write nothing
npm run get-token          # one-time: mint GOOGLE_REFRESH_TOKEN via local OAuth
npm run typecheck          # tsc --noEmit
```

ESM project (`"type": "module"`), run with `tsx`. Import paths use `.js`
extensions. Node 20+.

## File map

| File | Role |
| --- | --- |
| [src/gmail.ts](src/gmail.ts) | OAuth2 from refresh token; fetch + decode recent inbox emails (read-only) |
| [src/notion.ts](src/notion.ts) | Introspect DB schema, read existing rows (dedup state), create/update rows |
| [src/llm.ts](src/llm.ts) | Send emails + existing rows to Claude → structured list of actions |
| [src/main.ts](src/main.ts) | Orchestrate; filter no-ops; `DRY_RUN` |
| [src/schema.ts](src/schema.ts) | Zod schemas + the `Status` enum |
| [src/config.ts](src/config.ts) | Env loading/validation |
| [scripts/get-refresh-token.ts](scripts/get-refresh-token.ts) | One-time local OAuth helper |

## Critical constraints (don't break these)

- **Notion `Status` is a `status`-type property**, not `select`. The API
  **cannot create new options** on it, so `StatusEnum` in
  [src/schema.ts](src/schema.ts) MUST exactly match the database's existing
  option names: `Not Applied, Applied, Interview Scheduled, Interviewing,
  Offer Received, Accepted, Rejected`. The tool never assigns "Not Applied".
- **The Notion title property is `Notes`** (not Company; Company is `rich_text`).
  A row's display name is its Notes, so `notes` is required (never null) in the
  schema and the LLM is told to always write it. [src/notion.ts](src/notion.ts)
  detects the title property by type, so it stays correct if columns are renamed.
- **Structured outputs live on the beta namespace**: use
  `client.beta.messages.parse(...)` with `betaZodOutputFormat` from
  `@anthropic-ai/sdk/helpers/beta/zod` (auto-adds the
  `structured-outputs-2025-11-13` header). Read `.parsed_output`.
- **Requires Zod v4** — the SDK helper calls `z.toJSONSchema`, which only exists
  in Zod 4. Do not downgrade to Zod 3.
- **Notion client pinned to v2** (`@notionhq/client` ^2.x) and API version
  `2022-06-28`. v5 removed `databases.query` (moved to a data-source model); this
  code uses `databases.query` / `databases.retrieve().properties` directly.

## Behavior notes

- **Idempotency** comes from reading existing rows each run: Claude is shown
  what's already tracked, so re-seeing the same email produces no action. No
  Gmail labels or state file.
- **`DRY_RUN` gotcha**: `dotenv` does **not** override a variable already set in
  the shell. If `DRY_RUN=true` is exported in your terminal, a plain
  `npm run track` silently runs dry. Check `echo $DRY_RUN` / `unset DRY_RUN`.
- Gmail window is `newer_than:1d in:inbox` (overlaps the ~12h cron gap);
  override via `GMAIL_QUERY`. Bodies truncated to 2000 chars, ≤40 emails/run.

## Secrets (`.env` locally, GitHub Secrets in CI)

`ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`, `NOTION_TOKEN`, `NOTION_DATABASE_ID`. `.env` is gitignored.
See [README.md](README.md) for the full Google Cloud / Notion setup.
