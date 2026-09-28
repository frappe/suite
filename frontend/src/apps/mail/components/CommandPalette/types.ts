export interface MailSearchFilterBadge {
	key: string
	value: string
	displayValue: string
}

/**
 * A search the reader ran before, kept in the browser for the phone's empty search page. The
 * words as typed and the badges as applied, so restoring one puts back exactly what ran; the
 * label is what it read as, built when it was remembered so the row need not rebuild it.
 */
export interface MailRecentSearch {
	resultType: 'mail-recent-search'
	text: string
	filters: Record<string, string>
	label: string
	/** The account it was run against, which is the one its folder filter belongs to. */
	account?: string
	/** When it was last run. */
	at: number
}

export interface MailContactSuggestion {
	resultType: 'mail-contact'
	value: string
	label: string
	email: string
	name?: string
	user_image?: string
}

export interface MailFilterSuggestion {
	resultType: 'mail-filter-suggestion'
	value: string
	label: string
	filterKey: string
	filterValue: string
	icon: string
	iconClass?: string
}

export interface MailSearchResult {
	resultType: 'mail'
	account: string
	thread_id: string
	subject?: string
	from_name?: string
	from_email: string
	recipients?: Recipient[]
	mailboxes?: Mailbox[]
	attachments?: Attachment[]
	received_at?: string
}
import type { Attachment, Mailbox, Recipient } from '@/apps/mail/types'
