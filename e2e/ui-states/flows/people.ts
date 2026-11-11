import { expect, type Locator } from "@playwright/test";
import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";
import {
	addressBooks,
	createAddressBook,
	createContact,
	defaultBook,
	removeAddressBooks,
	deleteContacts,
	findContacts,
	personalAccount,
	persistently,
	removeContacts,
	type NewContact,
} from "./people-helpers";

type Event =
	| { type: "LOAD_SLOW" }
	| { type: "ADD_CONTACT" }
	| { type: "TYPE_NAME" }
	| { type: "CLEAR_BOOKS" }
	| { type: "SAVE_CONTACT" }
	| { type: "POPULATE" }
	| { type: "SEARCH_HIT" }
	| { type: "SEARCH_MISS" }
	| { type: "SELECT_ROW" }
	| { type: "DELETE_SELECTED" }
	| { type: "CONFIRM_DELETE_SELECTED" }
	| { type: "OPEN_CONTACT" }
	| { type: "OPEN_CONTACT_SLOW" }
	| { type: "EDIT_GENERAL" }
	| { type: "CHANGE_NAME" }
	| { type: "SAVE_GENERAL" }
	| { type: "ADD_EMAIL" }
	| { type: "TYPE_EMAIL" }
	| { type: "SAVE_EMAIL" }
	| { type: "ADD_PHONE" }
	| { type: "ADD_ADDRESS" }
	| { type: "ADD_TO_BOOK" }
	| { type: "SELECT_BOOK_ROW" }
	| { type: "REMOVE_BOOK" }
	| { type: "CONFIRM_REMOVE_BOOK" }
	| { type: "CONTACT_MENU" }
	| { type: "DELETE_CONTACT" }
	| { type: "CONFIRM_DELETE_CONTACT" }
	| { type: "FOLLOW_BREADCRUMB" }
	| { type: "OPEN_ADDRESS_BOOKS" }
	| { type: "SEARCH_BOOKS_MISS" }
	| { type: "ADD_BOOK" }
	| { type: "TYPE_BOOK_NAME" }
	| { type: "SAVE_BOOK" }
	| { type: "OPEN_BOOK" }
	| { type: "EDIT_BOOK" }
	| { type: "RENAME_BOOK" }
	| { type: "SAVE_BOOK_EDIT" }
	| { type: "ADD_BOOK_CONTACTS" }
	| { type: "BOOK_MENU" }
	| { type: "DELETE_BOOK" }
	| { type: "CONFIRM_DELETE_BOOK" }
	| { type: "PHONE" }
	| { type: "OPEN_NAV" };

/**
 * People: a mail account's contacts and address books. In the code each page
 * decides its own screen from `v-if="contact.data"` / `addressBook.data` and a
 * ListView whose empty text reads `isFetching`; every dialog is a boolean ref
 * on the page (`showEditGeneral`, `showAddEmail`, `showDeleteContact`, ...).
 */
