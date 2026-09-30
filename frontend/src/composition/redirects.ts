import {
  START_LOCATION,
  type RouteLocationNormalized,
  type RouteLocationRaw,
} from 'vue-router'

import { readBootFlag } from '@/platform/boot'

import table from './redirects.json'

/**
 * Sends old page URLs clicked inside the app to the flip-2 routes (spec §14.3).
 *
 * The server owns the table (`suite/composition/redirects.py`) and answers
 * every cold load. `redirects.json` is its client copy, for old links that
 * never reach the server: an old link in a stored notification, say. The guard
 * reads the same rows by the same rules:
 *
 * - A `:name` segment matches one path segment. Exact rows match before
 *   parameter rows.
 * - A trailing `/<slug>` and a trailing `/` are dropped. A slug is tried only
 *   when no row matches the whole path.
 * - The query passes through. A target with its own query keeps it, and the
 *   old query's other keys follow.
 * - A row with neither a target nor a lookup is a stop: the path stays.
 * - A path with an encoded `/` or `\`, in any case, stays. The server
 *   refuses it too, so `a%2Fb` never reads as two segments.
 *
 * The client never guesses a node. A row that needs a lookup, and every
 * Sheets or Slides row, does a full page load of the old URL, so the server
 * reads the node and answers. `/l/<token>` is a server page too.
 *
 * On the first navigation the server has already answered this URL. A lookup
 * that found no node fell through to the app, so loading the URL again would
 * loop. The guard then leaves the path to normal routing.
 */

interface Row {
  old: string
  new: string | null
  lookup: string | null
}

export interface OldPathAnswer {
  /** The new address when the path alone decides it, or `null` for a lookup. */
  address: string | null
  /** Whether the server must answer this URL on a full page load. */
  serverLoad: boolean
}

const SERVER_PREFIXES = new Set(['sheets', 'slides'])
const ENCODED_SEPARATOR = /%2f|%5c|\\/i

const rowsByLength = new Map<number, Row[]>()
for (const row of [...(table.rows as Row[])].sort(
  (a, b) => Number(!isExact(a)) - Number(!isExact(b)),
)) {
  const length = segmentsOf(row.old).length
  rowsByLength.set(length, [...(rowsByLength.get(length) ?? []), row])
}

/** The table's answer for an old `path` and raw `query`, or `null` to stay. */
export function resolveOldPath(path: string, query = ''): OldPathAnswer | null {
  if (ENCODED_SEPARATOR.test(path)) return null
  const segments = segmentsOf(path)
  for (const candidate of [segments, segments.slice(0, -1)]) {
    if (!candidate.length || candidate[0] === '') continue
    for (const row of rowsByLength.get(candidate.length) ?? []) {
      const params = match(row, candidate)
      if (params) return answer(row, params, query)
    }
  }
  return null
}

/**
 * The router guard. `null` lets the navigation go on, a location redirects it
 * in the app, and `false` stops it for a full page load.
 */
export function redirectOldPath(
  to: Pick<RouteLocationNormalized, 'path' | 'fullPath' | 'hash'>,
  from: RouteLocationNormalized,
  load: (url: string) => void = (url) => window.location.assign(url),
): RouteLocationRaw | false | null {
  if (!readBootFlag(table.flag as 'suite_flip_files')) return null
  const found = resolveOldPath(to.path, rawQuery(to.fullPath))
  if (!found) return null
  if (found.serverLoad && from !== START_LOCATION) {
    load(to.fullPath)
    return false
  }
  return found.address === null ? null : found.address + to.hash
}

function answer(
  row: Row,
  params: Record<string, string>,
  query: string,
): OldPathAnswer | null {
  if (row.lookup !== null) return { address: null, serverLoad: true }
  if (row.new === null) return null
  const address = row.new
    .split('/')
    .map((segment) => (segment.startsWith(':') ? params[segment.slice(1)] : segment))
    .join('/')
  const serverLoad =
    SERVER_PREFIXES.has(segmentsOf(row.old)[0]!) || address.startsWith('/l/')
  return { address: withQuery(address, query), serverLoad }
}

function match(row: Row, segments: string[]): Record<string, string> | null {
  const params: Record<string, string> = {}
  const pattern = segmentsOf(row.old)
  for (const [index, part] of pattern.entries()) {
    const segment = segments[index]!
    if (part.startsWith(':')) {
      if (!segment) return null
      params[part.slice(1)] = segment
    } else if (part !== segment) return null
  }
  return params
}

function withQuery(address: string, query: string): string {
  if (!query) return address
  const [base, own] = address.split('?', 2) as [string, string | undefined]
  if (!own) return `${address}?${query}`
  const ownKeys = new Set(own.split('&').map(keyOf))
  const carried = query.split('&').filter((pair) => pair && !ownKeys.has(keyOf(pair)))
  return `${base}?${[own, ...carried].join('&')}`
}

function keyOf(pair: string): string {
  const key = pair.split('=', 1)[0]!.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(key)
  } catch {
    return key
  }
}

function rawQuery(fullPath: string): string {
  const withoutHash = fullPath.split('#', 1)[0]!
  const start = withoutHash.indexOf('?')
  return start === -1 ? '' : withoutHash.slice(start + 1)
}

function segmentsOf(path: string): string[] {
  return path.replace(/^\/+|\/+$/g, '').split('/')
}

function isExact(row: Row): boolean {
  return !segmentsOf(row.old).some((segment) => segment.startsWith(':'))
}
