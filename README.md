# Gmail → Notion Job Tracker

> npm package name: `gmail-notion-job-tracker`

Reads your recent Gmail twice a day, uses **Claude Haiku 4.5** to detect new job
applications and status changes, and syncs them to a **Notion** table. Runs
headless on a **GitHub Actions** cron — no server, no interactive login.

```
Gmail (read-only)  ──▶  Claude (extract actions)  ──▶  Notion (create/update rows)
        ▲                                                       ▲
   last ~24h of inbox                              existing rows = dedup/state
```

## Notion database setup

Create a Notion database with these columns, named **exactly** as shown — the
code matches by name (and detects the title column by type, so any one of them
may be the title):

| Column | Type |
| --- | --- |
| Company | Text (`rich_text`) |
| Position | Text |
| Status | **Status** (or Select — see note) |
| Application Date | Date |
| Salary Range | Text |
| Job URL | URL or Text |
| Contact Person | Text |
| Notes | Title (recommended) |

The `Status` property must offer these option names, again **exactly**:

```
Not Applied · Applied · Interview Scheduled · Interviewing · Offer Received · Accepted · Rejected
```

The tool only ever writes `Applied`, `Interview Scheduled`, `Interviewing`,
`Offer Received`, `Accepted`, `Rejected` — `Not Applied` is left for rows you
add by hand. If `Status` is a **status**-type property the Notion API **cannot
create options**, so all of the above must already exist before the first run;
a **select**-type property auto-creates them. These names are defined in
[src/schema.ts](src/schema.ts) (`StatusEnum`) — if your workflow uses different
stages, edit that enum to match your database.

> Tip: the fastest way to get an exact-match schema is to duplicate a ready-made
> template. _(Add your published Notion template link here.)_

**Idempotency:** because Claude is always shown the already-tracked
applications, re-seeing the same email on the next run produces no change. No
state file or Gmail labels needed.

## Prerequisites

- Node.js 20+
- A Notion tracker database
- A Google account with the Gmail you want to read
- An Anthropic API key

## Setup

### 1. Install

```bash
npm install
cp .env.example .env   # then fill in the values below
```

### 2. Anthropic

Create a key at <https://console.anthropic.com/settings/keys> and set
`ANTHROPIC_API_KEY` in `.env`.

### 3. Notion

1. Create an internal integration: <https://www.notion.so/my-integrations> →
   **New integration** → copy the **Internal Integration Token** into
   `NOTION_TOKEN`.
2. Open your tracker database as a full page → top-right **•••** →
   **Connections** → add your integration (this grants it access).
3. Copy the database id from the URL into `NOTION_DATABASE_ID`. In
   `notion.so/<workspace>/<DATABASE_ID>?v=...`, it's the 32-char id before `?v=`.

### 4. Gmail (read-only OAuth)

1. Go to <https://console.cloud.google.com/> → create/select a project.
2. **APIs & Services → Library →** enable **Gmail API**.
3. **APIs & Services → OAuth consent screen →** set it up (External is fine),
   and under **Audience / Test users**, add your own Google address.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →**
   Application type **Desktop app**. Copy the client id/secret into
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Mint a refresh token (one-time, local):

   ```bash
   npm run get-token
   ```

   This opens a consent screen, asks for **read-only Gmail** access, and prints
   `GOOGLE_REFRESH_TOKEN=...`. Paste it into `.env`.

   > If you see "Google hasn't verified this app", that's expected for a personal
   > project — proceed via **Advanced → Go to … (unsafe)**. Access stays limited
   > to the test users you listed.

### 5. Verify locally

```bash
# Dry run: prints the actions Claude proposes, writes nothing.
DRY_RUN=true npm run track

# Live run: actually creates/updates Notion rows.
npm run track

# Run it again immediately — should report "created 0, updated 0".
npm run track
```

### 6. Deploy to GitHub Actions

Get your own copy of the repo — either click **Use this template** / **Fork** on
GitHub, or push a fresh repo:

```bash
git init && git add . && git commit -m "Initial commit"
gh repo create gmail-notion-job-tracker --private --source=. --push
```

> **Never commit your `.env`.** It's gitignored by default; keep it that way, and
> use your **own** credentials — generate your own Anthropic key, Notion token,
> and Google OAuth client. If a secret is ever exposed, rotate it (and re-run
> `npm run get-token` after rotating the Google client secret).

Then add the six secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `GOOGLE_CLIENT_ID` | OAuth client id |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | from `npm run get-token` |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_DATABASE_ID` | tracker database id |

The workflow ([.github/workflows/track.yml](.github/workflows/track.yml)) runs at
**07:00 and 19:00 UTC**. Trigger it manually from the **Actions** tab
(**Run workflow**) to confirm it's green.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `DRY_RUN` | `false` | When `true`, log proposed actions but don't write to Notion |
| `GMAIL_QUERY` | `newer_than:1d in:inbox` | Which emails to read (Gmail search syntax) |

## How it works

| File | Responsibility |
| --- | --- |
| [src/gmail.ts](src/gmail.ts) | OAuth client from the refresh token; fetch + decode recent emails |
| [src/notion.ts](src/notion.ts) | Introspect the DB schema, read existing rows, create/update rows |
| [src/llm.ts](src/llm.ts) | Send emails + existing rows to Claude; get back a list of changes |
| [src/main.ts](src/main.ts) | Orchestrate the four steps; filter no-ops; `DRY_RUN` support |
| [scripts/get-refresh-token.ts](scripts/get-refresh-token.ts) | One-time local OAuth helper |

## Notes & limitations

- The `Status` column may be a Notion **select** or **status** property. Selects
  auto-create new options on write; **status**-type properties cannot have
  options created via the API, so make sure the four status values exist if you
  use a status-type column.
- Free-form email matching isn't perfect. Review the table occasionally; the
  dry-run mode is useful for sanity-checking before a live run.
- All secrets live in GitHub Secrets and `.env` (gitignored) — none are committed.

## License

[MIT](LICENSE) © Roman Tayupov
