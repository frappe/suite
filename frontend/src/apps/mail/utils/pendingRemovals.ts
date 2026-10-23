import { api, client } from '@/api'

/**
 * A permanent removal waiting out its Undo (see commitAfterUndo), written down so it outlives the
 * page. A page closed inside the window cannot send it — the request is a few awaits away from the
 * network, and the page is gone first — so the next start sends what was left. An unsubscribe waits
 * the same way: once it reaches the sender it can't be taken back either.
 */
export type PendingRemoval =
  | { kind: 'messages'; names: string[] }
  | { kind: 'draft'; account: string; id: string }
  | { kind: 'unsubscribe'; account: string; id: string }

const KEY = 'suite.mail.pendingRemovals'

// How long after it is written a removal counts as abandoned rather than still inside a live tab's
// Undo window. Longer than the toast, with room to spare.
const UNDO_WINDOW_MS = 15_000

// `due`: when the removal stops being anyone's to undo. Before then another tab may still be
// offering Undo on it, and only that tab can send it. `tab` and `page`: the tab that wrote it, and
// which load of its page. A tab that was reloaded finds its own here from an earlier load, and those
// it can send at once: the Undo they waited on went with that page, and while they wait the draft is
// back on screen to be written in again. One from this same load is still on offer — the layout can
// mount again without a reload (a phone's compose page closing) — and waits like any other.
type Stored = Record<string, { removal: PendingRemoval; due: number; tab?: string; page?: string }>

// This load of the page: a new one each time the app starts.
const PAGE = Math.random().toString(36).slice(2)

const TAB_KEY = 'suite.mail.tab'
// Per tab and kept across its reloads, which is what sessionStorage is. Nothing without it: every
// removal then waits to be due, as before.
const thisTab = (): string => {
  try {
    let id = sessionStorage.getItem(TAB_KEY)
    if (!id) sessionStorage.setItem(TAB_KEY, (id = Math.random().toString(36).slice(2)))
    return id
  } catch {
    return ''
  }
}

const read = (): Stored => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>
    // An entry written before removals carried a due time is the removal itself: long overdue.
    return Object.fromEntries(
      Object.entries(raw).map(([key, entry]) => [
        key,
        entry && typeof entry === 'object' && 'kind' in entry
          ? { removal: entry as PendingRemoval, due: 0 }
          : (entry as Stored[string]),
      ]),
    )
  } catch {
    return {}
  }
}
const write = (stored: Stored) => {
  try {
    if (Object.keys(stored).length) localStorage.setItem(KEY, JSON.stringify(stored))
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the removal only lives as long as the page, as before.
  }
}

export const sendRemoval = (removal: PendingRemoval): Promise<unknown> => {
  if (removal.kind === 'unsubscribe')
    return client.mutation(api.mail.messages.unsubscribe, {
      account: removal.account,
      id: removal.id,
    })
  if (removal.kind === 'draft')
    return client.mutation(api.mail.messages.deleteDraft, {
      account: removal.account,
      id: removal.id,
    })
  // Nothing on the server to remove — a draft never saved.
  if (!removal.names.length) return Promise.resolve()
  return client.mutation(api.mail.messages.delete, { names: removal.names })
}

/** Writes the removal down; returns the key to forget it by. */
export const rememberRemoval = (removal: PendingRemoval): string => {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  write({
    ...read(),
    [key]: { removal, due: Date.now() + UNDO_WINDOW_MS, tab: thisTab(), page: PAGE },
  })
  return key
}

export const forgetRemoval = (key: string) => {
  const { [key]: _forgotten, ...rest } = read()
  write(rest)
}

/**
 * Sends what a closed page left once its Undo window is over. One not yet due may belong to another
 * tab still offering Undo on it, so it is looked at again when due: by then that tab has sent or
 * forgotten it, and whatever is still here was abandoned. A removal the server has already carried
 * out, or refuses, is let go — retrying it on every start would help nobody.
 */
export const resumeRemovals = async (
  onSent?: () => void,
  /** Keeps a draft off the lists while its removal is on the way, and lets it back if refused. */
  drafts?: { hold: (id: string) => void; release: (id: string) => void },
): Promise<void> => {
  const now = Date.now()
  const tab = thisTab()
  const entries = Object.entries(read())
  const leftByReload = (entry: Stored[string]) => !!tab && entry.tab === tab && entry.page !== PAGE
  const due = entries.filter(([, entry]) => entry.due <= now || leftByReload(entry))
  const draftId = (removal: PendingRemoval) => (removal.kind === 'draft' ? removal.id : undefined)
  for (const [, entry] of due) {
    const id = draftId(entry.removal)
    if (id) drafts?.hold(id)
  }
  // Forgotten once the request is done, not before: a page closed mid-request leaves it for the
  // next start. Two tabs resuming at once may both send it; the second is refused and let go.
  for (const [key, entry] of due) {
    await sendRemoval(entry.removal).catch(() => {
      const id = draftId(entry.removal)
      if (id) drafts?.release(id)
    })
    forgetRemoval(key)
  }
  if (due.length) onSent?.()
  const next = Math.min(...entries.filter(([, entry]) => entry.due > now).map(([, e]) => e.due))
  if (Number.isFinite(next)) setTimeout(() => void resumeRemovals(onSent, drafts), next - now + 50)
}
