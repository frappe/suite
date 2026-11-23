import type { APIRequestContext } from "@playwright/test";
import { callMethod } from "../../shared/frappe";

/**
 * Seeds People's contacts and address books on the demo site through the same
 * whitelisted methods the app calls, for the `people` flow. Each seeding call
 * returns the id the cleanup needs.
 */

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
