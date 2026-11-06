/**
 * A new event another area asks for, filled in from what it was looking at — a mail, say.
 *
 * Held here between the asking and the form opening rather than put in the URL: what it carries is
 * someone's mail, and a URL is kept in history and passed around. Taken once, so a reload or Back
 * opens an empty form, as `?new=1` alone does.
 */
export interface NewEventDraft {
  title?: string
  description?: string
  participants?: readonly { email: string; name?: string }[]
}

let pending: NewEventDraft | undefined

export const holdNewEventDraft = (draft: NewEventDraft) => {
  pending = draft
}

export const takeNewEventDraft = (): NewEventDraft | undefined => {
  const draft = pending
  pending = undefined
  return draft
}