const machine = setupFlow<Event>().createMachine({
	id: "people",
	initial: "contactsEmpty",
	states: {
		contactsEmpty: {
			meta: { description: "Maya's contacts, empty as they are on the demo site: the list header over “No contacts found.”, with Add Contact top right." },
			on: { LOAD_SLOW: "contactsLoading", ADD_CONTACT: "addContact", POPULATE: "contacts", OPEN_ADDRESS_BOOKS: "addressBooks", PHONE: "contactsPhone" },
		},
		contactsLoading: {
			meta: { description: "The contacts request still out: the same empty list, with “Loading...” where the empty text goes. No skeleton rows." },
		},
		addContact: {
			meta: { description: "New Contact: Name empty, Kind Individual, and the default address book already picked. Save is off until a name is typed." },
			on: { TYPE_NAME: "addContactReady" },
		},
		addContactReady: {
			meta: { description: "A name typed: Save turns on. The dialog asks for no email, phone or address; those are added on the contact's page." },
			on: { CLEAR_BOOKS: "addContactNoBook", SAVE_CONTACT: "contactCreated" },
		},
		addContactNoBook: {
			meta: { description: "Every address book cleared: Save turns off again, with nothing on screen saying why. A contact must belong to at least one book." },
		},
		contactCreated: {
			meta: { description: "Save opens the new contact's own page, with a “Contact created.” toast. Its emails, phones and addresses are all empty." },
		},
		contacts: {
			meta: { description: "A populated list: name, kind and first email per contact; a second email shows as “+ 1 more”." },
			on: {
				SEARCH_HIT: "contactsSearch",
				SEARCH_MISS: "contactsSearchEmpty",
				SELECT_ROW: "contactsSelected",
				OPEN_CONTACT: "contact",
				OPEN_CONTACT_SLOW: "contactLoading",
			},
		},
		contactsSearch: {
			meta: { description: "Searching “Harbourlight” keeps the contacts whose name or email contains that whole word. Only whole words match: “harbour” finds nothing." },
		},
		contactsSearchEmpty: {
			meta: { description: "A search with no match shows the same “No contacts found.” as an account with no contacts at all." },
		},
		contactsSelected: {
			meta: { description: "One row ticked: a banner at the foot of the list reads “1 row selected” and offers Delete, Select all and a close button." },
			on: { DELETE_SELECTED: "deleteContactsConfirm" },
		},
		deleteContactsConfirm: {
			meta: { description: "Delete Contacts asks to confirm, without naming who is selected." },
			on: { CONFIRM_DELETE_SELECTED: "contactsDeleted" },
		},
		contactsDeleted: {
			meta: { description: "Confirmed: the row leaves the list and a “Contacts deleted.” toast shows. There is no undo." },
		},
		contactLoading: {
			meta: { description: "A contact's page while its request is out: the sidebar and nothing else. The page has no header, skeleton or spinner until the contact arrives." },
		},
		contact: {
			meta: { description: "One contact: General Information with Edit, then its address books, emails, phones and addresses, each a card with Add." },
			on: {
				EDIT_GENERAL: "editContact",
				ADD_EMAIL: "addEmail",
				ADD_PHONE: "addPhone",
				ADD_ADDRESS: "addAddress",
				ADD_TO_BOOK: "addToBook",
				SELECT_BOOK_ROW: "bookRowSelected",
				CONTACT_MENU: "contactMenu",
				FOLLOW_BREADCRUMB: "breadcrumbLanding",
			},
		},
		editContact: {
			meta: { description: "Edit General Information: name and kind as saved. Save is off until something changes." },
			on: { CHANGE_NAME: "editContactChanged" },
		},
		editContactChanged: {
			meta: { description: "The name changed: Save turns on." },
			on: { SAVE_GENERAL: "contactUpdated" },
		},
		contactUpdated: {
			meta: { description: "Saved: the dialog closes, the new name shows in the card and the breadcrumb, and a “Contact updated.” toast shows." },
		},
		addEmail: {
			meta: { description: "Add Email: Address, Type (Personal) and Label. Save is off until an address is typed." },
			on: { TYPE_EMAIL: "addEmailReady" },
		},
		addEmailReady: {
			meta: { description: "An address typed: Save turns on. The field is only checked by the browser's email type, not by the dialog." },
			on: { SAVE_EMAIL: "emailAdded" },
		},
		emailAdded: {
			meta: { description: "The new address joins the Emails card and a “Contact updated.” toast shows. The card does not grow, so its third row is cut off." },
		},
		addPhone: {
			meta: { description: "Add Phone: Number, Type and Label, with Save off until a number is typed." },
		},
		addAddress: {
			meta: { description: "Add Address: type, street, locality, region, postcode and country." },
		},
		addToBook: {
			meta: { description: "Add to Address Book: one Address Book select showing “Select option”. Save is off until a book is picked." },
		},
		bookRowSelected: {
			meta: { description: "The contact's only address book ticked: the card's banner offers Remove." },
			on: { REMOVE_BOOK: "removeBookConfirm" },
		},
		removeBookConfirm: {
			meta: { description: "Remove from Address Books asks to confirm." },
			on: { CONFIRM_REMOVE_BOOK: "removeBookRefused" },
		},
		removeBookRefused: {
			meta: { description: "Removing the last book is refused by the server: an error toast says a contact must belong to at least one address book, and the confirm stays open." },
		},
		contactMenu: {
			meta: { description: "The contact's ⋯ menu: Delete is its only item." },
			on: { DELETE_CONTACT: "deleteContactConfirm" },
		},
		deleteContactConfirm: {
			meta: { description: "Delete Contact names the contact and asks to confirm." },
			on: { CONFIRM_DELETE_CONTACT: "contactDeleted" },
		},
		contactDeleted: {
			meta: { description: "Confirmed: back on the contacts list, without the contact, and a “Contact deleted.” toast." },
		},
		breadcrumbLanding: {
			meta: { description: "The “Contacts” breadcrumb on a contact's page links to /mail/contacts, and Mail redirects that back to the People contacts list." },
		},
		addressBooks: {
			meta: { description: "Address Books: the account's books by name, the default one marked Default, and a search field." },
			on: { SEARCH_BOOKS_MISS: "addressBooksSearchEmpty", ADD_BOOK: "addBook", OPEN_BOOK: "addressBook" },
		},
		addressBooksSearchEmpty: {
			meta: { description: "A search that matches no book: “No address books found.” inside the list." },
		},
		addBook: {
			meta: { description: "New Address Book: Name, Description and Set as Default. Save is off until a name is typed." },
			on: { TYPE_BOOK_NAME: "addBookReady" },
		},
		addBookReady: {
			meta: { description: "A name and description typed: Save turns on." },
			on: { SAVE_BOOK: "bookCreated" },
		},
		bookCreated: {
			meta: { description: "Save opens the new book's page with an “Address book created.” toast: Total Contacts 0 and an empty contacts list." },
		},
		addressBook: {
			meta: { description: "One address book: name, description and contact count, then its contacts with a search field." },
			on: { EDIT_BOOK: "editBook", ADD_BOOK_CONTACTS: "selectContacts", BOOK_MENU: "bookMenu" },
		},
		editBook: {
			meta: { description: "Edit General Information for a book: name, description and Set as Default. Save is off until something changes." },
			on: { RENAME_BOOK: "editBookChanged" },
		},
		editBookChanged: {
			meta: { description: "The book renamed: Save turns on." },
			on: { SAVE_BOOK_EDIT: "bookUpdated" },
		},
		bookUpdated: {
			meta: { description: "Saved: the new name shows in the card and the breadcrumb, with an “Address book updated.” toast." },
		},
		selectContacts: {
			meta: { description: "Select Contacts lists every contact in the account. The two already in this book are listed too, unticked. Add is off until one is ticked." },
		},
		bookMenu: {
			meta: { description: "A book's ⋯ menu: Set as Default and Delete." },
			on: { DELETE_BOOK: "deleteBookConfirm" },
		},
		deleteBookConfirm: {
			meta: { description: "Delete Address Book names the book and asks to confirm. It does not say what happens to the contacts in it." },
			on: { CONFIRM_DELETE_BOOK: "bookDeleted" },
		},
		bookDeleted: {
			meta: { description: "Confirmed: back on Address Books without it, and an “Address book deleted.” toast." },
		},
		contactsPhone: {
			meta: { description: "Contacts at phone width: a menu button opens People's navigation, and Add Contact stays in the header." },
			on: { OPEN_NAV: "phoneNav" },
		},
		phoneNav: {
			meta: { description: "People's navigation as a sheet over the phone page: the account, Contacts and Address Books." },
		},
	},
});

