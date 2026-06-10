import { Client } from "@notionhq/client";
import { config } from "./config.js";
import type { Action, ExistingRow } from "./schema.js";

/**
 * Pin to the stable 2022-06-28 API version so `databases.query` /
 * `databases.retrieve` return properties directly (avoids the newer
 * multi-data-source model). All calls below assume this shape.
 */
const notion = new Client({
  auth: config.notion.token,
  notionVersion: "2022-06-28",
});

/** Maps each logical column to the actual Notion property name + type. */
export interface DbSchema {
  /** key = lowercased canonical column name, value = { name, type } */
  byName: Map<string, { name: string; type: string }>;
  titleName: string;
}

/** Canonical column names the tracker reads/writes. */
const COLUMNS = {
  company: "Company",
  position: "Position",
  status: "Status",
  applicationDate: "Application Date",
  salaryRange: "Salary Range",
  jobUrl: "Job URL",
  contactPerson: "Contact Person",
  notes: "Notes",
} as const;

/** Retrieves the database schema and locates the title property. */
export async function readDatabaseSchema(): Promise<DbSchema> {
  const db = await notion.databases.retrieve({
    database_id: config.notion.databaseId,
  });
  const properties = (db as { properties: Record<string, { type: string }> })
    .properties;

  const byName = new Map<string, { name: string; type: string }>();
  let titleName = "";
  for (const [name, prop] of Object.entries(properties)) {
    byName.set(name.toLowerCase(), { name, type: prop.type });
    if (prop.type === "title") titleName = name;
  }

  if (!titleName) {
    throw new Error("Notion database has no title property — cannot continue.");
  }
  return { byName, titleName };
}

/** Looks up a column's actual property name/type, or undefined if absent. */
function col(
  schema: DbSchema,
  canonical: string,
): { name: string; type: string } | undefined {
  return schema.byName.get(canonical.toLowerCase());
}

// --- Reading -------------------------------------------------------------

/** Pulls a plain-text value out of a Notion property of any text-like type. */
function readText(prop: unknown): string {
  const p = prop as { type?: string; [k: string]: unknown };
  if (!p?.type) return "";
  switch (p.type) {
    case "title":
    case "rich_text": {
      const arr = (p[p.type] as { plain_text?: string }[]) ?? [];
      return arr.map((t) => t.plain_text ?? "").join("");
    }
    case "select":
      return (p.select as { name?: string } | null)?.name ?? "";
    case "status":
      return (p.status as { name?: string } | null)?.name ?? "";
    case "url":
      return (p.url as string | null) ?? "";
    default:
      return "";
  }
}

/** Reads every row of the database into the dedup/state list. */
export async function readExistingRows(schema: DbSchema): Promise<ExistingRow[]> {
  const rows: ExistingRow[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res = await notion.databases.query({
      database_id: config.notion.databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      const props = (page as { properties: Record<string, unknown> }).properties;
      const companyCol = col(schema, COLUMNS.company);
      const positionCol = col(schema, COLUMNS.position);
      const statusCol = col(schema, COLUMNS.status);
      rows.push({
        pageId: (page as { id: string }).id,
        company: companyCol ? readText(props[companyCol.name]) : "",
        position: positionCol ? readText(props[positionCol.name]) : "",
        status: statusCol ? readText(props[statusCol.name]) : "",
      });
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return rows;
}

// --- Writing -------------------------------------------------------------

/** Formats a string value into the correct property payload for its type. */
function formatProperty(type: string, value: string): Record<string, unknown> {
  switch (type) {
    case "title":
      return { title: [{ text: { content: value } }] };
    case "rich_text":
      return { rich_text: [{ text: { content: value } }] };
    case "select":
      return { select: { name: value } };
    case "status":
      return { status: { name: value } };
    case "date":
      return { date: { start: value } };
    case "url":
      return { url: value };
    default:
      return {};
  }
}

/** Builds the Notion `properties` object for a create/update from an action. */
function buildProperties(
  schema: DbSchema,
  action: Action,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  const set = (canonical: string, value: string | null) => {
    if (value === null || value === "") return;
    const c = col(schema, canonical);
    if (!c) return; // column not present in this database — skip gracefully
    props[c.name] = formatProperty(c.type, value);
  };

  set(COLUMNS.company, action.company);
  set(COLUMNS.position, action.position);
  set(COLUMNS.status, action.status);
  set(COLUMNS.applicationDate, action.applicationDate);
  set(COLUMNS.salaryRange, action.salaryRange);
  set(COLUMNS.jobUrl, action.jobUrl);
  set(COLUMNS.contactPerson, action.contactPerson);
  set(COLUMNS.notes, action.notes);

  return props;
}

/** Creates a new application row. */
export async function createRow(schema: DbSchema, action: Action): Promise<void> {
  await notion.pages.create({
    parent: { database_id: config.notion.databaseId },
    properties: buildProperties(schema, action) as never,
  });
}

/** Patches an existing application row (only the fields present on the action). */
export async function updateRow(schema: DbSchema, action: Action): Promise<void> {
  if (!action.pageId) throw new Error("updateRow called without a pageId");
  await notion.pages.update({
    page_id: action.pageId,
    properties: buildProperties(schema, action) as never,
  });
}
