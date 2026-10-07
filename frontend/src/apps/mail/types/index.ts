import type { GetUserInfoOutput } from '../client/generated'

export * from './doctypes'
export type Identity = import('../client/generated').GetIdentitiesOutput[number]
export type SieveScript = import('../client/generated').GetSieveScriptsOutput[number]

// What happens to a sender when one of their messages is marked as Junk (JMAP Account).

// A screened sender: how their future mail is handled. 'Spam' blocks them, filing it into Junk;
// 'Accepted' lets it reach the inbox. (Doctype: Screened Email Address.)
export type ScreeningAction = 'Spam' | 'Accepted'
export interface ScreenedAddress {
  email: string
  action: ScreeningAction
  creation: string
  modified: string
}

// A JMAP push subscription (virtual doctype: Push Subscription). Each one registers a device/client
// with the JMAP server so it receives StateChange notifications. `name` is `user|id` and is the row
// key used by bulk_delete. `types` is a JSON string of the data types the client subscribes to.
export interface PushSubscription {
  user: string
  id: string
  name: string
  device_client_id: string
  expires: string | null
  types: string
  creation: string
  modified: string
}

export type User = NonNullable<import('../client/generated').GetUserInfoOutput>
export type UserAccount = User['accounts'][number]
export interface UserResource {
  data: User
  refetch(): Promise<GetUserInfoOutput | undefined>
}
export interface Recipient {
  type: 'To' | 'Cc' | 'Bcc'
  email: string
  display_name: string | null
}

// Everyone who has written in a thread, in the order they first wrote. Derived from the thread's own
// messages rather than served with it (see utils/participants), `is_self` included.
export interface ThreadParticipant {
  name: string
  email: string
  is_self: boolean
}
export interface Mailbox {
  mailbox: string
  mailbox_id: string
  mailbox_name: string
}
export interface Attachment {
  filename: string
  blob_id: string
  type: string
  size: number | string
  file_url: string | null
  disposition: string
  cid?: string
}
export interface Mail {
  name: string
  message_id: string
  id: string
  thread_id: string
  from_name: string
  from_email: string
  subject: string
  preview: string
  html_body: string
  text_body: string
  received_at: string
  draft: 0 | 1
  flagged: 0 | 1
  seen: 0 | 1
  junk: 0 | 1
  /** From a sender nobody has allowed or denied yet: waiting in the Inbox, marked new. */
  unscreened?: 0 | 1
  mailboxes: Mailbox[]
  recipients: Recipient[]
  groupedRecipients?: {
    to: Recipient[]
    cc: Recipient[]
    bcc: Recipient[]
  }
  reply_to: {
    display_name: string
    email: string
  }[]
  attachments: Attachment[]
  // Blob id of a bounce message's message/delivery-status part (see DeliveryStatusBanner).
  dsn_blob_id?: string | null
  // The other copies of this same message the account holds — see MailCopy.
  duplicates?: MailCopy[]
  user_image?: string
  collapsed?: boolean
  show?: boolean
}

/**
 * One of the copies a message left in the account, stripped to what acting on it takes.
 *
 * Mail you send to yourself lands twice: the copy saved in Sent and the one delivery filed. The
 * thread shows a single message for the pair (the server picks it — see collapse_duplicate_copies)
 * and hangs the copies it stands in for off it, so an action can still reach them. A body is never
 * copied here; it is the same message.
 */
export type MailCopy = Pick<
  Mail,
  | 'name'
  | 'id'
  | 'thread_id'
  | 'from_name'
  | 'from_email'
  | 'received_at'
  | 'mailboxes'
  | 'seen'
  | 'junk'
  | 'flagged'
  | 'draft'
>
export interface DraftRecipient {
  email: string
  display_name?: string
  image?: string
}
export interface ComposeMailData {
  name?: string
  id?: string
  from_email?: string
  to?: DraftRecipient[]
  cc?: DraftRecipient[]
  bcc?: DraftRecipient[]
  subject?: string
  quoted_content?: string
  html_body?: string
  attachments?: Attachment[]
  in_reply_to?: string
  in_reply_to_id?: string
  forwarded_from_id?: string
  type?: 'reply' | 'replyAll' | 'forward'
}
export interface Thread {
  name: string
  account: string
  // Populated by the cross-account views (the unified folders' get_unified_threads and search's
  // search_mails): the owning account's display name, the mailbox the row was listed from and the
  // account's Archive/Trash mailbox ids, so a merged row can be opened in / acted on within the
  // correct JMAP account.
  account_name?: string
  view_mailbox?: string
  inbox?: string
  archive?: string
  trash?: string
  id: string
  thread_id: string
  from_name: string
  from_email: string
  subject: string | null
  preview: string | null
  received_at: string
  mailboxes: Mailbox[]
  recipients: Recipient[]
  seen: 0 | 1
  draft: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  /** From a sender nobody has allowed or denied yet: waiting in the Inbox, marked new. */
  unscreened?: 0 | 1
  attachments: Attachment[]
  user_image?: string
  messages: Mail[]
}
export type MailboxData = import('../client/generated').GetMailboxesOutput[number]

/** One folder across all of the user's accounts, as get_unified_folders merges it. */
export type UnifiedFolder = import('../client/generated').GetUnifiedFoldersOutput[number]
export interface QuotaUsage {
  total: number
  used: number
  available: number
  used_percentage: number
  available_percentage: number
  unlimited: boolean
}
