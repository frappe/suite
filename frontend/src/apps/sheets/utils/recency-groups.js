// Recency bucketing for the homepage list — groups sheets by how recently
// they were modified, in the shape frappe-ui's ListView needs for grouped
// rendering ([{group, collapsed, rows}], all rows matching that shape).

const GROUP_ORDER = ['Today', 'Previous 7 days', 'Previous 30 days', 'Earlier']

const DAY_MS = 24 * 60 * 60 * 1000

// Frappe datetimes are "YYYY-MM-DD HH:mm:ss.ffffff" (server-local, may carry
// microseconds). Trim to seconds and switch to a 'T' separator — Safari
// rejects the space-separated form in `new Date(...)`.
export function parseFrappeDatetime(s) {
  return new Date(String(s).slice(0, 19).replace(' ', 'T'))
}

export function recencyBucket(dateStr, now = new Date()) {
  const d = parseFrappeDatetime(dateStr)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // Future timestamps (client/server clock skew) fold into Today rather
  // than falling through to Earlier.
  if (d >= startOfToday) return 'Today'
  if (d >= new Date(startOfToday - 7 * DAY_MS)) return 'Previous 7 days'
  if (d >= new Date(startOfToday - 30 * DAY_MS)) return 'Previous 30 days'
  return 'Earlier'
}

// Buckets `rows` (already sorted by the server) into ListView group objects.
// Empty buckets are omitted; row order within a bucket is preserved.
// `prevGroups` carries each group's `collapsed` flag forward — ListView's
// group header mutates it in place, and the groups array is rebuilt on every
// fetch/append, so without this a Load More would re-expand collapsed groups.
export function groupSheetsByRecency(rows, now = new Date(), prevGroups = []) {
  const buckets = new Map(GROUP_ORDER.map((g) => [g, []]))
  for (const row of rows) {
    buckets.get(recencyBucket(row.modified, now)).push(row)
  }
  const collapsedByLabel = new Map(prevGroups.map((g) => [g.group, g.collapsed]))
  return GROUP_ORDER.filter((g) => buckets.get(g).length).map((g) => ({
    group: g,
    collapsed: collapsedByLabel.get(g) ?? false,
    rows: buckets.get(g),
  }))
}
