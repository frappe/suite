import { expect, type Locator, type Page } from "@playwright/test";
import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";
import { deliverTestMail, THREADS_URL } from "./mail-helpers";

type Event =
	| { type: "RELOAD_SLOW" }
	| { type: "RELOAD_FAILS" }
	| { type: "OPEN_PROMOTIONS" }
	| { type: "OPEN_SOCIAL" }
	| { type: "TICK_ROW" }
	| { type: "TICK_SECOND" }
	| { type: "OPEN_ACTIONS" }
	| { type: "OPEN_THREAD" }
	| { type: "OPEN_MESSAGE_MENU" }
	| { type: "OPEN_IMAGE" }
	| { type: "REPLY" }
	| { type: "FORWARD" }
	| { type: "OPEN_INVITE" }
	| { type: "PHONE" }
	| { type: "PHONE_OPEN_THREAD" };

/**
 * Maya's Inbox and the thread pane beside it. In the code the list's screen is
 * `MailboxView.vue`'s v-if chain: `isLoading` (seven conditions read in order),
 * then rows or `filter` or `inboxTab`, else the no-mail page. The pane is
 * `MailThread.vue`, where a reply or forward is a local draft spliced into the
 * thread (`createLocalDraft`).
 */
const machine = setupFlow<Event>().createMachine({
	id: "mail",
	initial: "inbox",
	states: {
		inbox: {
			meta: {
				description:
					"Maya's Inbox, split into tabs, on Primary. Three new mails head the list: an invitation, a first-time sender marked Unknown sender, and one with two attachments. The pane says to pick a mail.",
			},
			on: {
				RELOAD_SLOW: "inboxLoading",
				RELOAD_FAILS: "inboxFailed",
				OPEN_PROMOTIONS: "tabPromotions",
				OPEN_SOCIAL: "tabEmpty",
				TICK_ROW: "rowSelected",
				OPEN_THREAD: "threadOpen",
				OPEN_INVITE: "inviteThread",
				PHONE: "phoneInbox",
			},
		},
		inboxLoading: {
			meta: { description: "The Inbox loading after a reload: the tabs stay, but the toolbar and the reading pane are gone, and a spinner with “Loading...” sits in the middle of the page until the threads arrive." },
		},
		inboxFailed: {
			meta: {
				description:
					"The threads request failed. The list says “You have no mails in this folder.” under the toolbar and the pane says to select an email: the same screen as a real empty folder, with no error shown. Only the refresh icon in the toolbar can try again.",
			},
		},
		tabPromotions: {
			meta: { description: "The Promotions tab: the two Product Weekly newsletters. The Primary tab keeps its unread count." },
		},
		tabEmpty: {
			meta: { description: "The Social tab with no mail: “You have no mails in this folder.”, though this is a tab, not a folder." },
		},
		rowSelected: {
			meta: { description: "One row ticked: the toolbar reads “1 item selected” and the filter gives way to the bulk actions." },
			on: { TICK_SECOND: "twoSelected" },
		},
		twoSelected: {
			meta: { description: "Two rows ticked: “2 items selected”, the header checkbox shows a partial selection." },
			on: { OPEN_ACTIONS: "selectionActions" },
		},
		selectionActions: {
			meta: { description: "The folded menu for the two ticked threads, since the reading pane leaves the toolbar too little room: Mark as Read, Archive, Mark as Junk, Move to Trash, then Snooze, Pin to Top and Star. Move To and Folders keep their own buttons." },
		},
		threadOpen: {
			meta: {
				description:
					"Priya's mail open in the pane: the thread toolbar on top, the subject, the sender, the body, then “2 attachments” with a download-all icon and a chip per file, a reaction button, and Reply and Forward at the foot.",
			},
			on: { OPEN_MESSAGE_MENU: "messageMenu", OPEN_IMAGE: "attachmentViewer", REPLY: "replyInline", FORWARD: "forwardInline" },
		},
		messageMenu: {
			meta: {
				description:
					"The message's More menu: Reply and Forward; Star, Mark as Junk, Move to Trash, Mark as Unread, Filter Sender's Messages, Block Sender and Mark Domain as Trusted; then Download Email and See MIME Message.",
			},
		},
		attachmentViewer: {
			meta: { description: "Logo.png opened from its chip: the image full screen on a dark backdrop, the name top left, Print, Download and Close top right, and “2 of 2” with arrows to step through the mail's attachments." },
		},
		replyInline: {
			meta: { description: "Reply opens an editor inside the thread, under the message: Priya's address in To, an empty body, Send with its menu, the formatting bar and Discard. No subject field. Nothing is saved until something is typed." },
		},
		forwardInline: {
			meta: { description: "Forward opens an editor inside the thread: an empty To, no subject field, the forwarded-message header (From, Date, Subject, To) in the body, and both attachments carried over as removable chips with their sizes." },
		},
		inviteThread: {
			meta: {
				description:
					"Theo's invitation open: a card under the sender shows a date tile, “Beta launch walkthrough”, the time, length and room, and Yes, Maybe and No; invite.ics is listed below the body.",
			},
		},
		phoneInbox: {
			meta: { description: "The Inbox at phone width: a title row with the menu button and “Inbox”, a scrolling strip of the other tabs (Primary is the Inbox itself, so it has no tab), the filter row, a round Compose button, and the shell's bottom bar with Inbox, Search and Profile." },
			on: { PHONE_OPEN_THREAD: "phoneThread" },
		},
		phoneThread: {
			meta: { description: "A mail open at phone width: the thread covers the whole screen, with Back and the thread actions as icons in its top bar, and Reply and Forward fixed at the bottom." },
		},
	},
});

