import { describe, expect, it } from 'vitest'

import type { MailReaction } from '@/apps/mail/types'
import { groupReactions, hasReacted, reactionButtonSpot } from '@/apps/mail/utils/reactions'

const reaction = (emoji: string, from_email: string, from_name = ''): MailReaction => ({
  emoji,
  from_email,
  from_name,
})

const own = new Set(['me@frappe.io'])

describe('groupReactions', () => {
  it('makes one chip per emoji, counting the people in it', () => {
    const groups = groupReactions(
      [
        reaction('😂', 'a@x.io', 'Ana'),
        reaction('🎉', 'a@x.io', 'Ana'),
        reaction('😂', 'b@x.io', 'Bo'),
      ],
      own,
    )
    expect(groups.map((g) => [g.emoji, g.count, g.who])).toEqual([
      ['😂', 2, 'Ana, Bo'],
      ['🎉', 1, 'Ana'],
    ])
  })

  it('names the reader as You and first, however their address is cased', () => {
    const [group] = groupReactions(
      [reaction('😂', 'a@x.io', 'Ana'), reaction('😂', 'ME@frappe.io', 'Me')],
      own,
    )
    expect(group.who).toBe('You, Ana')
    expect(group.mine).toBe(true)
  })

  it('does not mark a chip only other people are in as the reader’s', () => {
    expect(groupReactions([reaction('😂', 'a@x.io')], own)[0].mine).toBe(false)
  })

  it('counts a heart with and without its variation selector as one chip', () => {
    const groups = groupReactions([reaction('❤️', 'a@x.io'), reaction('❤', 'b@x.io')], own)
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
  })

  it('falls back to the address when there is no name', () => {
    expect(groupReactions([reaction('😂', 'a@x.io')], own)[0].who).toBe('a@x.io')
  })

  it('has nothing to show for a message with no reactions', () => {
    expect(groupReactions(undefined, own)).toEqual([])
  })
})

describe('hasReacted', () => {
  const reactions = [reaction('❤️', 'me@frappe.io'), reaction('😂', 'a@x.io')]

  it('finds the reader’s own reaction, however the emoji is written', () => {
    expect(hasReacted(reactions, '❤', own)).toBe(true)
  })

  it('does not count someone else’s reaction as the reader’s', () => {
    expect(hasReacted(reactions, '😂', own)).toBe(false)
  })
})

describe('reactionButtonSpot', () => {
  it('sits beside the chips once a message has any, wherever it is in the conversation', () => {
    expect(reactionButtonSpot(true, true)).toBe('chips')
    expect(reactionButtonSpot(true, false)).toBe('chips')
  })

  it('sits beside Forward on the last message with no reactions', () => {
    expect(reactionButtonSpot(false, true)).toBe('bar')
  })

  it('sits in the header of an earlier message with no reactions', () => {
    expect(reactionButtonSpot(false, false)).toBe('header')
  })
})
