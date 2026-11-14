import type { LocationQuery } from 'vue-router'

import { parseMailSearchQuery } from '@/apps/mail/components/CommandPalette/searchQuery'

/**
 * A search as the route holds it, and the edits the results page makes to it. The route is the
 * search: the results read it, the palette reads it back, and a copied link is the same search. So
 * every edit is a new query rather than a state of its own.
 */
export type SearchQuery = Record<string, string>

// Scope, not a condition: it widens where the rest are asked.
const SCOPE_KEY = 'all_accounts'

/** The route's query as a search: one value to a key, the first where a link repeated it. */
export function searchQueryFrom(query: LocationQuery) {
  const search: SearchQuery = {}
  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first) search[key] = first
  }
  return search
}

export const hasSearchConditions = (query: SearchQuery) =>
  Object.keys(query).some((key) => key !== SCOPE_KEY)

/** The query with one filter set, or taken off when it has no value. */
export function withFilter(query: SearchQuery, key: string, value?: string) {
  const next = { ...query }
  if (value) next[key] = value
  else delete next[key]
  return next
}

/** The filter on when it is off, off when it is already this answer. */
export const toggledFilter = (query: SearchQuery, key: string, value: string) =>
  withFilter(query, key, query[key] === value ? undefined : value)

/** Just the words and the scope: every filter off. */
export function withoutFilters(query: SearchQuery) {
  const next: SearchQuery = {}
  if (query.text) next.text = query.text
  if (query[SCOPE_KEY]) next[SCOPE_KEY] = query[SCOPE_KEY]
  return next
}

/** A folder belongs to one account, so it cannot survive the widening. */
export function withAllAccounts(query: SearchQuery, allAccounts: boolean): SearchQuery {
  const next = withFilter(query, SCOPE_KEY, allAccounts ? '1' : undefined)
  if (allAccounts) delete next.inMailbox
  return next
}

/**
 * The query after the words on the query line were edited. Operators typed there become filters,
 * replacing the same filter already set; anything not typed again is left alone, since the words
 * are all the line holds.
 */
export function withEditedLine(query: SearchQuery, line: string): SearchQuery {
  const { text, ...typed } = parseMailSearchQuery(line.trim())
  return withFilter({ ...query, ...typed }, 'text', text)
}

const isoDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')

export type DatePreset = 'week' | 'month' | 'quarter' | 'year'

/** The first day of a recent stretch, as the bare day the route stores. */
export function datePresetStart(preset: DatePreset, today = new Date()): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (preset === 'week') start.setDate(start.getDate() - 7)
  if (preset === 'month') start.setMonth(start.getMonth() - 1)
  if (preset === 'quarter') start.setMonth(start.getMonth() - 3)
  if (preset === 'year') start.setFullYear(start.getFullYear() - 1)
  return isoDay(start)
}

/** Which preset a query's dates are, if they are one: a custom range matches none. */
export function activeDatePreset(query: SearchQuery, today = new Date()): DatePreset | undefined {
  if (!query.after || query.before) return undefined
  return (['week', 'month', 'quarter', 'year'] as const).find(
    (preset) => datePresetStart(preset, today) === query.after,
  )
}

/**
 * The words a row or a message marks: those the server found, as the mail spells them, which stemming
 * can make other than what was typed, and those typed, for matches in a sender's name. The quotes
 * of a phrase are the query's punctuation, not something to look for.
 */
export function searchWords(typed: string | undefined, marked: string[] | undefined): string {
  return [...(marked ?? []), (typed ?? '').replace(/"/g, ' ')].join(' ').trim()
}
