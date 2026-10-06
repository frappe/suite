import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
	accountId: 'own',
	// Bills is nested under Clients, and under Archive there is another folder of the same name.
	mailboxes: [
		{ id: 'a', role: 'inbox', _name: 'Inbox' },
		{ id: 'b', role: 'sent', _name: 'Sent Items' },
		{ id: 'c', role: null, _name: 'Clients' },
		{ id: 'd', role: null, _name: 'Bills', parent_id: 'c' },
		{ id: 'e', role: 'archive', _name: 'Archive' },
		{ id: 'f', role: null, _name: 'Bills', parent_id: 'e' },
		{ id: 'g', role: null, _name: 'sent' },
	] as { id: string; role: string | null; _name: string; parent_id?: string }[],
}))

// The user's own account and a team's, whose number skips the one an unlinked account had.
vi.mock('@/apps/mail/stores/user', () => ({
	userStore: () => ({
		accountId: state.accountId,
		userResource: {
			data: {
				accounts: [
					{ id: 'own', number: 0 },
					{ id: 'team', number: 2 },
				],
			},
		},
		mailboxes: { data: state.mailboxes },
	}),
}))

import {
	accountRoute,
	allInboxesRoute,
	mailboxRoute,
	routeIds,
	routeMailboxId,
	settleOpenMailbox,
} from './locations'

type Route = Parameters<typeof routeIds>[0]
const on = (name: string, params: Record<string, string>) => ({ name, params }) as unknown as Route

describe('the address of a mailbox', () => {
	it('is its role, whatever the server calls it', () => {
		expect(mailboxRoute('b')).toMatchObject({
			name: 'mail-mailbox',
			params: { account: '0', mailbox: 'sent' },
		})
	})

	it('is its name for a folder of the user, apart from the roles', () => {
		expect(mailboxRoute('g')).toMatchObject({ name: 'mail-folder', params: { mailbox: 'sent' } })
	})

	it('is its whole path for a nested folder, which tells two of one name apart', () => {
		expect(mailboxRoute('d').params.mailbox).toBe('Clients/Bills')
		expect(mailboxRoute('f').params.mailbox).toBe('Archive/Bills')
	})

	it('carries the open thread and the query', () => {
		expect(mailboxRoute('a', { threadID: 'T1', query: { filter: 'unread' } })).toEqual({
			name: 'mail-mail',
			params: { account: '0', mailbox: 'inbox', threadID: 'T1' },
			query: { filter: 'unread' },
		})
		expect(mailboxRoute('d', { threadID: 'T1' }).name).toBe('mail-folder-mail')
	})

	it('is the same word for the lists that are not mailboxes', () => {
		expect(mailboxRoute('starred').params).toEqual({ account: '0', mailbox: 'starred' })
		expect(mailboxRoute('search', { accountId: 'team' }).params).toEqual({
			account: '2',
			mailbox: 'search',
		})
	})

	it('is its id under another account, whose folders are not known here', () => {
		expect(mailboxRoute('x', { accountId: 'team', threadID: 'T1' })).toMatchObject({
			name: 'mail-mailbox-shortcut',
			params: { account: '2', mailbox: 'x', threadID: 'T1' },
		})
	})
})

describe('the account in an address', () => {
	it('is the number the user has for it', () => {
		expect(accountRoute('mail-contacts', 'team').params).toEqual({ account: '2' })
		expect(accountRoute('mail-contact', 'own', { contactName: 'C1' }).params).toEqual({
			account: '0',
			contactName: 'C1',
		})
	})

	it('is the active one unless another is named', () => {
		state.accountId = 'team'
		expect(accountRoute('mail-outbox').params).toEqual({ account: '2' })
		state.accountId = 'own'
	})

	it('is the thread’s own in All Inboxes, and the active one for the list', () => {
		expect(allInboxesRoute({ accountId: 'team', threadID: 'T1' })).toMatchObject({
			name: 'mail-all-inboxes-mail',
			params: { account: '2', threadID: 'T1' },
		})
		expect(allInboxesRoute()).toMatchObject({ name: 'mail-all-inboxes', params: { account: '0' } })
	})
})

describe('the ids a view is handed for its address', () => {
	const landOn = (name: string, params: Record<string, string>) => {
		const route = on(name, params)
		settleOpenMailbox(route)
		return routeIds(route)
	}

	it('the account and the mailbox a role names', () => {
		expect(landOn('mail-mailbox', { account: '2', mailbox: 'inbox' })).toEqual({
			accountId: 'team',
			mailbox: 'a',
		})
	})

	it('the folder a path names', () => {
		const thread = { account: '0', mailbox: 'Archive/Bills', threadID: 'T1' }
		expect(landOn('mail-folder-mail', thread).mailbox).toBe('f')
		expect(landOn('mail-folder', { account: '0', mailbox: 'sent' }).mailbox).toBe('g')
	})

	it('no mailbox for a name or a role the account has not got', () => {
		expect(landOn('mail-folder', { account: '0', mailbox: 'Renamed' }).mailbox).toBe('')
		expect(landOn('mail-mailbox', { account: '0', mailbox: 'junk' }).mailbox).toBe('')
		// A role is not a folder's name, nor a folder's name a role.
		expect(landOn('mail-folder', { account: '0', mailbox: 'inbox' }).mailbox).toBe('')
		expect(landOn('mail-mailbox', { account: '0', mailbox: 'Clients' }).mailbox).toBe('')
	})

	it('only the account off the mailbox pages, and nothing off the pages of an account', () => {
		expect(landOn('mail-contacts', { account: '2' })).toEqual({ accountId: 'team' })
		expect(landOn('mail-overview', {})).toEqual({})
	})

	it('the same folder after it is renamed, though its old name no longer finds it', () => {
		const route = on('mail-folder', { account: '0', mailbox: 'Clients' })
		settleOpenMailbox(route)
		state.mailboxes.find((m) => m.id === 'c')!._name = 'Customers'

		expect(routeMailboxId(route)).toBe('')
		expect(routeIds(route).mailbox).toBe('c')
		expect(mailboxRoute('c').params.mailbox).toBe('Customers')
	})
})
