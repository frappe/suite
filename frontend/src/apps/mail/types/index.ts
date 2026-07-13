import type { UserAccount } from './doctypes'

export * from './doctypes'

export type COLOR_SCHEME = 'System Default' | 'Light Mode' | 'Dark Mode'

// What happens to a sender when one of their messages is marked as Junk (JMAP Account).
export type OnMarkAsJunk = "Junk Sender's Mail" | 'Ask to Block Sender'

// A screened sender: how their future mail is handled. 'Reject' discards it silently; 'Spam' files
// it into the Spam (Junk) folder; 'Accepted' lets it reach the inbox. (Doctype: Screened Email Address.)
export type ScreeningAction = 'Reject' | 'Spam' | 'Accepted'

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

// A row in the Screener: one unique sender in the Screening folder, summarised by their latest mail.
export interface ScreeningSender {
	from_email: string
	from_name: string
	subject: string
	preview: string
	received_at: number
	count: number
	unread: number
}

export interface User {
	name: string
	email: string
	full_name: string
	user_type: string

	username: string | null
	user_image: string | null
	api_key: string | null
	user_settings?: string
	color_scheme?: COLOR_SCHEME
	group_messages_by?: 'None' | 'Day' | 'Month'
	show_reading_pane?: 0 | 1

	enabled: boolean
	is_mail_admin: boolean
	is_system_manager: boolean
	is_jmap_configured: boolean

	mailboxes: { id: string; name: string; role: string }[]
	// `get_user_info` enriches each account with its per-account outgoing default and
	// JMAP Account doc name (the fields moved off User Settings).
	accounts: (UserAccount & {
		default_outgoing_email?: string
		jmap_account?: string
		on_mark_as_junk?: OnMarkAsJunk
		enable_screening?: boolean
		block_remote_images?: boolean
	})[]
}

export interface UserResource {
	data: User
	promise: Promise<User>
	reload: () => void
}

export interface Recipient {
	type: 'To' | 'Cc' | 'Bcc'
	email: string
	display_name: string | null
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
	size: string
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
	mailboxes: Mailbox[]
	recipients: Recipient[]
	groupedRecipients: {
		to: Recipient[]
		cc: Recipient[]
		bcc: Recipient[]
	}
	reply_to: { display_name: string; email: string }[]
	attachments: Attachment[]
	user_image?: string
	collapsed?: boolean
}

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
	// Populated only by the All Inboxes view (get_all_inbox_threads): the owning account's display
	// name and its Inbox/Archive/Trash mailbox ids, so a merged row can be opened in / acted on
	// within the correct JMAP account.
	account_name?: string
	inbox?: string
	archive?: string
	trash?: string
	id: string
	thread_id: string
	from_name: string
	from_email: string
	subject: string | null
	preview: string | null
	has_attachment: 0 | 1
	received_at: string
	mailboxes: Mailbox[]
	recipients: Recipient[]
	seen: 0 | 1
	draft: 0 | 1
	junk: 0 | 1
	flagged: 0 | 1
	answered: 0 | 1
	forwarded: 0 | 1
	attachments: Attachment[]
	user_image?: string
	messages: Mail[]
}

export interface MailboxData {
	name: string
	id: string
	role: string | null
	total_threads: number
	unread_threads: number
	_name: string
	subscribed: 0 | 1
	icon?: string
	color?: 'Blue' | 'Green' | 'Amber' | 'Red' | 'Purple'
	disable_push_notification?: 0 | 1
	automation_rules?: AutomationRules | null
}

export interface AutomationRules {
	emails_from: string
	subject_contains: string
	match_if: 'any' | 'all'
	mark_as_read: boolean
	add_star: boolean
}

export interface NotificationPayload {
	data?: {
		title?: string
		body?: string
		notification_icon?: string
		click_action?: string
	}
}
