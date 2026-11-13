import { expect, type Locator, type Page } from "@playwright/test";
import { openDemoScene, personalAccount } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";
import {
	createFolder,
	deliverTestMail,
	FOLDER_NAME,
	MAILBOXES_URL,
	MIME_URL,
	removeFolder,
	SEARCH_URL,
} from "./mail-helpers";

type Event =
	| { type: "OPEN_SCREENER" }
	| { type: "OPEN_UNKNOWN_SENDER" }
	| { type: "SEARCH_SLOW" }
	| { type: "SEARCH" }
	| { type: "SEARCH_MISS" }
	| { type: "NEW_FOLDER" }
	| { type: "CREATE" }
	| { type: "OPEN_FOLDER" }
	| { type: "OPEN_FOLDER_MENU" }
	| { type: "CONFIGURE" }
	| { type: "DELETE" }
	| { type: "CONFIRM_DELETE" }
	| { type: "RAW_SLOW" }
	| { type: "OPEN_RAW" }
	| { type: "RAW_MISSING" }
	| { type: "NO_FOLDERS" }
	| { type: "NO_MAIL_ACCOUNT" };

/**
 * Mail's views beside one account's folder: the merged All Inboxes, the
 * Screener folded into the Inbox, search, the reader's own folders, the raw
 * message page, and the two pages for a person Mail cannot serve. In the code:
 * `UnifiedFolderView.vue`, `useScreener.ts`, the search branch of
 * `MailboxView.vue`, `AppSidebar.vue` with `FolderModal.vue` and
 * `DeleteFolderModal.vue`, `MimeMessageView.vue` (`mime.data` or `mime.error`,
 * nothing else), `MailNotReadyView.vue`, and the shell's `describeUnavailable`.
 */
const machine = setupFlow<Event>().createMachine({
	id: "mailViews",
	initial: "unifiedInbox",
	states: {
		unifiedInbox: {
			meta: {
				description:
					"All Inboxes at /mail/all/inbox: the same tabs, toolbar and rows as Maya's own Inbox (she has one account), but the Primary tab has no unread count, and the sidebar holds only the “All accounts” switcher and Starred: no Inbox, Drafts, Sent or folders.",
			},
			on: {
				OPEN_SCREENER: "screener",
				SEARCH_SLOW: "searching",
				SEARCH: "searchResults",
				SEARCH_MISS: "searchEmpty",
				NEW_FOLDER: "newFolderDialog",
				OPEN_FOLDER_MENU: "folderMenu",
				RAW_SLOW: "rawLoading",
				OPEN_RAW: "rawMessage",
				RAW_MISSING: "rawFailed",
				NO_FOLDERS: "mailNotReady",
				NO_MAIL_ACCOUNT: "mailUnavailable",
			},
		},
		screener: {
			meta: {
				description:
					"The old Screener address lands on the Inbox: the Screener is no longer a page. Dana, a first-time sender, has a row like any other, marked with the Unknown sender icon.",
			},
			on: { OPEN_UNKNOWN_SENDER: "screenerThread" },
		},
		screenerThread: {
			meta: { description: "Dana's mail open: a bar above the body asks “Do you want mail from dana@brightline-partners.example?” with No, and Yes with a menu of more ways to say yes." },
		},
		searching: {
			meta: { description: "A search while its request is out: the search field and “Searching…” in the toolbar, a spinner where the results go." },
		},
		searchResults: {
			meta: { description: "Results for “CSV import”: the header says Search, the query sits in a search field, the toolbar says “3 results”, and each row shows its folder as a chip with the matched words highlighted." },
		},
		searchEmpty: {
			meta: { description: "A search that matches nothing: “0 results” in the toolbar and “No results found for the given query.” in the list." },
		},
		newFolderDialog: {
			meta: { description: "New Folder from the sidebar: General and Automation tabs, Name, Icon, Color, and Disable Push Notifications." },
			on: { CREATE: "folderCreated" },
		},
		folderCreated: {
			meta: { description: "Saved: the dialog closes, a toast says “Folder created.”, and Beta feedback appears under My folders. The page stays where it was." },
			on: { OPEN_FOLDER: "folderEmpty" },
		},
		folderEmpty: {
			meta: { description: "The new folder, open and empty: its name as the page title, an envelope drawing and “You have no mails in this folder.” across the whole width, with no toolbar and no reading pane." },
		},
		folderMenu: {
			meta: { description: "A folder's menu in the sidebar, from the button that shows on hover: Configure and Delete." },
			on: { CONFIGURE: "folderSettings", DELETE: "deleteFolderConfirm" },
		},
		folderSettings: {
			meta: { description: "Configure opens Folder Settings, the New Folder form with the folder's name, icon and colour filled: renaming happens here." },
		},
		deleteFolderConfirm: {
			meta: { description: "Delete asks first: “Delete Beta feedback” with an amber warning icon, a line saying the folder's mails will be permanently removed, and a red Confirm." },
			on: { CONFIRM_DELETE: "folderDeleted" },
		},
		folderDeleted: {
			meta: { description: "Confirmed: a toast says “Folder deleted.” and the folder leaves the sidebar." },
		},
		rawLoading: {
			meta: { description: "The raw message page while its request is out: an empty white card, with no spinner and no text." },
		},
		rawMessage: {
			meta: {
				description:
					"See MIME Message from a message's More menu opens a new tab: MIME Message with Copy to Clipboard, and a Message Information table (an empty first row, then Message ID, Created at, Subject, From, To, CC, BCC). The raw source, which the page exists to show, is missing.",
			},
		},
		rawFailed: {
			meta: { description: "The raw page for a message that does not exist: a blank white screen. The server answers 500 with no message, the error branch reads the missing message and throws, and Mail's Error heading and Return to Home never appear." },
		},
		mailNotReady: {
			meta: { description: "The account's folder list came back empty: in place of Mail's sidebar and list, “Your mailbox is not ready”, a line saying Mail could not find the account's folders and to try again in a few minutes if the account is new, and Try again. It sits at the top of the page, not centred like Mail is unavailable." },
		},
		mailUnavailable: {
			meta: { description: "Administrator, who has no mail account, opens /mail: the shell's centred page says “Mail is unavailable”, “You don't have a Mail account.” and “Ask your admin to add one.” The rail has no Mail or Calendar icon." },
		},
	},
});

