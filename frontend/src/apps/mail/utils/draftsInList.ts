/**
 * A reply drafted inside a conversation, as that conversation's list row shows it while the editor
 * is open.
 *
 * The list cannot simply read again on each autosave: the thread pane is built from the rows the
 * list holds, and reading them again rebuilds it around the writer every couple of seconds (see
 * `payListDebt` in useComposeMail). So until the editor closes the row read the conversation as it
 * was before the reply was begun — no Draft, the last message's words. It reads its draft from here
 * instead, until the list's own copy has caught up (the row holds the draft by the id it was last
 * saved under) or the draft is sent or discarded.
 */
import { reactive } from 'vue'

import { findQuoteRoots } from '@/apps/mail/utils/quotedContent'

interface DraftInList {
  /** The id the draft was last saved under: each save replaces it, under a new one. */
  id: string
  preview: string
}

const drafts = reactive(new Map<string, DraftInList>())

// Thread ids are per account.
const key = (account: string, threadId: string) => `${account}|${threadId}`

// What the server's preview_from_html says of a body: its text, the quoted trail left out.
const previewOf = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const text = (root: Node) => (root.textContent ?? '').replace(/\s+/g, ' ').trim()
  const whole = text(doc.body)
  findQuoteRoots(doc).forEach((quote) => quote.remove())
  return text(doc.body) || whole
}

export const showDraftInList = (account: string, threadId: string, id: string, html: string) =>
  drafts.set(key(account, threadId), { id, preview: previewOf(html) })

export const forgetDraftInList = (account: string, threadId: string) =>
  drafts.delete(key(account, threadId))

interface Row {
  id: string
  thread_id: string
  messages?: readonly { id: string }[]
}

/** The draft this row should show, unless the row holds it already. */
export const draftInList = (account: string, row: Row): DraftInList | undefined => {
  const draft = drafts.get(key(account, row.thread_id))
  if (!draft || row.id === draft.id || row.messages?.some((m) => m.id === draft.id))
    return undefined
  return draft
}
