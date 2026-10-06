import { readonly, ref } from 'vue'
import type { LocationQueryRaw, RouteLocationNormalized, RouteParamsRawGeneric } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'

/**
 * Where things are in Mail. Views and stores name an account and a mailbox by their JMAP ids
 * ('mh', 'a'), but a URL says them the way a person would:
 *
 *   /mail/a/0/#inbox                 the account by the user's number for it, 0 their personal one
 *   /mail/a/1/#mailbox/Bills/<id>    a folder of their own by its name, the rest by their role
 *
 * So the route params are in the URL's words, and this is the one module that turns ids into
 * them (the *Route builders) and back (routeIds, openMailboxId). Everything else keeps to ids.
 */

interface Mailbox {
	id: string
	_name?: string
	role?: string | null
	parent_id?: string | null
}

type Mailboxes = Mailbox[] | null | undefined

export interface MailLocation {
	name: string
	params: RouteParamsRawGeneric
	query?: LocationQueryRaw
}

interface ThreadLocation {
	/** Defaults to the active account. */
	accountId?: string
	threadID?: string
	query?: LocationQueryRaw
}

/** A page of an account: `accountRoute('mail-contact', accountId, { contactName })`. */
export const accountRoute = (
	name: string,
	accountId?: string,
	params: RouteParamsRawGeneric = {},
): MailLocation => ({ name, params: { account: accountNumber(accountId), ...params } })

export const mailboxRoute = (
	mailboxId: string,
	{ accountId, threadID, query }: ThreadLocation = {},
): MailLocation => {
	const store = userStore()
	const isActive = !accountId || accountId === store.accountId
	const address = mailboxAddress(isActive ? store.mailboxes.data : null, mailboxId)
	const thread = threadID ? { threadID } : {}

	// The mailbox of another account, whose names are not at hand, goes by its id: the guard
	// switches to that account and sends it on to the mailbox's own address.
	if (!address)
		return { ...accountRoute('mail-mailbox-shortcut', accountId, { mailbox: mailboxId, ...thread }), query }

	const name = MAILBOX_ROUTES[address.custom ? 'folder' : 'role'][threadID ? 'thread' : 'list']
	return { ...accountRoute(name, accountId, { mailbox: address.mailbox, ...thread }), query }
}

/** The merged list. With a thread open the account is the thread's own, not the active one. */
export const allInboxesRoute = ({ accountId, threadID, query }: ThreadLocation = {}): MailLocation =>
	threadID
		? { ...accountRoute('mail-all-inboxes-mail', accountId, { threadID }), query }
		: { ...accountRoute('mail-all-inboxes'), query }

/** The ids a view works in, for the account number its route names and the mailbox open on it. */
export const routeIds = (route: RouteLocationNormalized) => {
	if (!route.params.account) return {}
	const accountId = accountIdAt(route.params.account)
	return isMailboxRoute(route) ? { accountId, mailbox: openMailbox.value } : { accountId }
}

const openMailbox = ref('')

/**
 * The id of the mailbox that is open: '' off the mailbox pages, and for one the account lacks.
 *
 * Settled as a navigation lands rather than read off the URL each time it is asked for. The
 * name in the URL finds a mailbox only in the list it was looked up in: a folder renamed while
 * it is open is still the one open, and so is a mailbox while the list is another account's
 * for the moment a switch takes.
 */
export const openMailboxId = readonly(openMailbox)

/** Called as each navigation lands, and again if the list then turns out to have the mailbox. */
export const settleOpenMailbox = (route: RouteLocationNormalized) => {
	openMailbox.value = routeMailboxId(route)
}

/** The id of the mailbox a route names, as the active account's list stands. */
export const routeMailboxId = (route: RouteLocationNormalized): string => {
	if (!isMailboxRoute(route)) return ''
	const address = { custom: isFolderRoute(route), mailbox: route.params.mailbox as string }
	return mailboxIdAt(userStore().mailboxes.data, address)
}

export const isMailboxRoute = (route: RouteLocationNormalized) =>
	[...Object.values(MAILBOX_ROUTES.role), ...Object.values(MAILBOX_ROUTES.folder)].includes(
		route.name as string,
	)

/** On a mailbox's list, with no thread open. */
export const isMailboxListRoute = (route: RouteLocationNormalized) =>
	[MAILBOX_ROUTES.role.list, MAILBOX_ROUTES.folder.list].includes(route.name as string)

/** On a folder of the user's own, which another of their accounts need not have. */
export const isFolderRoute = (route: RouteLocationNormalized) =>
	Object.values(MAILBOX_ROUTES.folder).includes(route.name as string)

export const accountNumber = (accountId?: string): string => {
	const store = userStore()
	const id = accountId || store.accountId
	return String(store.userResource.data?.accounts?.find((a) => a.id === id)?.number ?? 0)
}

export const accountIdAt = (number: unknown): string | undefined =>
	userStore().userResource.data?.accounts?.find((a) => String(a.number) === number)?.id

/**
 * What a mailbox goes by in a URL: its role, or under `mailbox/` its name. Starred and Search
 * are not mailboxes at all, and go by the same word as their id.
 */
export const mailboxAddress = (mailboxes: Mailboxes, id: string) => {
	if (VIRTUAL_MAILBOXES.includes(id)) return { custom: false, mailbox: id }
	const mailbox = mailboxes?.find((m) => m.id === id)
	if (!mailbox) return
	if (mailbox.role) return { custom: false, mailbox: mailbox.role }
	return { custom: true, mailbox: mailboxPath(mailboxes!, mailbox) }
}

export const mailboxIdAt = (
	mailboxes: Mailboxes,
	{ custom, mailbox }: { custom: boolean; mailbox: string },
): string => {
	if (!custom && VIRTUAL_MAILBOXES.includes(mailbox)) return mailbox
	const named = custom
		? (m: Mailbox) => mailboxPath(mailboxes!, m) === mailbox
		: (m: Mailbox) => m.role === mailbox
	return mailboxes?.find(named)?.id ?? ''
}

// A list and a thread route each, as a folder's name needs its own path (mailbox/<name>).
const MAILBOX_ROUTES = {
	role: { list: 'mail-mailbox', thread: 'mail-mail' },
	folder: { list: 'mail-folder', thread: 'mail-folder-mail' },
}

const VIRTUAL_MAILBOXES = ['starred', 'search']

// Only siblings have to differ in name, so a nested folder goes by its whole path.
const mailboxPath = (mailboxes: Mailbox[], mailbox: Mailbox): string => {
	const parent = mailbox.parent_id && mailboxes.find((m) => m.id === mailbox.parent_id)
	return parent ? `${mailboxPath(mailboxes, parent)}/${mailbox._name}` : (mailbox._name ?? '')
}
