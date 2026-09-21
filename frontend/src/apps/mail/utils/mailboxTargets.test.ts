import { describe, expect, it } from 'vitest'

import { canMoveToMailbox, commonMailboxIds } from './mailboxTargets'

const ids = {
	inbox: 'mb-inbox',
	sent: 'mb-sent',
	drafts: 'mb-drafts',
	screener: 'mb-screener',
	junk: 'mb-junk',
	trash: 'mb-trash',
	archive: 'mb-archive',
	receipts: 'mb-receipts',
}

const filedIn = (...mailboxIds: string[]) => ({
	mailboxes: mailboxIds.map((mailbox_id) => ({ mailbox_id })),
})

const trashed = filedIn(ids.trash)
const archived = filedIn(ids.archive)

describe('commonMailboxIds', () => {
	it('is where a lone thread sits', () => {
		expect(commonMailboxIds([filedIn(ids.inbox, ids.receipts)])).toEqual([
			ids.inbox,
			ids.receipts,
		])
	})

	it('keeps only what the whole selection shares', () => {
		expect(
			commonMailboxIds([filedIn(ids.inbox, ids.receipts), filedIn(ids.inbox, ids.archive)]),
		).toEqual([ids.inbox])
	})

	it('is empty when the selection shares nothing', () => {
		expect(commonMailboxIds([trashed, archived])).toEqual([])
	})

	it('is empty with nothing selected', () => {
		expect(commonMailboxIds([])).toEqual([])
	})
})

describe('canMoveToMailbox', () => {
	it('offers a folder the selection is not in', () => {
		expect(canMoveToMailbox(ids.receipts, [ids.trash], ids)).toBe(true)
	})

	it('refuses the folder the selection is already in', () => {
		expect(canMoveToMailbox(ids.trash, [ids.trash], ids)).toBe(false)
	})

	it('still offers a folder that holds only part of the selection', () => {
		// The intersection is empty, so the folder one of them sits in is somewhere the other can go.
		const filed = commonMailboxIds([trashed, archived])
		expect(canMoveToMailbox(ids.archive, filed, ids)).toBe(true)
	})

	it.each([
		['Sent', ids.sent],
		['Drafts', ids.drafts],
		['the Screener', ids.screener],
	])('never offers %s, which is not a folder anyone files into', (_name, mailboxId) => {
		expect(canMoveToMailbox(mailboxId, [], ids)).toBe(false)
	})

	it('offers nothing before the mailboxes resolve', () => {
		expect(canMoveToMailbox(undefined, [], ids)).toBe(false)
	})
})