const ATTACHMENT_SUBJECT = "Beta launch kit: review deck and logo";
const INVITE_SUBJECT = "Invitation: Beta launch walkthrough";

function row(page: Page, subject: string): Locator {
	return page.getByRole("link", { name: subject });
}

/** The open thread: the column under the pane's subject heading. */
function pane(page: Page): Locator {
	return page.locator("[data-mail-name]").last();
}

async function openThread(page: Page, subject: string): Promise<void> {
	await row(page, subject).click();
	await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
}

async function waitForInbox(page: Page): Promise<void> {
	await expect(page.getByRole("tab", { name: /Primary/ })).toBeVisible();
	await expect(row(page, ATTACHMENT_SUBJECT)).toBeVisible();
}

export const mail = defineFlow<Event, BaseScene>({
	id: "mail",
	title: "Mail: mailbox and thread",
	source: "frontend/src/apps/mail/pages/MailboxView.vue",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter(scene) {
		await deliverTestMail(scene);
		await scene.goto("/mail");
		await waitForInbox(scene.page);
	},
	events: {
		async RELOAD_SLOW(scene) {
			await scene.hold(THREADS_URL);
			await scene.page.reload();
			await expect(scene.page.getByText("Loading...")).toBeVisible();
		},
		async RELOAD_FAILS(scene) {
			const hold = await scene.hold(THREADS_URL);
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByText("You have no mails in this folder.")).toBeVisible({ timeout: 30_000 });
		},
		async OPEN_PROMOTIONS(scene) {
			await scene.page.getByRole("tab", { name: "Promotions" }).click();
			await expect(scene.page.getByRole("tab", { name: "Promotions" })).toHaveAttribute("aria-selected", "true");
			await expect(scene.page.getByRole("link", { name: /Product Weekly/ }).first()).toBeVisible();
		},
		async OPEN_SOCIAL(scene) {
			await scene.page.getByRole("tab", { name: "Social" }).click();
			await expect(scene.page.getByRole("tab", { name: "Social" })).toHaveAttribute("aria-selected", "true");
			await expect(scene.page.getByText("You have no mails in this folder.")).toBeVisible();
		},
		async TICK_ROW(scene) {
			await row(scene.page, ATTACHMENT_SUBJECT).locator(".checkbox-hitbox").click();
			await expect(scene.page.getByText("1 item selected")).toBeVisible();
		},
		async TICK_SECOND(scene) {
			await row(scene.page, INVITE_SUBJECT).locator(".checkbox-hitbox").click();
			await expect(scene.page.getByText("2 items selected")).toBeVisible();
		},
		async OPEN_ACTIONS(scene) {
			await scene.page.locator("button:has(svg.lucide-ellipsis)").first().click();
			await expect(scene.page.getByRole("menu")).toBeVisible();
		},
		async OPEN_THREAD(scene) {
			await openThread(scene.page, ATTACHMENT_SUBJECT);
			await expect(scene.page.getByText("2 attachments")).toBeVisible();
		},
		async OPEN_MESSAGE_MENU(scene) {
			await pane(scene.page).locator("button:has(svg.lucide-ellipsis)").first().click();
			await expect(scene.page.getByRole("menuitem", { name: "See MIME Message" })).toBeVisible();
		},
		async OPEN_IMAGE(scene) {
			await pane(scene.page).getByText("Logo.png", { exact: true }).click();
			const viewer = scene.page.locator("[data-attachment-viewer]");
			await expect(viewer.getByRole("img", { name: "Logo.png" })).toBeVisible();
		},
		async REPLY(scene) {
			await scene.page.getByRole("button", { name: "Reply", exact: true }).last().click();
			const draft = scene.page.locator("[data-mail-name^='draft:']");
			await expect(draft.locator("[contenteditable='true']").first()).toBeVisible();
			await expect(draft.getByRole("button", { name: /priya@lumen-studio\.example/ })).toBeVisible();
		},
		async FORWARD(scene) {
			await scene.page.getByRole("button", { name: "Forward", exact: true }).last().click();
			const draft = scene.page.locator("[data-mail-name^='draft:']");
			await expect(draft.locator("[contenteditable='true']").first()).toBeVisible();
			await expect(draft.getByText("Logo.png")).toBeVisible();
		},
		async OPEN_INVITE(scene) {
			await openThread(scene.page, INVITE_SUBJECT);
			await expect(scene.page.getByRole("radio", { name: "Maybe" })).toBeVisible();
		},
		async PHONE(scene) {
			await scene.page.setViewportSize({ width: 390, height: 844 });
			await scene.page.reload();
			await expect(row(scene.page, ATTACHMENT_SUBJECT)).toBeVisible();
		},
		async PHONE_OPEN_THREAD(scene) {
			await row(scene.page, ATTACHMENT_SUBJECT).click();
			await expect(scene.page.getByRole("heading", { level: 1, name: ATTACHMENT_SUBJECT })).toBeVisible();
			// The list stays mounted under the thread, so check the thread's own foot.
			await expect(scene.page.getByRole("button", { name: "Forward", exact: true }).last()).toBeInViewport();
		},
	},
});
