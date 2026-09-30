/**
 * Drive's comment and version records, read into the shapes the Sheets panels
 * render. The session returns them untyped, so each field is checked here and
 * a malformed row is dropped rather than rendered half-empty.
 *
 * Anchors are Sheets' own: Drive stores the string and never reads it.
 */

export interface SheetComment {
  name: string;
  content: string;
  /** The user id, or "Guest" for a visitor without a session. */
  author: string | null;
  /** The name a guest typed. `null` for a user. */
  author_name: string | null;
  creation: string | null;
}

export interface SheetThread {
  name: string;
  anchor: CellAnchor | null;
  resolved: boolean;
  comments: SheetComment[];
}

export interface SheetVersion {
  seq: string;
  kind: string;
  label: string | null;
  pinned: boolean;
  actor: string | null;
  creation: string | null;
}

export interface VersionPage {
  rows: SheetVersion[];
  nextCursor: string | null;
}

/** One cell on one worksheet of the workbook. */
export interface CellAnchor {
  sheet: string;
  cell: string;
}

/** A thread about the workbook as a whole, not one cell. */
export const WORKBOOK_ANCHOR = "sheets:workbook";
const CELL_PREFIX = "sheets:cell:";
const CELL = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/;
/** Drive stores an anchor of at most 255 characters. */
const MAX_ANCHOR = 255;

export function cellAnchor(anchor: CellAnchor): string {
  const value = `${CELL_PREFIX}${anchor.cell}!${anchor.sheet}`;
  return value.length <= MAX_ANCHOR ? value : WORKBOOK_ANCHOR;
}

export function readAnchor(value: unknown): CellAnchor | null {
  if (typeof value !== "string" || !value.startsWith(CELL_PREFIX)) return null;
  const rest = value.slice(CELL_PREFIX.length);
  const split = rest.indexOf("!");
  if (split < 0) return null;
  const cell = rest.slice(0, split);
  const sheet = rest.slice(split + 1);
  return CELL.test(cell) && sheet ? { sheet, cell } : null;
}

export function readThreads(payload: unknown): SheetThread[] {
  const threads = field(payload, "threads");
  if (!Array.isArray(threads)) return [];
  return threads.flatMap((row) => {
    const name = text(field(row, "name"));
    if (!name) return [];
    const comments = field(row, "comments");
    return [{
      name,
      anchor: readAnchor(field(row, "anchor")),
      resolved: field(row, "resolved") === true,
      comments: Array.isArray(comments) ? comments.flatMap(readComment) : [],
    }];
  });
}

export function readVersions(payload: unknown): VersionPage {
  const rows = field(payload, "rows");
  return {
    rows: Array.isArray(rows) ? rows.flatMap(readVersion) : [],
    nextCursor: text(field(payload, "next_cursor")),
  };
}

function readComment(row: unknown): SheetComment[] {
  const name = text(field(row, "name"));
  const content = text(field(row, "content"));
  if (!name || content === null) return [];
  return [{
    name,
    content,
    author: text(field(row, "author")),
    author_name: text(field(row, "author_name")),
    creation: text(field(row, "creation")),
  }];
}

function readVersion(row: unknown): SheetVersion[] {
  const seq = field(row, "seq");
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) return [];
  return [{
    seq: String(seq),
    kind: text(field(row, "kind")) ?? "auto",
    label: text(field(row, "label")) || null,
    pinned: Boolean(field(row, "pinned")),
    actor: text(field(row, "actor")),
    creation: text(field(row, "creation")),
  }];
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A Drive time (`YYYY-MM-DD HH:MM:SS`, site time) as a short local label. */
export function stampLabel(stamp: string | null): string {
  if (!stamp) return "";
  const when = new Date(stamp.replace(" ", "T"));
  if (Number.isNaN(when.getTime())) return stamp;
  return when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
