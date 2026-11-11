import type { APIRequestContext } from "@playwright/test";

/**
 * Seeds People's contacts and address books on the demo site through the same
 * whitelisted methods the app calls, for the `people` flow. Each seeding call
 * returns the id the cleanup needs.
 */

/**
 * Runs a cleanup until it succeeds, for up to a minute. The dev bench restarts
 * itself every few thousand requests and refuses connections meanwhile; a
 * cleanup that ran into that window would leave its data on the shared site.
 */
export async function persistently(cleanup: () => Promise<unknown>): Promise<void> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			await cleanup();
			return;
		} catch (error) {
			if (attempt >= 20) throw error;
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
	}
}

/** Calls a whitelisted method and returns its `message`. */
export async function callMethod<T>(api: APIRequestContext, method: string, body: object): Promise<T> {
	const response = await api.post(`/api/method/${method}`, { data: body });
	if (!response.ok()) throw new Error(`${method} answered ${response.status()}: ${await response.text()}`);
	// SAFETY: every whitelisted method answers `{ message }`; the caller names the message's type.
	const { message } = (await response.json()) as { message: T };
	return message;
}

interface Account {
	id: string;
	is_personal: boolean;
}

/** The signed-in user's personal mail account, where their contacts live. */
export async function personalAccount(api: APIRequestContext): Promise<string> {
	const info = await callMethod<{ accounts: Account[] }>(api, "suite.mail.api.account.get_user_info", {});
	const account = info.accounts.find((candidate) => candidate.is_personal);
	if (!account) throw new Error("people: the demo user has no personal mail account");
	return account.id;
}

export interface AddressBook {
	id: string;
	_name: string;
	default: number;
}

export function addressBooks(api: APIRequestContext, account: string): Promise<AddressBook[]> {
	return callMethod(api, "suite.mail.api.contacts.get_address_books", { account });
}

export async function defaultBook(api: APIRequestContext, account: string): Promise<string> {
	const book = (await addressBooks(api, account)).find((candidate) => candidate.default);
	if (!book) throw new Error("people: the account has no default address book");
	return book.id;
}

export interface NewContact {
	full_name: string;
	kind: "Individual" | "Group";
	emails?: { address: string; type: string; label?: string }[];
	phones?: { number: string; type: string; label?: string }[];
	addresses?: { type: string; street: string; locality: string; region: string; postcode: string; country: string }[];
}

export function createContact(api: APIRequestContext, account: string, books: string[], contact: NewContact): Promise<string> {
	return callMethod(api, "suite.mail.doctype.contact_card.contact_card.add_contact_card", {
		account,
		address_book_ids: books,
		...contact,
	});
}

export function deleteContacts(api: APIRequestContext, account: string, ids: string[]): Promise<unknown> {
	return callMethod(api, "suite.mail.doctype.contact_card.contact_card.delete_contact_cards", { account, ids });
}

/** Deletes those of `ids` that still exist: a path may have deleted some through the UI. */
export async function removeContacts(api: APIRequestContext, account: string, ids: string[]): Promise<void> {
	const existing = new Set((await findContacts(api, account, "")).map((row) => row.id));
	const left = ids.filter((id) => existing.has(id));
	if (left.length) await deleteContacts(api, account, left);
}

export interface ContactRow {
	id: string;
	full_name: string | null;
}

export async function findContacts(api: APIRequestContext, account: string, text: string): Promise<ContactRow[]> {
	const page = await callMethod<{ rows: ContactRow[] }>(api, "suite.mail.api.contacts.get_contact_cards", {
		account,
		filter: { text },
		start: 0,
		limit: 500,
	});
	return page.rows;
}

export function createAddressBook(api: APIRequestContext, account: string, name: string, description: string): Promise<string> {
	return callMethod(api, "suite.mail.doctype.address_book.address_book.add_address_book", { account, name, description });
}

export function deleteAddressBooks(api: APIRequestContext, account: string, ids: string[]): Promise<unknown> {
	return callMethod(api, "suite.mail.doctype.address_book.address_book.delete_address_books", { account, ids });
}

/** Deletes those of `ids` that still exist. */
export async function removeAddressBooks(api: APIRequestContext, account: string, ids: string[]): Promise<void> {
	const existing = new Set((await addressBooks(api, account)).map((book) => book.id));
	const left = ids.filter((id) => existing.has(id));
	if (left.length) await deleteAddressBooks(api, account, left);
}