interface PeopleContext {
	account: string;
	book: string;
	/** Contact ids this path seeded, by name. */
	contacts: Map<string, string>;
}

const context = perScene<PeopleContext>("people: context");

const SEED: NewContact[] = [
	{
		full_name: "Priya Natarajan",
		kind: "Individual",
		emails: [
			{ address: "priya@harbourlight.example", type: "Work" },
			{ address: "priya.natarajan@fastmail.example", type: "Personal" },
		],
		phones: [{ number: "+44 20 7946 0321", type: "Work", label: "Office" }],
		addresses: [
			{ type: "Work", street: "14 Wharf Road", locality: "London", region: "Greater London", postcode: "N1 7GR", country: "United Kingdom" },
		],
	},
	{ full_name: "Harbourlight Studio", kind: "Group", emails: [{ address: "hello@harbourlight.example", type: "Work" }] },
	{ full_name: "Daniel Okafor", kind: "Individual", emails: [{ address: "daniel@okafor.design", type: "Work" }] },
	{ full_name: "Elena Rossi", kind: "Individual", emails: [{ address: "elena.rossi@meridian.example", type: "Work" }] },
];

const contactsPath = (scene: BaseScene) => `/people/account/${context.get(scene).account}/contacts`;
const booksPath = (scene: BaseScene) => `/people/account/${context.get(scene).account}/address-books`;

/** Creates contacts through the API and removes them when the path ends. */
async function seedContacts(scene: BaseScene, contacts: NewContact[], books?: string[]): Promise<void> {
	const ctx = context.get(scene);
	for (const contact of contacts) {
		const id = await createContact(scene.api, ctx.account, books ?? [ctx.book], contact);
		ctx.contacts.set(contact.full_name, id);
		scene.defer(() => persistently(() => removeContacts(scene.api, ctx.account, [id])));
	}
}

