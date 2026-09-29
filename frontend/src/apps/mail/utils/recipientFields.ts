import type { ComposeMailData, DraftRecipient } from '@/apps/mail/types'

/** The three lists an address can sit in on a draft. */
export type RecipientField = 'to' | 'cc' | 'bcc'

export const RECIPIENT_FIELDS: RecipientField[] = ['to', 'cc', 'bcc']

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Moving one address from one of the draft's recipient lists to another.
 *
 * One function doing both halves, rather than an add on the field it lands in and a remove on the
 * field it left: the two gestures that ask for this — a drag on desktop, the chip's menu on a
 * phone — each start in one field and finish in another, and splitting the move between the two
 * components is what made the drag carry a module-level "did it land?" flag between them.
 *
 * Mutates the draft in place: the arrays are the recipient fields' own models, and replacing them
 * would leave those fields bound to lists nothing else reads.
 */
export const moveRecipient = (
	draft: ComposeMailData,
	email: string,
	from: RecipientField,
	to: RecipientField,
) => {
	if (from === to) return

	const source = draft[from] ?? []
	const index = source.findIndex((recipient) => sameAddress(recipient.email, email))
	if (index === -1) return

	const [moved] = source.splice(index, 1)
	const target: DraftRecipient[] = (draft[to] ??= [])
	// Already addressed there, spelled differently or not: moving them is then only a matter of
	// taking them out of the field they came from.
	if (!target.some((recipient) => sameAddress(recipient.email, moved.email))) target.push(moved)
}
