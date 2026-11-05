import type { MailReaction } from '@/apps/mail/types'

export interface ReactionGroup {
  emoji: string
  count: number
  /** Whether the reader is one of the people in this group. */
  mine: boolean
  /** Everyone who reacted with this emoji, reader first, for the chip's tooltip. */
  who: string
}

/** ❤ and ❤️ differ only in how they ask to be drawn, so they are one chip. */
const emojiKey = (emoji: string) => emoji.replaceAll('️', '')

/**
 * The reactions on one message, as the chips a reader counts.
 *
 * What arrives from the server is one entry per person and emoji; what a reader wants is one chip
 * per emoji with a count. The reader's own reaction is named "You" and put first in the tooltip.
 */
export function groupReactions(
  reactions: MailReaction[] | undefined,
  ownEmails: Set<string>,
  t: (text: string) => string = (text) => text,
): ReactionGroup[] {
  const groups = new Map<string, { emoji: string; names: string[]; mine: boolean }>()

  for (const reaction of reactions ?? []) {
    const key = emojiKey(reaction.emoji)
    const group = groups.get(key) ?? { emoji: reaction.emoji, names: [], mine: false }

    if (ownEmails.has((reaction.from_email ?? '').toLowerCase())) {
      group.mine = true
      group.names.unshift(t('You'))
    } else {
      // Named by address when there is no display name, so a chip never reads as nobody.
      group.names.push(reaction.from_name || reaction.from_email || t('Someone'))
    }

    groups.set(key, group)
  }

  return [...groups.values()].map(({ emoji, names, mine }) => ({
    emoji,
    mine,
    count: names.length,
    who: names.join(', '),
  }))
}

/** Whether the reader has already reacted to a message with this emoji. */
export function hasReacted(
  reactions: MailReaction[] | undefined,
  emoji: string,
  ownEmails: Set<string>,
): boolean {
  return (reactions ?? []).some(
    (reaction) =>
      emojiKey(reaction.emoji) === emojiKey(emoji) &&
      ownEmails.has((reaction.from_email ?? '').toLowerCase()),
  )
}

/**
 * Where a message offers adding a reaction, so that it only ever offers it once: beside its chips
 * once it has any, and otherwise beside Forward for the last message of the conversation, which is
 * the one that row acts on, or in the header for any other.
 *
 * A message with a draft after it is not the last, and the row beside Forward isn't showing.
 */
export function reactionButtonSpot(hasReactions: boolean, isLast: boolean) {
  if (hasReactions) return 'chips'
  return isLast ? 'bar' : 'header'
}
