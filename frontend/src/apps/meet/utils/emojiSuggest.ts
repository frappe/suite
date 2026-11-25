import { gemoji } from 'gemoji'

import { readJSON, remove, writeJSON } from '@/utils/localStorage'

export type EmojiSuggestion = {
  name: string
  emoji: string
}

const EMOJIS: EmojiSuggestion[] = gemoji.flatMap((entry) =>
  entry.names.map((name) => ({ name, emoji: entry.emoji })),
)

const RECENT_STORAGE_KEY = 'meet-chat-recent-emojis'
const RECENT_LIMIT = 5

const COLON_QUERY = /:([a-zA-Z0-9_+-]*)$/

export function findColonQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = before.match(COLON_QUERY)
  if (!match || match.index === undefined) return null
  return { start: match.index, query: match[1] }
}

function readRecentStore(): EmojiSuggestion[] {
  try {
    const parsed = readJSON(RECENT_STORAGE_KEY)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is EmojiSuggestion =>
          !!item &&
          typeof item === 'object' &&
          'name' in item &&
          typeof item.name === 'string' &&
          'emoji' in item &&
          typeof item.emoji === 'string',
      )
      .slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

function writeRecentStore(items: EmojiSuggestion[]) {
  try {
    writeJSON(RECENT_STORAGE_KEY, items.slice(0, RECENT_LIMIT))
  } catch {}
}

function getRecentEmojis(): EmojiSuggestion[] {
  return readRecentStore()
}

export function rememberEmoji(item: EmojiSuggestion): void {
  const next = [
    { name: item.name, emoji: item.emoji },
    ...readRecentStore().filter((r) => r.emoji !== item.emoji),
  ].slice(0, RECENT_LIMIT)
  writeRecentStore(next)
}

function filterEmojis(query: string, limit: number): EmojiSuggestion[] {
  const needle = query.toLowerCase()
  return EMOJIS.filter((item) => item.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()
      if (aName === needle && bName !== needle) return -1
      if (bName === needle && aName !== needle) return 1
      if (aName.startsWith(needle) && !bName.startsWith(needle)) return -1
      if (bName.startsWith(needle) && !aName.startsWith(needle)) return 1
      return aName.length - bName.length
    })
    .slice(0, limit)
}

export function suggestEmojis(query: string, limit = RECENT_LIMIT): EmojiSuggestion[] {
  if (!query) {
    const recent = getRecentEmojis().slice(0, limit)
    if (recent.length === 0) return filterEmojis('', limit)
    if (recent.length >= limit) return recent

    const used = new Set(recent.map((r) => r.emoji))
    const padding = filterEmojis('', limit * 4).filter((item) => !used.has(item.emoji))
    return [...recent, ...padding].slice(0, limit)
  }
  return filterEmojis(query, limit)
}
interface InsertEmojiAtQueryResult {
  text: string
  caret: number
}

export function insertEmojiAtQuery(
  text: string,
  caret: number,
  queryStart: number,
  emoji: string,
): InsertEmojiAtQueryResult {
  const next = text.slice(0, queryStart) + emoji + text.slice(caret)
  const nextCaret = queryStart + emoji.length
  return { text: next, caret: nextCaret }
}

export function clearRecentEmojis(): void {
  try {
    remove(RECENT_STORAGE_KEY)
  } catch {}
}