const ATTACHMENT_SUBJECT = "Beta launch kit: review deck and logo";
const SCREENED_SUBJECT = "Partnership enquiry for the Northwind beta";
const ADMINISTRATOR = { email: "Administrator", password: "admin" };

/** Pages other than the scene's own: the raw message's new tab, and Administrator's. */
const otherPage = perScene<Page>("mailViews: other page");
const OTHER_PAGE_STATES = new Set(["rawMessage", "mailUnavailable"]);

function sidebar(page: Page): Locator {
	return page.getByRole("complementary", { name: "Mail" });
}

function folderLink(page: Page): Locator {
	return sidebar(page).getByRole("link", { name: FOLDER_NAME });
}

export const mailViews = defineFlow<Event, BaseScene>({
	id: "mailViews",
	title: "Mail: other views",
	source: "frontend/src/apps/mail/pages/UnifiedFolderView.vue",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter(scene) {
		await deliverTestMail(scene);
		await scene.goto("/mail/all/inbox");
		await expect(scene.page.getByRole("link", { name: ATTACHMENT_SUBJECT })).toBeVisible();
	},
	frame(scene, state) {
		return OTHER_PAGE_STATES.has(state) ? otherPage.get(scene).locator("body") : null;
	},
	events: {
		async OPEN_SCREENER(scene) {
			await scene.goto(`/mail/account/${await personalAccount(scene.api)}/screener`);
			await expect(scene.page).toHaveURL(/\/mailbox\/inbox$/);
			await expect(scene.page.getByRole("link", { name: SCREENED_SUBJECT })).toBeVisible();
		},
		async OPEN_UNKNOWN_SENDER(scene) {
			await scene.page.getByRole("link", { name: SCREENED_SUBJECT }).click();
			await expect(scene.page.getByText("Do you want mail from")).toBeVisible();
		},
		async SEARCH_SLOW(scene) {
			await scene.hold(SEARCH_URL);
			await scene.goto(`/mail/account/${await personalAccount(scene.api)}/mailbox/search?text=CSV%20import`);
			await expect(scene.page.getByText("Searching…")).toBeVisible();
		},
		async SEARCH(scene) {
			await scene.goto(`/mail/account/${await personalAccount(scene.api)}/mailbox/search?text=CSV%20import`);
			await expect(scene.page.getByText(/^\d+ results?$/)).toBeVisible();
		},
		async SEARCH_MISS(scene) {
			await scene.goto(`/mail/account/${await personalAccount(scene.api)}/mailbox/search?text=zebra%20marmalade`);
			await expect(scene.page.getByText("No results found for the given query.")).toBeVisible();
		},
		async NEW_FOLDER(scene) {
			// Whatever the next step saves goes when the path closes.
			scene.defer(() => removeFolder(scene));
			// All Inboxes offers nothing tied to one account, New Folder included.
			await scene.goto("/mail");
			await sidebar(scene.page).getByRole("button", { name: "New Folder" }).click();
			await expect(scene.dialog("New Folder")).toBeVisible();
		},
		async CREATE(scene) {
			const dialog = scene.dialog("New Folder");
			await dialog.getByRole("textbox").first().fill(FOLDER_NAME);
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Folder created.")).toBeVisible();
			await expect(folderLink(scene.page)).toBeVisible();
		},
		async OPEN_FOLDER(scene) {
			await folderLink(scene.page).click();
			await expect(scene.page.getByText("You have no mails in this folder.")).toBeVisible();
		},
		async OPEN_FOLDER_MENU(scene) {
			await createFolder(scene);
			await scene.goto("/mail");
			const link = folderLink(scene.page);
			await link.hover();
			await link.locator("xpath=following::button[1]").click();
			await expect(scene.page.getByRole("menuitem", { name: "Configure" })).toBeVisible();
		},
		async CONFIGURE(scene) {
			await scene.page.getByRole("menuitem", { name: "Configure" }).click();
			await expect(scene.dialog("Folder Settings").getByRole("textbox").first()).toHaveValue(FOLDER_NAME);
		},
		async DELETE(scene) {
			await scene.page.getByRole("menuitem", { name: "Delete" }).click();
			await expect(scene.dialog(`Delete ${FOLDER_NAME}`)).toBeVisible();
		},
		async CONFIRM_DELETE(scene) {
			await scene.dialog(`Delete ${FOLDER_NAME}`).getByRole("button", { name: "Confirm" }).click();
			await expect(scene.toast("Folder deleted.")).toBeVisible();
			await expect(folderLink(scene.page)).toHaveCount(0);
		},
		async RAW_SLOW(scene) {
			await scene.hold(MIME_URL);
			const sent = scene.page.waitForRequest((request) => request.url().includes("get_mime_message"));
			await scene.goto("/mail/mime-message/held");
			await sent;
		},
		async OPEN_RAW(scene) {
			await scene.page.getByRole("link", { name: ATTACHMENT_SUBJECT }).click();
			await expect(scene.page.getByRole("heading", { level: 1, name: ATTACHMENT_SUBJECT })).toBeVisible();
			await scene.page.locator("[data-mail-name]").last().locator("button:has(svg.lucide-ellipsis)").first().click();
			const opened = scene.context.waitForEvent("page");
			await scene.page.getByRole("menuitem", { name: "See MIME Message" }).click();
			const raw = await opened;
			otherPage.set(scene, raw);
			await raw.setViewportSize(scene.page.viewportSize() ?? { width: 1440, height: 900 });
			await expect(raw.getByRole("heading", { name: "MIME Message" })).toBeVisible();
		},
		async RAW_MISSING(scene) {
			const failed = scene.page.waitForResponse((response) => response.url().includes("get_mime_message"));
			await scene.goto("/mail/mime-message/no-such-message");
			expect((await failed).status()).toBe(500);
			// The error branch reads `mime.error.messages[0]`, which this error lacks, so the page
			// throws while rendering and nothing replaces the blank screen.
			await expect(scene.page.getByRole("heading", { name: "MIME Message" })).toHaveCount(0);
		},
		async NO_FOLDERS(scene) {
			await scene.page.route(MAILBOXES_URL, (route) =>
				route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: [] }) }),
			);
			await scene.goto("/mail");
			await expect(scene.page.getByRole("heading", { name: "Your mailbox is not ready" })).toBeVisible();
		},
		async NO_MAIL_ACCOUNT(scene) {
			const page = await scene.pageAs(ADMINISTRATOR);
			otherPage.set(scene, page);
			await page.setViewportSize(scene.page.viewportSize() ?? { width: 1440, height: 900 });
			await page.goto("/mail");
			await expect(page.getByRole("heading", { name: "Mail is unavailable" })).toBeVisible();
		},
	},
});
