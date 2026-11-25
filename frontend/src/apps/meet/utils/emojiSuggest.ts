import type { EmojiMartData } from '@emoji-mart/data'
import { shallowRef } from 'vue'

import { readJSON, remove, writeJSON } from '@/utils/localStorage'

export type EmojiSuggestion = {
  name: string
  emoji: string
}

const QUICK_EMOJI_LABELS = new Map([
  ['👍', 'thumbs up'],
  ['❤️', 'red heart'],
  ['😂', 'face with tears of joy'],
])

function indexCatalog(data: EmojiMartData) {
  const suggestions: EmojiSuggestion[] = []
  const labels = new Map<string, string>()
  for (const entry of Object.values(data.emojis)) {
    const emoji = entry.skins[0]?.native
    if (emoji) suggestions.push({ name: entry.id, emoji })
    for (const skin of entry.skins) {
      labels.set(skin.native, entry.name.toLowerCase())
    }
  }
  for (const [name, id] of Object.entries(data.aliases)) {
    const emoji = data.emojis[id]?.skins[0]?.native
    if (emoji) suggestions.push({ name, emoji })
  }
  return { suggestions, labels }
}

const catalog = shallowRef<ReturnType<typeof indexCatalog>>()
let catalogLoad: Promise<void> | undefined

export function loadEmojiCatalog(): Promise<void> {
  catalogLoad ??= import('@emoji-mart/data/sets/15/native.json')
    .then(({ default: data }) => {
      catalog.value = indexCatalog(data)
    })
    .catch(() => {
      catalogLoad = undefined
    })
  return catalogLoad
}

export function emojiLabel(emoji: string): string {
  return QUICK_EMOJI_LABELS.get(emoji) ?? catalog.value?.labels.get(emoji) ?? emoji
}

const RECENT_STORAGE_KEY = 'meet-chat-recent-emojis'
const RECENT_LIMIT = 5

/**
 * Match a trailing `:query` before the caret (same trigger as frappe-ui TipTap emoji).
 * Query is letters, digits, `_`, `+`, `-` only so `http://` never opens the menu.
 */
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
  } catch {
    // private mode / quota — ignore
  }
}

/** Most recently used first, up to 5. */
function getRecentEmojis(): EmojiSuggestion[] {
  return readRecentStore()
}

/** Push an emoji to the front of recents (deduped by glyph). */
export function rememberEmoji(item: EmojiSuggestion): void {
  const next = [
    { name: item.name, emoji: item.emoji },
    ...readRecentStore().filter((r) => r.emoji !== item.emoji),
  ].slice(0, RECENT_LIMIT)
  writeRecentStore(next)
}

/** Substring filter + ranking: exact name → prefix → shorter names; cap at limit. */
function filterEmojis(query: string, limit: number): EmojiSuggestion[] {
  const needle = query.toLowerCase()
  return (catalog.value?.suggestions ?? [])
    .filter((item) => item.name.toLowerCase().includes(needle))
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

/**
 * Empty query → recent emojis first, padded with default top matches (no glyph
 * duplicates) so the menu always has up to `limit` rows.
 * Non-empty → name filter + ranking; cap at 5.
 */
export async function suggestEmojis(
  query: string,
  limit = RECENT_LIMIT,
): Promise<EmojiSuggestion[]> {
  await loadEmojiCatalog()
  if (!query) {
    const recent = getRecentEmojis().slice(0, limit)
    if (recent.length === 0) return filterEmojis('', limit)
    if (recent.length >= limit) return recent

    const used = new Set(recent.map((r) => r.emoji))
    // Fetch extra defaults so we still fill `limit` after dropping duplicates.
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

/** Test helper — clear recents without poking localStorage from callers. */
export function clearRecentEmojis(): void {
  try {
    remove(RECENT_STORAGE_KEY)
  } catch {
    // ignore
  }
}
