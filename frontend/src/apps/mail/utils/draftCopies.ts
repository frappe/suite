import type { Attachment, DraftRecipient } from '@/apps/mail/types'

/**
 * The copy of a draft this browser keeps while the server cannot take it.
 *
 * Only then: written when a save fails, and removed once a save lands. Ordinary saving puts no mail
 * text on the device. What it holds is the writing and the addressing, plus references to files
 * already uploaded — never file contents, so an upload that had not finished can only be named.
 *
 * Every access is guarded: storage can be blocked or full, and compose has to go on working then.
 * A write that fails says so, because the composer warns before leaving when nothing is kept.
 */
export interface DraftCopy {
  /** The composition this is a copy of. Survives the id changes each save makes. */
  key: string
  user: string
  account: string
  /** The ids the draft has had on the server, latest first. Empty if it never reached it. */
  ids: string[]
  savedAt: number
  /** Files still uploading when it was written. They are not in the copy. */
  uploading: string[]
  mail: DraftCopyMail
}

export interface DraftCopyMail {
  from_email?: string
  to: DraftRecipient[]
  cc: DraftRecipient[]
  bcc: DraftRecipient[]
  subject: string
  html_body: string
  quoted_content: string
  attachments: Attachment[]
  in_reply_to: string
  in_reply_to_id: string
  forwarded_from_id: string
}

const PREFIX = 'suite.mail.draftCopy.v1'
// Long enough to come back after a weekend away, short enough that a forgotten copy doesn't sit on a
// device indefinitely.
export const DRAFT_COPY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const storageKey = (user: string, account: string, key: string) =>
  `${PREFIX}:${encodeURIComponent(user)}:${encodeURIComponent(account)}:${key}`
const userPrefix = (user: string) => `${PREFIX}:${encodeURIComponent(user)}:`

const storedKeys = (prefix: string): string[] => {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith(prefix))
  } catch {
    return []
  }
}

const removeStored = (key: string) => {
  try {
    localStorage.removeItem(key)
  } catch {
    /* Blocked storage holds nothing to remove. */
  }
}

const parse = (raw: string | null): DraftCopy | undefined => {
  if (!raw) return undefined
  try {
    const copy = JSON.parse(raw) as DraftCopy
    return copy?.key && copy.mail && typeof copy.savedAt === 'number' ? copy : undefined
  } catch {
    return undefined
  }
}

const isExpired = (copy: DraftCopy, now: number) => now - copy.savedAt > DRAFT_COPY_MAX_AGE_MS

/** Whether the copy is now on the device. */
export const writeDraftCopy = (copy: DraftCopy): boolean => {
  try {
    localStorage.setItem(storageKey(copy.user, copy.account, copy.key), JSON.stringify(copy))
    return true
  } catch {
    return false
  }
}

export const removeDraftCopy = (user: string, account: string, key: string) =>
  removeStored(storageKey(user, account, key))

/** This user's copies, newest first. Anything expired or unreadable goes on the way past. */
export const listDraftCopies = (user: string, now = Date.now()): DraftCopy[] => {
  // Every user's expired copies, not only this one's: nobody else is going to clear them.
  for (const key of storedKeys(`${PREFIX}:`)) {
    try {
      const copy = parse(localStorage.getItem(key))
      if (!copy || isExpired(copy, now)) removeStored(key)
    } catch {
      /* Blocked storage holds nothing to expire. */
    }
  }
  const copies: DraftCopy[] = []
  for (const key of storedKeys(userPrefix(user))) {
    try {
      const copy = parse(localStorage.getItem(key))
      if (copy) copies.push(copy)
    } catch {
      /* Blocked storage holds nothing to list. */
    }
  }
  return copies.sort((a, b) => b.savedAt - a.savedAt)
}

/** The copy of a draft opened by id, under any id it has had. */
export const findDraftCopy = (user: string, account: string, id: string) =>
  listDraftCopies(user).find((copy) => copy.account === account && copy.ids.includes(id))

export const clearDraftCopies = (user: string) => storedKeys(userPrefix(user)).forEach(removeStored)

// Which copies a live composer still answers for. Held for as long as it runs, and let go by the
// browser if the tab dies: exactly the line between a copy another tab is working on, and one that
// is waiting to be recovered. A browser without Web Locks treats every copy as waiting.
const lockName = (key: string) => `${PREFIX}:${key}`

export const holdDraftCopy = (key: string): (() => void) => {
  if (typeof navigator === 'undefined' || !navigator.locks) return () => {}
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  navigator.locks.request(lockName(key), () => held).catch(() => {})
  return release
}

export const heldDraftCopyKeys = async (): Promise<Set<string>> => {
  try {
    const { held = [] } = await navigator.locks.query()
    return new Set(
      held
        .map((lock) => lock.name ?? '')
        .filter((name) => name.startsWith(`${PREFIX}:`))
        .map((name) => name.slice(PREFIX.length + 1)),
    )
  } catch {
    return new Set()
  }
}
