import { SECONDARY_MAILBOX_ROLES } from '@/apps/mail/stores/user'
import type { MailboxData, UnifiedFolder } from '@/apps/mail/types'
import { getIcon } from '@/apps/mail/utils'

/**
 * The "All accounts" view: every account's folders merged into one list, a folder matched across
 * accounts by its slug (see mailbox_slug server-side) since mailbox ids are per account. It is a mode
 * of the sidebar's account switcher rather than an account, so it lives in the URL: the folder list
 * route and the thread route opened from it, which also names the thread's owning account.
 */
export const UNIFIED_ROUTE = 'mail-unified'
export const UNIFIED_THREAD_ROUTE = 'mail-unified-mail'

/** Starred is a keyword, not a mailbox, so it is the one unified folder named outright. */
export const STARRED_FOLDER = 'starred'
export const INBOX_FOLDER = 'inbox'

export const isUnifiedRoute = (name: unknown) =>
  name === UNIFIED_ROUTE || name === UNIFIED_THREAD_ROUTE

export const unifiedFolderRoute = (folder: string) => ({
  name: UNIFIED_ROUTE,
  params: { folder },
})

// Whether the reader last chose "All accounts", so /mail reopens it rather than a single account.
const UNIFIED_STORAGE_KEY = 'mail-unified'

export const rememberUnified = (unified: boolean) => {
  try {
    if (unified) localStorage.setItem(UNIFIED_STORAGE_KEY, '1')
    else localStorage.removeItem(UNIFIED_STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts as long as the URL does.
  }
}

export const prefersUnified = () => {
  try {
    return localStorage.getItem(UNIFIED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** The folder's name as the reader knows it. */
export const unifiedFolderLabel = (folder: string, folders?: UnifiedFolder[] | null) => {
  if (folder === STARRED_FOLDER) return __('Starred')
  return folders?.find((f) => f.slug === folder)?.name ?? folder
}

// ── A folder in the URL ─────────────────────────────────────────────────────────────────────────
// An account's folder routes go by the folder's slug too (`mailbox/sent`, not `mailbox/e`), while the
// pages behind them keep working in mailbox ids: the router translates at the edge (see routes.ts and
// the mail guard). Views that are not mailboxes — Starred, search — are already named outright.

const isMailbox = (param: unknown, mailboxes?: MailboxData[] | null) =>
  !!mailboxes?.some((m) => m.id === param)

/**
 * The URL param for an account's mailbox: its slug, unless another folder of the account shares it
 * ("Receipts" and "receipts") or it has none (the Screener), when the id stands in.
 */
export const mailboxParam = (mailboxId: string, mailboxes?: MailboxData[] | null) => {
  const slug = mailboxes?.find((m) => m.id === mailboxId)?.slug
  if (!slug) return mailboxId
  return mailboxes!.filter((m) => m.slug === slug).length === 1 ? slug : mailboxId
}

/**
 * The mailbox id a URL param names: the folder with that slug, else the param itself — an id from a
 * link made before folders were named, or a view that is not a mailbox.
 */
export const mailboxIdForParam = (param: unknown, mailboxes?: MailboxData[] | null): string => {
  const matches = mailboxes?.filter((m) => m.slug === param) ?? []
  if (matches.length === 1) return matches[0].id
  return String(param ?? '')
}

// Views on the mailbox routes that are not mailboxes, named outright.
const VIRTUAL_MAILBOXES = [STARRED_FOLDER, 'search']

// The folder the open URL names, remembered by id. A rename changes a folder's slug under the reader:
// the URL still says the old one, which no longer names anything, and the view was handed it as if it
// were an id and sat waiting on a mailbox that does not exist.
let opened: { accountId: string; param: string; id: string } | null = null

/**
 * The mailbox id the open URL names — as mailboxIdForParam, except that the folder it named a moment
 * ago is still the answer after a rename has taken its slug away.
 */
export const openedMailboxId = (
  accountId: unknown,
  param: unknown,
  mailboxes?: MailboxData[] | null,
): string => {
  const id = mailboxIdForParam(param, mailboxes)
  if (!mailboxes) return id
  if (isMailbox(id, mailboxes) || VIRTUAL_MAILBOXES.includes(id)) {
    opened = { accountId: String(accountId), param: String(param), id }
    return id
  }
  if (
    opened?.accountId === String(accountId) &&
    opened.param === param &&
    isMailbox(opened.id, mailboxes)
  )
    return opened.id
  return id
}

/**
 * Where the open URL should be now: the folder's current param, or null when it names no folder at
 * all any more (deleted, or a name that never was).
 */
export const currentMailboxParam = (
  accountId: unknown,
  param: unknown,
  mailboxes: MailboxData[],
): string | null => {
  const id = openedMailboxId(accountId, param, mailboxes)
  if (VIRTUAL_MAILBOXES.includes(id)) return id
  return isMailbox(id, mailboxes) ? mailboxParam(id, mailboxes) : null
}

/**
 * The unified folder an account's folder belongs to, so switching to "All accounts" keeps the reader
 * in the folder they were reading. Takes the URL param; Inbox when the view is not a folder at all.
 */
export const unifiedFolderFor = (param: unknown, mailboxes?: MailboxData[] | null) => {
  if (param === STARRED_FOLDER) return STARRED_FOLDER
  const id = mailboxIdForParam(param, mailboxes)
  return (isMailbox(id, mailboxes) && mailboxes!.find((m) => m.id === id)!.slug) || INBOX_FOLDER
}

/** The other way round: the account's mailbox for a unified folder, if it has one. */
export const mailboxForUnifiedFolder = (folder: unknown, mailboxes?: MailboxData[] | null) => {
  if (folder === STARRED_FOLDER) return STARRED_FOLDER
  return mailboxes?.find((m) => m.slug === folder)?.id
}

/**
 * The unified folders split as an account's folder list is — system folders, then custom ones, then
 * Junk/Archive/Trash — shared by the desktop sidebar and the mobile folder sheet so they can't drift.
 * Starred is left to the caller, which places it after the system folders.
 */
export const groupUnifiedFolders = (folders?: UnifiedFolder[] | null) => {
  const all = folders ?? []
  const isSecondary = (folder: UnifiedFolder) =>
    !!folder.role && SECONDARY_MAILBOX_ROLES.includes(folder.role)
  return {
    primary: all.filter((f) => f.role && !isSecondary(f)),
    custom: all.filter((f) => !f.role),
    secondary: all
      .filter(isSecondary)
      .sort(
        (a, b) =>
          SECONDARY_MAILBOX_ROLES.indexOf(a.role!) - SECONDARY_MAILBOX_ROLES.indexOf(b.role!),
      ),
  }
}

/** The folder's icon name, by the same rule as an account's folder (see getIcon). */
export const unifiedFolderIcon = (folder: string, folders?: UnifiedFolder[] | null) => {
  if (folder === STARRED_FOLDER) return 'star'
  const found = folders?.find((f) => f.slug === folder)
  if (!found) return 'folder'
  return getIcon({ role: found.role, icon: found.icon, _name: found.name } as MailboxData)
}
