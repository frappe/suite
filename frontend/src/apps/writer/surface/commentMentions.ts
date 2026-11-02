/**
 * Mentions in comment text. Drive notifies the people a comment names as
 * `@[user]`; a comment box shows each of them as "@Name" instead.
 */

/** A person picked in one comment box, and the name the box shows for them. */
export interface PickedPerson {
  user: string
  label: string
}

/** A run of comment text, or a person it mentions. */
export interface CommentPart {
  text: string
  user: string | null
}

interface MentionQuery {
  query: string
  /** Where its `@` sits. */
  start: number
}

const QUERY_BEFORE_CARET = /(?:^|[\s(])@([^\s@]*)$/
// The mention form Drive reads, at the user id lengths it accepts
const TOKEN = /@\[([^\]\r\n]{1,140})\]/g
const SPECIAL = /[.*+?^${}()|[\]\\]/g
// Some browsers send the Enter that ends a composition as this key code, without isComposing
const IME_KEY_CODE = 229

/** True for a key that belongs to a word still being composed. */
export function isComposing(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === IME_KEY_CODE
}

/** The text typed after an `@` that starts a word, up to the caret; null outside one. */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const match = QUERY_BEFORE_CARET.exec(text.slice(0, caret))
  if (!match) {
    return null
  }

  const [, query = ''] = match
  return { query, start: caret - query.length - 1 }
}

/** A person's name in the box; their user id when another picked person has the same name. */
export function labelFor(user: string, name: string, picked: PickedPerson[]) {
  const same = picked.find((other) => other.user === user)
  if (same) {
    return same.label
  }

  const label = name.trim()
  const isTaken = picked.some((other) => other.label === label)
  if (isTaken || !label) {
    return user
  }

  return label
}

/** The people a stored text mentions, named as a box shows them; with `mentions`, only those people count. */
export function pickedIn(content: string, nameOf: (user: string) => string, mentions?: string[]) {
  const picked: PickedPerson[] = []
  for (const [, user = ''] of content.matchAll(TOKEN)) {
    let mentioned: string | undefined = user
    if (mentions) {
      mentioned = mentions.find((mention) => mention.toLowerCase() === user.toLowerCase())
    }

    if (mentioned === undefined) {
      continue
    }

    const label = labelFor(user, nameOf(mentioned), picked)
    picked.push({ user, label })
  }

  return picked
}

/** The stored text shown in a box: each picked person's mention as "@Name". */
export function fromTokens(text: string, picked: PickedPerson[]) {
  const labels = new Map(picked.map((person) => [person.user, person.label]))
  return text.replace(TOKEN, (token, user: string) => {
    const label = labels.get(user)
    if (!label) {
      return token
    }

    return `@${label}`
  })
}

// A whole picked name after an `@`, the longest first, so "@Ann" stays apart from "@Ann Lee"
function labelPattern(picked: PickedPerson[]) {
  const labels = [...new Set(picked.map((person) => person.label))]
    .sort((first, second) => second.length - first.length)
    .map((label) => label.replace(SPECIAL, '\\$&'))
  const alternatives = labels.join('|')
  return new RegExp(`@(${alternatives})(?![\\p{L}\\p{N}])`, 'gu')
}

/** The text a box stores: each picked person's "@Name" as their mention. */
export function toTokens(text: string, picked: PickedPerson[]) {
  if (!picked.length) {
    return text
  }

  const users = new Map(picked.map((person) => [person.label, person.user]))
  return text.replace(labelPattern(picked), (_name, label: string) => {
    const user = users.get(label)
    return `@[${user}]`
  })
}

/** The text split around its mentions; with `mentions`, only those people count. */
export function toParts(content: string, mentions?: string[]): CommentPart[] {
  const parts: CommentPart[] = []
  let from = 0
  for (const match of content.matchAll(TOKEN)) {
    const [token, user = ''] = match
    let mentioned: string | undefined = user
    if (mentions) {
      mentioned = mentions.find((mention) => mention.toLowerCase() === user.toLowerCase())
    }

    if (mentioned === undefined) {
      continue
    }

    parts.push(
      { text: content.slice(from, match.index), user: null },
      { text: token, user: mentioned },
    )
    from = match.index + token.length
  }

  parts.push({ text: content.slice(from), user: null })
  return parts.filter((part) => part.text)
}