function contactId(scene: BaseScene, name: string): string {
	const id = context.get(scene).contacts.get(name);
	if (!id) throw new Error(`people: ${name} was not seeded on this path`);
	return id;
}

/** Removes whatever the path created through the UI, found by its unique name. */
function deferContactNamed(scene: BaseScene, name: string): void {
	const { account } = context.get(scene);
	scene.defer(() =>
		persistently(async () => {
			const ids = (await findContacts(scene.api, account, name)).map((row) => row.id);
			if (ids.length) await deleteContacts(scene.api, account, ids);
		}),
	);
}

async function openPopulated(scene: BaseScene): Promise<void> {
	await seedContacts(scene, SEED);
	await scene.goto(contactsPath(scene));
	await expect(scene.page.getByText("Elena Rossi")).toBeVisible();
}

async function openContact(scene: BaseScene): Promise<void> {
	await scene.page.getByText("Priya Natarajan").click();
	await expect(scene.page.getByText("General Information")).toBeVisible();
	await expect(scene.page.getByText("14 Wharf Road")).toBeVisible();
}

function card(scene: BaseScene, title: string): Locator {
	return scene.page.locator("div.rounded-4.border").filter({ has: scene.page.getByRole("heading", { name: title, exact: true }) });
}

async function seedBook(scene: BaseScene): Promise<string> {
	const ctx = context.get(scene);
	const name = scene.name("Launch partners");
	const id = await createAddressBook(scene.api, ctx.account, name, "Agencies and freelancers working on the Beacon launch.");
	scene.defer(() => persistently(() => removeAddressBooks(scene.api, ctx.account, [id])));
	await seedContacts(scene, SEED.slice(1, 3), [ctx.book, id]);
	return id;
}

