import { toParts } from './commentMentions'

// Saving a new comment can stamp `modified` a moment after `creation`
const EDIT_AFTER_MS = 1000
const EXCERPT_LENGTH = 80

interface Stamped {
  creation: string | null
  modified: string | null
}

/** True once a comment's text was changed after it was posted. Drive changes a comment only on an edit. */
export function isEdited(comment: Stamped) {
  if (!comment.creation || !comment.modified) {
    return false
  }

  const gap = new Date(comment.modified).getTime() - new Date(comment.creation).getTime()
  return gap > EDIT_AFTER_MS
}

/** A comment's text on one short line, each mention as "@Name", for a dialog that names it. */
export function commentExcerpt(
  content: string,
  mentions: string[],
  nameOf: (user: string) => string,
) {
  const parts = toParts(content, mentions)
  const text = parts
    .map((part) => (part.user ? `@${nameOf(part.user)}` : part.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= EXCERPT_LENGTH) {
    return text
  }

  return `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
}
