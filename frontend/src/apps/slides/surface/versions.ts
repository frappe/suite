/** One row of `GET nodes/<id>/versions`, as the Versions panel shows it. */
export interface SlidesVersion {
  seq: string
  kind: string
  label: string | null
  pinned: boolean
  actor: string | null
  creation: string | null
}

export interface VersionPage {
  rows: SlidesVersion[]
  nextCursor: string | null
}

/** Reads a versions page. A row without a positive integer `seq` is dropped. */
export function readVersions(payload: unknown): VersionPage {
  const rows = field(payload, 'rows')
  return {
    rows: Array.isArray(rows) ? rows.flatMap(readVersion) : [],
    nextCursor: text(field(payload, 'next_cursor')),
  }
}

function readVersion(row: unknown): SlidesVersion[] {
  const seq = field(row, 'seq')
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return []
  return [
    {
      seq: String(seq),
      kind: text(field(row, 'kind')) ?? 'auto',
      label: text(field(row, 'label')) || null,
      pinned: Boolean(field(row, 'pinned')),
      actor: text(field(row, 'actor')),
      creation: text(field(row, 'creation')),
    },
  ]
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** A Drive time (`YYYY-MM-DD HH:MM:SS`, site time) as a short local label. */
export function stampLabel(stamp: string | null): string {
  if (!stamp) return ''
  const when = new Date(stamp.replace(' ', 'T'))
  if (Number.isNaN(when.getTime())) return stamp
  return when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