export const people = defineFlow<Event, BaseScene>({
	id: "people",
	title: "People",
	source: "frontend/src/apps/people/pages/ContactsView.vue",
	open: (browser) => openDemoScene(browser, "maya"),
	machine,
	async enter(scene) {
		const account = await personalAccount(scene.api);
		context.set(scene, { account, book: await defaultBook(scene.api, account), contacts: new Map() });
		await scene.goto(contactsPath(scene));
		await expect(scene.page.getByText("No contacts found.")).toBeVisible();
	},
	events: {
		async LOAD_SLOW(scene) {
			await scene.hold("**/api/method/suite.mail.api.contacts.get_contact_cards");
			await scene.page.reload();
			await expect(scene.page.getByText("Loading...")).toBeVisible();
		},
		async ADD_CONTACT(scene) {
			await scene.page.getByRole("button", { name: "Add Contact" }).click();
			const dialog = scene.dialog("New Contact");
			await expect(dialog.getByRole("button", { name: /Stalwart Address Book/ })).toBeVisible();
			await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async TYPE_NAME(scene) {
			const dialog = scene.dialog("New Contact");
			const name = scene.name("Rahul Iyer");
			deferContactNamed(scene, name);
			await dialog.getByRole("textbox", { name: "Name" }).fill(name);
			await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
		},
		async CLEAR_BOOKS(scene) {
			const dialog = scene.dialog("New Contact");
			await dialog.getByRole("button", { name: /Stalwart Address Book/ }).click();
			await scene.page.getByRole("button", { name: "Clear All" }).click();
			await scene.page.keyboard.press("Escape");
			await expect(dialog.getByRole("button", { name: /Stalwart Address Book/ })).toHaveCount(0);
			await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async SAVE_CONTACT(scene) {
			await scene.dialog("New Contact").getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Contact created.")).toBeVisible();
			await expect(scene.page.getByText("General Information")).toBeVisible();
		},
		async POPULATE(scene) {
			await openPopulated(scene);
		},
		async SEARCH_HIT(scene) {
			await scene.page.getByRole("textbox", { name: "Search" }).fill("Harbourlight");
			await expect(scene.page.getByText("Elena Rossi")).toBeHidden({ timeout: 20_000 });
			await expect(scene.page.getByText("Harbourlight Studio")).toBeVisible();
		},
		async SEARCH_MISS(scene) {
			await scene.page.getByRole("textbox", { name: "Search" }).fill("Zanzibar");
			await expect(scene.page.getByText("No contacts found.")).toBeVisible();
		},
		async SELECT_ROW(scene) {
			const row = scene.page.getByRole("link").filter({ hasText: "Daniel Okafor" });
			await row.getByRole("checkbox").click();
			await expect(scene.page.getByRole("button", { name: "Delete" })).toBeVisible();
		},
		async DELETE_SELECTED(scene) {
			await scene.page.getByRole("button", { name: "Delete" }).click();
			await expect(scene.dialog("Delete Contacts")).toBeVisible();
		},
		async CONFIRM_DELETE_SELECTED(scene) {
			await scene.dialog("Delete Contacts").getByRole("button", { name: "Confirm" }).click();
			await expect(scene.toast("Contacts deleted.")).toBeVisible();
			await expect(scene.page.getByText("Daniel Okafor")).toBeHidden();
		},
		async OPEN_CONTACT(scene) {
			await openContact(scene);
		},
		async OPEN_CONTACT_SLOW(scene) {
			await scene.hold("**/api/suite/mail/contacts/card**");
			await scene.page.getByText("Priya Natarajan").click();
			await expect(scene.page).toHaveURL(new RegExp(`/contacts/${contactId(scene, "Priya Natarajan")}`));
			await expect(scene.page.getByRole("textbox", { name: "Search" })).toBeHidden();
		},
		async EDIT_GENERAL(scene) {
			await card(scene, "General Information").getByRole("button", { name: "Edit" }).click();
			const dialog = scene.dialog("Edit General Information");
			await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Priya Natarajan");
			await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async CHANGE_NAME(scene) {
			const dialog = scene.dialog("Edit General Information");
			await dialog.getByRole("textbox", { name: "Name" }).fill("Priya Natarajan-Shaw");
			await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
		},
		async SAVE_GENERAL(scene) {
			await scene.dialog("Edit General Information").getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Contact updated.")).toBeVisible();
			await expect(scene.page.getByRole("dialog")).toHaveCount(0);
			await expect(card(scene, "General Information").getByText("Priya Natarajan-Shaw")).toBeVisible();
		},
		async ADD_EMAIL(scene) {
			await card(scene, "Emails").getByRole("button", { name: "Add", exact: true }).click();
			await expect(scene.dialog("Add Email").getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async TYPE_EMAIL(scene) {
			const dialog = scene.dialog("Add Email");
			await dialog.getByRole("textbox", { name: "Address" }).fill("priya@studio-ns.example");
			await dialog.getByRole("textbox", { name: "Label" }).fill("Studio");
			await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
		},
		async SAVE_EMAIL(scene) {
			await scene.dialog("Add Email").getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Contact updated.")).toBeVisible();
			await expect(card(scene, "Emails").getByText("priya@studio-ns.example")).toBeVisible();
		},
		async ADD_PHONE(scene) {
			await card(scene, "Phones").getByRole("button", { name: "Add", exact: true }).click();
			await expect(scene.dialog("Add Phone").getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async ADD_ADDRESS(scene) {
			await card(scene, "Addresses").getByRole("button", { name: "Add", exact: true }).click();
			await expect(scene.dialog("Add Address")).toBeVisible();
		},
		async ADD_TO_BOOK(scene) {
			await card(scene, "Address Books").getByRole("button", { name: "Add", exact: true }).click();
			await expect(scene.dialog("Add to Address Book")).toBeVisible();
		},
		async SELECT_BOOK_ROW(scene) {
			await card(scene, "Address Books").getByRole("checkbox").last().click();
			await expect(card(scene, "Address Books").getByRole("button", { name: "Remove" })).toBeVisible();
		},
		async REMOVE_BOOK(scene) {
			await card(scene, "Address Books").getByRole("button", { name: "Remove" }).click();
			await expect(scene.dialog("Remove from Address Books")).toBeVisible();
		},
		async CONFIRM_REMOVE_BOOK(scene) {
			await scene.dialog("Remove from Address Books").getByRole("button", { name: "Confirm" }).click();
			await expect(scene.toast(/at least one address book/)).toBeVisible();
			await expect(scene.dialog("Remove from Address Books")).toBeVisible();
		},
		async CONTACT_MENU(scene) {
			await scene.page.getByRole("banner").getByRole("button").last().click();
			await expect(scene.page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
		},
		async DELETE_CONTACT(scene) {
			await scene.page.getByRole("menuitem", { name: "Delete" }).click();
			await expect(scene.dialog("Delete Contact").getByText("Priya Natarajan")).toBeVisible();
		},
		async CONFIRM_DELETE_CONTACT(scene) {
			await scene.dialog("Delete Contact").getByRole("button", { name: "Confirm" }).click();
			await expect(scene.toast("Contact deleted.")).toBeVisible();
			await expect(scene.page.getByText("Elena Rossi")).toBeVisible();
			await expect(scene.page.getByText("Priya Natarajan")).toBeHidden();
		},
		async FOLLOW_BREADCRUMB(scene) {
			await scene.page.getByRole("banner").getByRole("link", { name: "Contacts" }).click();
			await expect(scene.page).not.toHaveURL(/\/contacts\/[^/]+$/);
			await scene.page.waitForLoadState("networkidle");
		},
		async OPEN_ADDRESS_BOOKS(scene) {
			await scene.page.getByRole("link", { name: "Address Books" }).click();
			await expect(scene.page.getByText("Default", { exact: true })).toBeVisible();
		},
		async SEARCH_BOOKS_MISS(scene) {
			await scene.page.getByRole("textbox", { name: "Search" }).fill("Suppliers");
			await expect(scene.page.getByText("No address books found.")).toBeVisible();
		},
		async ADD_BOOK(scene) {
			await scene.page.getByRole("button", { name: "Add Address Book" }).click();
			await expect(scene.dialog("New Address Book").getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async TYPE_BOOK_NAME(scene) {
			const dialog = scene.dialog("New Address Book");
			const name = scene.name("Press contacts");
			const { account } = context.get(scene);
			scene.defer(() =>
				persistently(async () => {
					const ids = (await addressBooks(scene.api, account)).filter((book) => book._name === name).map((book) => book.id);
					if (ids.length) await removeAddressBooks(scene.api, account, ids);
				}),
			);
			await dialog.getByRole("textbox", { name: "Name" }).fill(name);
			await dialog.getByRole("textbox", { name: "Description" }).fill("Journalists covering the Beacon launch.");
			await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
		},
		async SAVE_BOOK(scene) {
			await scene.dialog("New Address Book").getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Address book created.")).toBeVisible();
			await expect(scene.page.getByText("Total Contacts")).toBeVisible();
		},
		async OPEN_BOOK(scene) {
			const id = await seedBook(scene);
			await scene.goto(`${booksPath(scene)}/${id}`);
			await expect(scene.page.getByText("Daniel Okafor")).toBeVisible();
		},
		async EDIT_BOOK(scene) {
			await card(scene, "General Information").getByRole("button", { name: "Edit" }).click();
			await expect(scene.dialog("Edit General Information").getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async RENAME_BOOK(scene) {
			const dialog = scene.dialog("Edit General Information");
			await dialog.getByRole("textbox", { name: "Name" }).fill(scene.name("Launch agencies"));
			await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
		},
		async SAVE_BOOK_EDIT(scene) {
			await scene.dialog("Edit General Information").getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Address book updated.")).toBeVisible();
			await expect(card(scene, "General Information").getByText(scene.name("Launch agencies"))).toBeVisible();
		},
		async ADD_BOOK_CONTACTS(scene) {
			await card(scene, "Contacts").getByRole("button", { name: "Add", exact: true }).click();
			await expect(scene.dialog("Select Contacts").getByText("Daniel Okafor")).toBeVisible();
		},
		async BOOK_MENU(scene) {
			await scene.page.getByRole("banner").getByRole("button").last().click();
			await expect(scene.page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
		},
		async DELETE_BOOK(scene) {
			await scene.page.getByRole("menuitem", { name: "Delete" }).click();
			await expect(scene.dialog("Delete Address Book")).toBeVisible();
		},
		async CONFIRM_DELETE_BOOK(scene) {
			await scene.dialog("Delete Address Book").getByRole("button", { name: "Confirm" }).click();
			await expect(scene.toast("Address book deleted.")).toBeVisible();
			await expect(scene.page.getByRole("button", { name: "Add Address Book" })).toBeVisible();
		},
		async PHONE(scene) {
			await scene.page.setViewportSize({ width: 390, height: 844 });
			await scene.page.reload();
			await expect(scene.page.getByRole("button", { name: "Open navigation" })).toBeVisible();
		},
		async OPEN_NAV(scene) {
			await scene.page.getByRole("button", { name: "Open navigation" }).click();
			await expect(scene.page.getByRole("dialog").getByText("Address Books")).toBeVisible();
		},
	},
});
