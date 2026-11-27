import { afterEach, describe, expect, it } from 'vitest'

import {
  clearRecentEmojis,
  emojiLabel,
  findColonQuery,
  insertEmojiAtQuery,
  rememberEmoji,
  suggestEmojis,
} from '../emojiSuggest'

afterEach(() => {
  clearRecentEmojis()
})

describe('findColonQuery', () => {
  it('finds trailing colon query', () => {
    expect(findColonQuery('hi :smi', 7)).toEqual({ start: 3, query: 'smi' })
  })

  it('returns null when no colon query', () => {
    expect(findColonQuery('hello', 5)).toBeNull()
  })

  it('does not match URL schemes', () => {
    expect(findColonQuery('http://example.com', 18)).toBeNull()
  })
})

describe('suggestEmojis', async () => {
  it('ranks exact and prefix matches first', async () => {
    const hits = await suggestEmojis('fire')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].name).toBe('fire')
    expect(hits[0].emoji).toBe('🔥')
  })

  it('supports the thumbsup alias and names skin-tone variants', async () => {
    expect((await suggestEmojis('thumbsup'))[0]).toEqual({ name: 'thumbsup', emoji: '👍' })
    expect(emojiLabel('👍🏽')).toBe('thumbs up')
  })

  it('empty query with no recents falls back to default suggestions', async () => {
    const defaults = await suggestEmojis('')
    expect(defaults).toHaveLength(5)
    // Same ranking as the old empty-query filter (shortest matching names first).
    expect(defaults.every((d) => d.emoji && d.name)).toBe(true)
  })

  it('empty query puts recents first and pads to five with defaults', async () => {
    rememberEmoji({ name: 'fire', emoji: '🔥' })
    rememberEmoji({ name: 'thumbsup', emoji: '👍' })
    const hits = await suggestEmojis('')
    expect(hits).toHaveLength(5)
    expect(hits[0]).toEqual({ name: 'thumbsup', emoji: '👍' })
    expect(hits[1]).toEqual({ name: 'fire', emoji: '🔥' })
    // No duplicate glyphs when padding.
    const glyphs = hits.map((h) => h.emoji)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  it('keeps only the last five recents, most recent first', async () => {
    for (const [name, emoji] of [
      ['one', '1️⃣'],
      ['two', '2️⃣'],
      ['three', '3️⃣'],
      ['four', '4️⃣'],
      ['five', '5️⃣'],
      ['six', '6️⃣'],
    ] as const) {
      rememberEmoji({ name, emoji })
    }
    const recent = await suggestEmojis('')
    expect(recent).toHaveLength(5)
    expect(recent.map((r) => r.name)).toEqual(['six', 'five', 'four', 'three', 'two'])
  })

  it('moves a re-used emoji to the front', async () => {
    rememberEmoji({ name: 'fire', emoji: '🔥' })
    rememberEmoji({ name: 'wave', emoji: '👋' })
    rememberEmoji({ name: 'fire', emoji: '🔥' })
    const hits = await suggestEmojis('')
    expect(hits).toHaveLength(5)
    expect(hits[0]).toEqual({ name: 'fire', emoji: '🔥' })
    expect(hits[1]).toEqual({ name: 'wave', emoji: '👋' })
  })
})

describe('insertEmojiAtQuery', () => {
  it('replaces :query with the emoji', () => {
    const { text, caret } = insertEmojiAtQuery('hi :smile', 9, 3, '😄')
    expect(text).toBe('hi 😄')
    expect(caret).toBe(5)
  })
})
