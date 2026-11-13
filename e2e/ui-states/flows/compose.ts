import { expect, type Locator, type Page } from "@playwright/test";
import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";
import {
	cancelAsMaya,
	forgetMail,
	mayaAccount,
	onlyOwnSubmissions,
	recordWrites,
	rememberAccount,
	sendAsMaya,
	shapeSubmission,
} from "./compose-helpers";

type Event =
	| { type: "COMPOSE" }
	| { type: "TYPE_NAME" }
	| { type: "TYPE_BAD_ADDRESS" }
	| { type: "PRESS_ENTER" }
	| { type: "PICK_SUGGESTION" }
	| { type: "CLICK_CHIP" }
	| { type: "SHOW_CC_BCC" }
	| { type: "OPEN_CONTACTS" }
	| { type: "WRITE" }
	| { type: "SAVE_FAILS" }
	| { type: "RETRY_SAVE" }
	| { type: "CLOSE_UNSAVED" }
	| { type: "ATTACH" }
	| { type: "UPLOAD_FINISHES" }
	| { type: "UPLOAD_FAILS" }
	| { type: "ATTACH_TOO_BIG" }
	| { type: "DRAG_FILE" }
	| { type: "MINIMISE" }
	| { type: "EXPAND" }
	| { type: "CLOSE" }
	| { type: "SEND" }
	| { type: "SEND_GOES_THROUGH" }
	| { type: "SEND_FAILS" }
	| { type: "UNDO_SEND" }
	| { type: "OPEN_SEND_MENU" }
	| { type: "PICK_SCHEDULE" }
	| { type: "PICK_TOMORROW" }
	| { type: "DISCARD" }
	| { type: "UNDO_DISCARD" }
	| { type: "OPEN_OUTBOX" }
	| { type: "OPEN_OUTBOX_SLOW" }
	| { type: "LIST_FAILS" }
	| { type: "SHOW_FINAL" }
	| { type: "OPEN_FILTER" }
	| { type: "FILTER_NO_MATCH" }
	| { type: "OPEN_OUTBOX_SCHEDULED" }
	| { type: "OPEN_ROW_MENU" }
	| { type: "PICK_SEND_NOW" }
	| { type: "PICK_RESCHEDULE" }
	| { type: "PICK_CANCEL" }
	| { type: "CONFIRM_CANCEL" }
	| { type: "PHONE_WIDTH" }
	| { type: "OPEN_DETAILS_SLOW" }
	| { type: "DETAILS_LOAD" }
	| { type: "DETAILS_FAIL" }
	| { type: "OPEN_OUTBOX_SENT" }
	| { type: "OPEN_FINAL_ROW_MENU" }
	| { type: "PICK_SEND_AGAIN" }
	| { type: "OPEN_SENT_DETAILS" }
	| { type: "OPEN_QUEUED" }
	| { type: "OPEN_RETRYING" }
	| { type: "OPEN_FAILED" }
	| { type: "OPEN_DELIVERED" }
	| { type: "OPEN_READ" }
	| { type: "OPEN_CANCELLED" }
	| { type: "PHONE_COMPOSE" }
	| { type: "PHONE_TYPE_NAME" }
	| { type: "PHONE_MORE_ACTIONS" };

/**
 * Writing a mail in the desktop composer window and the phone's compose
 * page, then following it through the Outbox and a submission's details.
 * The composer's state is implied: `useComposeMail` keeps `isSavingDraft`,
 * `isSaveFailed`, `isDiscarding`, `sendMode` and the plain `pendingSave` and
 * `discarded` side by side, and the window adds `minimised` and `expanded`.
 */
const machine = setupFlow<Event>().createMachine({
	id: "compose",
	initial: "inbox",
	states: {
		inbox: {
			meta: { description: "Maya's Inbox, with the Compose button at the top right." },
			on: {
				COMPOSE: "composerEmpty",
				OPEN_OUTBOX: "outboxEmpty",
				OPEN_OUTBOX_SLOW: "outboxLoading",
				OPEN_OUTBOX_SCHEDULED: "outboxScheduled",
				OPEN_OUTBOX_SENT: "outboxSent",
				OPEN_CANCELLED: "detailsCancelled",
				PHONE_COMPOSE: "phoneCompose",
			},
		},
		composerEmpty: {
			meta: { description: "The New message window docked at the bottom right, with the From address, an empty To field that has focus, Subject and body. Send is disabled until there is a recipient." },
			on: { TYPE_NAME: "suggestions", TYPE_BAD_ADDRESS: "badAddressTyped", OPEN_CONTACTS: "contactsPicker" },
		},
		suggestions: {
			meta: { description: "Typing \"le\" in To lists matching contacts under the field, with Leo Park first." },
			on: { PICK_SUGGESTION: "addressed" },
		},
		badAddressTyped: {
			meta: { description: "\"jordan@northwind\" typed in To. It has no top-level domain, so it is not an address, but the list still offers it as a row to add, the same as a valid one." },
			on: { PRESS_ENTER: "badAddressDropped" },
		},
		badAddressDropped: {
			meta: { description: "Enter on the incomplete address clears the field and adds no chip. Nothing says why the text went away." },
		},
		contactsPicker: {
			meta: { description: "The To label opens Select Contacts, a dialog to search the address book and pick several recipients at once. It says \"No contacts.\", although typing in To finds Leo Park." },
		},
		addressed: {
			meta: { description: "Leo Park is a chip in To and Send is enabled." },
			on: { CLICK_CHIP: "chipMenu", SHOW_CC_BCC: "ccBcc", WRITE: "written" },
		},
		chipMenu: {
			meta: { description: "Clicking a recipient chip opens a menu with Move to Cc, Move to Bcc and Remove." },
		},
		ccBcc: {
			meta: { description: "The Cc and Bcc toggle adds a Cc and a Bcc field under To." },
		},
		written: {
			meta: { description: "Subject and body written. Autosave stored the draft two seconds after the last change, and nothing in the window says so." },
			on: {
				SAVE_FAILS: "saveFailed",
				ATTACH: "attachmentUploading",
				ATTACH_TOO_BIG: "attachmentTooBig",
				DRAG_FILE: "dropOverlay",
				MINIMISE: "minimised",
				EXPAND: "expanded",
				CLOSE: "closedDraftSaved",
				SEND: "sending",
				OPEN_SEND_MENU: "sendMenu",
				DISCARD: "discarded",
			},
		},
		saveFailed: {
			meta: { description: "An autosave was refused: \"Not saved · Retry\" appears at the right end of the toolbar, but the error toast \"Something went wrong\" sits on top of it until the toast goes." },
			on: { RETRY_SAVE: "savedAfterRetry", CLOSE_UNSAVED: "closedUnsaved" },
		},
		savedAfterRetry: {
			meta: { description: "Retry saved the draft and the \"Not saved · Retry\" button went away." },
		},
		closedUnsaved: {
			meta: { description: "Close after a refused save: the window goes, and only the earlier \"Something went wrong\" toast is on screen. The edits since the last good save were never stored, and the \"Draft not saved.\" toast with Reopen, which the code has for this case, does not appear." },
		},
		attachmentUploading: {
			meta: { description: "A picked file uploads: its pill under the body shows a spinner and a percentage, and Send is disabled until it finishes." },
			on: { UPLOAD_FINISHES: "attached", UPLOAD_FAILS: "attachmentFailed" },
		},
		attached: {
			meta: { description: "The upload finished: the pill shows the file's name and size, with a button to remove it." },
		},
		attachmentFailed: {
			meta: { description: "The upload failed: the pill is gone and an error toast says the file could not be uploaded." },
		},
		attachmentTooBig: {
			meta: { description: "A 26 MB file picked: no upload starts, and a toast says the file is too large and Mail attaches files up to 25 MB." },
		},
		dropOverlay: {
			meta: { description: "A file dragged over the window: the body is replaced by a dashed area that says \"Drop files to upload\"." },
		},
		minimised: {
			meta: { description: "Minimise folds the window into a bar at the bottom right that shows the subject. The whole bar restores it." },
		},
		expanded: {
			meta: { description: "Expand moves the window to the centre, larger, over a dimmed page. A click on the dimmed page minimises it." },
		},
		closedDraftSaved: {
			meta: { description: "Close on a written draft hides the window. Autosave had already stored it in Drafts, so no toast appears; \"Draft saved.\" shows only when a save is still running at close." },
		},
		sending: {
			meta: { description: "Send pressed while the server is slow: the window stays open as it was, Send is not disabled and shows no spinner, so nothing says the send is under way." },
			on: { SEND_GOES_THROUGH: "sent", SEND_FAILS: "sendFailed" },
		},
		sent: {
			meta: { description: "The window closed and a toast says \"Message sent.\" with Undo for the five seconds the server holds the mail, and View." },
			on: { UNDO_SEND: "sendUndone" },
		},
		sendUndone: {
			meta: { description: "Undo stopped the delivery: a toast says the message is back in Drafts." },
		},
		sendFailed: {
			meta: { description: "The server refused the send: the window stays open with the mail as written, and a \"Something went wrong\" toast covers the right half of the toolbar." },
		},
		sendMenu: {
			meta: { description: "The arrow beside Send opens a menu with Schedule send." },
			on: { PICK_SCHEDULE: "scheduleDialog" },
		},
		scheduleDialog: {
			meta: { description: "Schedule send: three presets with their times (Tomorrow morning, Tomorrow afternoon, Monday morning), a field to pick a date and time, and Schedule. A preset schedules at once; Schedule is for the picked time." },
			on: { PICK_TOMORROW: "scheduled" },
		},
		scheduled: {
			meta: { description: "A preset picked: the window closed and a toast says \"Send scheduled.\" with View, which opens the Outbox." },
		},
		discarded: {
			meta: { description: "Discard closes the window at once, with no confirm, and a toast \"Draft discarded.\" offers Undo. The draft is deleted only when the toast goes." },
			on: { UNDO_DISCARD: "discardUndone" },
		},
		discardUndone: {
			meta: { description: "Undo on the discard toast reopens the window with the draft as it was." },
		},
		outboxLoading: {
			meta: { description: "The Outbox while its list loads: the Pending, Final and Cancelled tabs and Filter, over skeleton rows." },
			on: { LIST_FAILS: "outboxFailed" },
		},
		outboxFailed: {
			meta: { description: "The list failed to load, and the Outbox says \"No pending submissions\", the same as an empty Outbox. Nothing says the load failed or offers a retry." },
		},
		outboxEmpty: {
			meta: { description: "Maya has nothing pending: \"No pending submissions\" and that scheduled mail and deliveries in flight wait here." },
			on: { SHOW_FINAL: "outboxFinalEmpty", OPEN_FILTER: "filterPopover" },
		},
		outboxFinalEmpty: {
			meta: { description: "The Final tab with nothing in it: \"No final submissions\" and what will appear here." },
		},
		filterPopover: {
			meta: { description: "Filter opens fields for Identity, Email ID, Thread ID and an After and Before date." },
			on: { FILTER_NO_MATCH: "filterNoMatches" },
		},
		filterNoMatches: {
			meta: { description: "An Email ID that matches nothing: \"No matching submissions\", a count of 1 on the Filter button, and Clear filters in the popover." },
		},
		outboxScheduled: {
			meta: { description: "One mail scheduled for two days from now, in Pending: Leo Park, the subject, the send time with how far away it is, a Pending badge, an Open email button and a row menu." },
			on: {
				OPEN_ROW_MENU: "rowMenu",
				PHONE_WIDTH: "outboxPhone",
				OPEN_DETAILS_SLOW: "detailsLoading",
			},
		},
		outboxPhone: {
			meta: { description: "The Outbox at phone width: the title \"Outbox\", the tabs and Filter, then the desktop table. Only To and part of Subject fit; Send at, Status and the row menu are off the right edge. A round Compose button floats above the bottom bar of Inbox, Search and Profile." },
		},
		rowMenu: {
			meta: { description: "The menu of a scheduled row: Send now, Reschedule and Cancel delivery." },
			on: { PICK_SEND_NOW: "sendNowConfirm", PICK_RESCHEDULE: "rescheduleDialog", PICK_CANCEL: "cancelConfirm" },
		},
		sendNowConfirm: {
			meta: { description: "Send now asks first: \"Deliver this email immediately instead of at the scheduled time?\" with Send." },
		},
		rescheduleDialog: {
			meta: { description: "Reschedule delivery: the same presets as Schedule send, with the field set to the current send time." },
		},
		cancelConfirm: {
			meta: { description: "Cancel delivery asks first, with a warning icon: cancel the delivery and move the message back to Drafts, with a red Confirm." },
			on: { CONFIRM_CANCEL: "deliveryCancelled" },
		},
		deliveryCancelled: {
			meta: { description: "Confirmed: the row left Pending, and a toast says the delivery is cancelled and the message is back in Drafts, with Open Drafts." },
		},
		detailsLoading: {
			meta: { description: "A submission's page while it loads: the Outbox breadcrumb alone, over a skeleton of the heading, actions and sections." },
			on: { DETAILS_LOAD: "detailsScheduled", DETAILS_FAIL: "detailsFailed" },
		},
		detailsFailed: {
			meta: { description: "The submission failed to load: the skeleton stays on screen and nothing says the load failed." },
		},
		detailsScheduled: {
			meta: { description: "A scheduled submission: a blue Scheduled dot with when it sends, the buttons Send now, Reschedule and Cancel delivery, then Activity (release to the mail server), Message, Envelope and Identifiers." },
		},
		outboxSent: {
			meta: { description: "A mail Maya sent, in the Final tab with a Final badge." },
			on: {
				OPEN_FINAL_ROW_MENU: "finalRowMenu",
				OPEN_SENT_DETAILS: "detailsSent",
				OPEN_QUEUED: "detailsQueued",
				OPEN_RETRYING: "detailsRetrying",
				OPEN_FAILED: "detailsFailedDelivery",
				OPEN_DELIVERED: "detailsDelivered",
				OPEN_READ: "detailsRead",
			},
		},
		finalRowMenu: {
			meta: { description: "The menu of a concluded row: Send again and Remove. Opening it scrolled the table sideways, so the To column and its header are out of view." },
			on: { PICK_SEND_AGAIN: "sendAgainConfirm" },
		},
		sendAgainConfirm: {
			meta: { description: "Send again asks first: \"Send this email again now?\" with Send. Behind it the table is still scrolled sideways, with the To column out of view." },
		},
		detailsSent: {
			meta: { description: "A sent submission with no delivery report: a grey Sent dot and \"Accepted by the mail server, no delivery report yet\", with Send again and Remove." },
		},
		detailsQueued: {
			meta: { description: "Handed to the mail server and waiting for the first attempt: a blue Sending dot with \"Handed to the mail server, waiting for the first attempt\", Cancel delivery while it can still be undone, and a \"Queued for\" entry in Activity. The local mail server delivers at once, so this answer is shaped." },
		},
		detailsRetrying: {
			meta: { description: "A deferred delivery: an amber Retrying dot with the time of the next attempt, the server's reason in Activity, and the next attempt as a pending entry. The local mail server never defers, so this answer is shaped." },
		},
		detailsFailedDelivery: {
			meta: { description: "A bounced delivery: a red Failed dot, \"Could not be delivered\", the server's rejection in Activity, and Send again and Remove. The local mail server never bounces, so this answer is shaped." },
		},
		detailsDelivered: {
			meta: { description: "A delivery report came back: a green Delivered dot and \"Delivery confirmed\". The local mail server sends no reports, so this answer is shaped." },
		},
		detailsRead: {
			meta: { description: "A read receipt came back too: a green Read dot and \"Delivered and read\". The local mail server sends no receipts, so this answer is shaped." },
		},
		detailsCancelled: {
			meta: { description: "A cancelled submission: a grey Cancelled dot with the time it was scheduled for, \"Delivery cancelled\" in Activity, and Remove." },
		},
		phoneCompose: {
			meta: { description: "At phone width Compose opens a page of its own: a close X, \"Compose Mail\", a three-dot menu and a send arrow in the header, then From, To and Subject. The body below Subject has no placeholder, so the page looks empty under it." },
			on: { PHONE_TYPE_NAME: "phoneSuggestions", PHONE_MORE_ACTIONS: "phoneMoreActions" },
		},
		phoneSuggestions: {
			meta: { description: "Contact suggestions on the phone page, inline under To at the full width, pushing Subject down." },
		},
		phoneMoreActions: {
			meta: { description: "More actions on the phone page: Schedule send, Remind me if no reply and Discard." },
		},
	},
});

const PHONE = { width: 390, height: 844 };
const SAVE = /suite\.mail\.api\.mail\.(create_mail|update_draft_mail)$/;
const UPDATE_DRAFT = /suite\.mail\.api\.mail\.update_draft_mail$/;
const UPLOAD = /suite\.mail\.api\.mail\.upload_file/;
const LIST = /suite\.mail\.api\.scheduled\.get_submissions/;
const DETAILS = /suite\.mail\.api\.scheduled\.get_scheduled_mail/;
const BODY = "Hi Leo,\n\nThe vendor shortlist is ready for your review. Two of the four quotes came in under budget.\n\nMaya";
/** About 400 KB of vendor quotes, so the upload is seen in progress. */
const QUOTES = Buffer.from(
	"vendor,item,quantity,unit_price\n" +
		Array.from({ length: 9000 }, (_, i) => `Vendor ${(i % 4) + 1},Desk chair model ${i},${(i % 12) + 1},${(120 + (i % 80)).toFixed(2)}`).join("\n"),
);
/** One mail the path seeded through the API, with the submission that carries it. */
const seeded = perScene<{ subject: string; submission: string }>("compose: seeded mail");

function composer(page: Page): Locator {
	return page.getByRole("dialog", { name: "New message" });
}

function toField(page: Page): Locator {
	return composer(page).locator("[data-recipient-input] input").first();
}

function chip(page: Page, name: string): Locator {
	return composer(page).locator("[data-recipient-input] button").filter({ hasText: name });
}

function option(page: Page, text: string): Locator {
	return page.getByRole("option").filter({ hasText: text });
}

function subjectOf(scene: BaseScene): string {
	return scene.name("Vendor shortlist for Q4");
}

/** Seeds a mail through the API, scheduled two days out or sent now, and opens the Outbox on its tab. */
async function seedAndOpenOutbox(scene: BaseScene, when: "scheduled" | "sent"): Promise<void> {
	const subject = subjectOf(scene);
	const sendAt = when === "scheduled" ? new Date(Date.now() + 2 * 86_400_000) : undefined;
	const mail = await sendAsMaya(scene, subject, sendAt);
	if (!mail.submission_id) throw new Error(`create_mail gave no submission for ${subject}`);
	seeded.set(scene, { subject, submission: mail.submission_id });
	await scene.goto(`/mail/account/${mayaAccount.get(scene)}/outbox`);
	if (when === "sent") await scene.page.getByRole("radio", { name: "Final", exact: true }).click();
	// A plain send sits in Pending for the server's undo period before it turns final.
	await expect(outboxRow(scene)).toBeVisible({ timeout: 45_000 });
}

function outboxRow(scene: BaseScene): Locator {
	return scene.page.getByRole("link").filter({ hasText: seeded.get(scene).subject });
}

/**
 * Schedules a mail to Leo two days out and cancels it. Once in a full run the
 * server answered the cancel with "already been delivered" for a mail scheduled
 * seconds earlier, so a refused cancel gets one more try with a new mail.
 * `forgetMail` removes both copies.
 */
async function scheduleAndCancel(scene: BaseScene, subject: string): Promise<{ submission_id: string }> {
	for (let attempt = 1; ; attempt++) {
		const mail = await sendAsMaya(scene, subject, new Date(Date.now() + 2 * 86_400_000));
		if (!mail.submission_id) throw new Error(`create_mail gave no submission for ${subject}`);
		try {
			await cancelAsMaya(scene, mail.submission_id);
			return { submission_id: mail.submission_id };
		} catch (error) {
			if (attempt === 2 || !String(error).includes("already been delivered")) throw error;
		}
	}
}

async function openRowMenu(scene: BaseScene): Promise<Locator> {
	await outboxRow(scene).getByRole("button").last().click();
	return scene.page.getByRole("menu");
}

async function openDetails(scene: BaseScene, heading: string): Promise<void> {
	await outboxRow(scene).click();
	await expect(scene.page.getByRole("heading", { name: seeded.get(scene).subject })).toBeVisible();
	await expect(scene.page.getByText(heading, { exact: true }).first()).toBeVisible();
}

async function pick(page: Page, text: string): Promise<void> {
	await page.getByRole("menuitem", { name: text }).click();
}

export const compose = defineFlow<Event, BaseScene>({
	id: "compose",
	title: "Compose and outbox",
	source: "frontend/src/apps/mail/composables/useComposeMail.ts",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter(scene) {
		await rememberAccount(scene);
		recordWrites(scene);
		await onlyOwnSubmissions(scene);
		scene.defer(() => forgetMail(scene));
		await scene.goto(`/mail/account/${mayaAccount.get(scene)}/mailbox/inbox`);
		await expect(scene.page.getByRole("button", { name: "Compose", exact: true })).toBeVisible();
	},
	events: {
		async COMPOSE(scene) {
			await scene.page.getByRole("button", { name: "Compose", exact: true }).click();
			await expect(composer(scene.page)).toBeVisible();
			await expect(composer(scene.page).getByRole("textbox", { name: "Subject" })).toBeVisible();
		},
		async TYPE_NAME(scene) {
			await toField(scene.page).pressSequentially("le");
			await expect(option(scene.page, "Leo Park")).toBeVisible();
		},
		async TYPE_BAD_ADDRESS(scene) {
			await toField(scene.page).pressSequentially("jordan@northwind");
			await expect(option(scene.page, "jordan@northwind")).toBeVisible();
		},
		async PRESS_ENTER(scene) {
			await toField(scene.page).press("Enter");
			await expect(toField(scene.page)).toHaveValue("");
			await expect(chip(scene.page, "jordan")).toHaveCount(0);
		},
		async PICK_SUGGESTION(scene) {
			await option(scene.page, "Leo Park").click();
			await expect(chip(scene.page, "Leo Park")).toBeVisible();
		},
		async CLICK_CHIP(scene) {
			await chip(scene.page, "Leo Park").click();
			await expect(scene.page.getByText("Move to Cc", { exact: true })).toBeVisible();
		},
		async SHOW_CC_BCC(scene) {
			await composer(scene.page).getByRole("button", { name: "Show Cc and Bcc" }).click();
			await expect(composer(scene.page).getByText("Bcc", { exact: true })).toBeVisible();
		},
		async OPEN_CONTACTS(scene) {
			await composer(scene.page).getByRole("button", { name: "To", exact: true }).click();
			await expect(scene.dialog("Select Contacts")).toBeVisible();
		},
		async WRITE(scene) {
			const win = composer(scene.page);
			await win.getByRole("textbox", { name: "Subject" }).fill(subjectOf(scene));
			const saved = scene.page.waitForResponse((response) => SAVE.test(response.url()) && response.ok(), { timeout: 15_000 });
			await win.locator("[contenteditable=true]").first().click();
			await scene.page.keyboard.type(BODY);
			await saved;
		},
		async SAVE_FAILS(scene) {
			await scene.hold(UPDATE_DRAFT);
			const asked = scene.page.waitForRequest(UPDATE_DRAFT, { timeout: 15_000 });
			await composer(scene.page).locator("[contenteditable=true]").first().press("Control+End");
			await scene.page.keyboard.press("Enter");
			await scene.page.keyboard.type("P.S. The other two need another round.");
			await asked;
			await scene.lastHold.abort(500);
			await expect(composer(scene.page).getByRole("button", { name: "Not saved · Retry" })).toBeVisible({ timeout: 30_000 });
		},
		async RETRY_SAVE(scene) {
			await scene.lastHold.release();
			await composer(scene.page).getByRole("button", { name: "Not saved · Retry" }).click();
			await expect(composer(scene.page).getByRole("button", { name: "Not saved · Retry" })).toBeHidden({ timeout: 15_000 });
		},
		async CLOSE_UNSAVED(scene) {
			await composer(scene.page).getByRole("button", { name: "Close" }).click();
			await expect(composer(scene.page)).toBeHidden();
		},
		async ATTACH(scene) {
			await scene.hold(UPLOAD);
			await composer(scene.page)
				.locator("input[type=file][multiple]:not([accept])")
				.setInputFiles({ name: "Vendor quotes.csv", mimeType: "text/csv", buffer: QUOTES });
			await expect(composer(scene.page).getByText(/\d+\s*%/)).toBeVisible();
		},
		async UPLOAD_FINISHES(scene) {
			await scene.lastHold.release();
			await expect(composer(scene.page).getByText(/\d+\s*%/)).toBeHidden({ timeout: 15_000 });
			await expect(composer(scene.page).getByRole("button", { name: "Remove Vendor quotes.csv" })).toBeVisible();
		},
		async UPLOAD_FAILS(scene) {
			await scene.lastHold.abort(500);
			await expect(composer(scene.page).getByText(/\d+\s*%/)).toBeHidden({ timeout: 30_000 });
			await expect(scene.toast(/Failed to upload|Something went wrong/)).toBeVisible();
		},
		async ATTACH_TOO_BIG(scene) {
			await composer(scene.page)
				.locator("input[type=file][multiple]:not([accept])")
				.setInputFiles({ name: "Site survey.mov", mimeType: "video/quicktime", buffer: Buffer.alloc(26 * 1024 * 1024) });
			await expect(scene.toast(/Mail can attach files up to/)).toBeVisible();
		},
		async DRAG_FILE(scene) {
			const transfer = await scene.page.evaluateHandle(() => {
				const data = new DataTransfer();
				data.items.add(new File(["x"], "Vendor quotes.pdf", { type: "application/pdf" }));
				return data;
			});
			await composer(scene.page).locator("[contenteditable=true]").first().dispatchEvent("dragenter", { dataTransfer: transfer });
			await expect(composer(scene.page).getByText("Drop files to upload")).toBeVisible();
		},
		async MINIMISE(scene) {
			await composer(scene.page).getByRole("button", { name: "Minimise" }).click();
			await expect(composer(scene.page).getByRole("button", { name: "Restore" })).toBeVisible();
		},
		async EXPAND(scene) {
			await composer(scene.page).getByRole("button", { name: "Expand" }).click();
			await expect(composer(scene.page).getByRole("button", { name: "Shrink" })).toBeVisible();
		},
		async CLOSE(scene) {
			await composer(scene.page).getByRole("button", { name: "Close" }).click();
			await expect(composer(scene.page)).toBeHidden();
		},
		async SEND(scene) {
			await scene.hold(UPDATE_DRAFT);
			const asked = scene.page.waitForRequest(UPDATE_DRAFT);
			await composer(scene.page).getByRole("button", { name: "Send", exact: true }).click();
			await asked;
		},
		async SEND_GOES_THROUGH(scene) {
			await scene.lastHold.release();
			await expect(scene.toast("Message sent.")).toBeVisible({ timeout: 15_000 });
		},
		async SEND_FAILS(scene) {
			const answered = scene.page.waitForResponse((response) => UPDATE_DRAFT.test(response.url()) && response.status() === 500);
			await scene.lastHold.abort(500);
			await answered;
			await expect(composer(scene.page)).toBeVisible();
		},
		async UNDO_SEND(scene) {
			await scene.page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect(scene.toast(/Sending undone/)).toBeVisible({ timeout: 15_000 });
		},
		async OPEN_SEND_MENU(scene) {
			await composer(scene.page).getByRole("button", { name: "Schedule send" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Schedule send" })).toBeVisible();
		},
		async PICK_SCHEDULE(scene) {
			await pick(scene.page, "Schedule send");
			await expect(scene.dialog("Schedule send")).toBeVisible();
		},
		async PICK_TOMORROW(scene) {
			await scene.dialog("Schedule send").getByRole("button", { name: /Tomorrow morning/ }).click();
			await expect(scene.toast("Send scheduled.")).toBeVisible({ timeout: 15_000 });
		},
		async DISCARD(scene) {
			await composer(scene.page).getByRole("button", { name: "Discard" }).click();
			await expect(scene.toast("Draft discarded.")).toBeVisible();
		},
		async UNDO_DISCARD(scene) {
			await scene.page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect(composer(scene.page).getByRole("textbox", { name: "Subject" })).toHaveValue(subjectOf(scene));
		},
		async OPEN_OUTBOX(scene) {
			await scene.goto(`/mail/account/${mayaAccount.get(scene)}/outbox`);
			await expect(scene.page.getByText("No pending submissions")).toBeVisible();
		},
		async OPEN_OUTBOX_SLOW(scene) {
			await scene.hold(LIST);
			await scene.goto(`/mail/account/${mayaAccount.get(scene)}/outbox`);
			await expect(scene.page.getByRole("button", { name: "Filter" })).toBeVisible();
		},
		async LIST_FAILS(scene) {
			await scene.lastHold.abort(500);
			await expect(scene.page.getByText("No pending submissions")).toBeVisible({ timeout: 30_000 });
		},
		async SHOW_FINAL(scene) {
			await scene.page.getByRole("radio", { name: "Final", exact: true }).click();
			await expect(scene.page.getByText("No final submissions")).toBeVisible();
		},
		async OPEN_FILTER(scene) {
			await scene.page.getByRole("button", { name: "Filter" }).click();
			await expect(scene.page.getByLabel("Thread ID")).toBeVisible();
		},
		async FILTER_NO_MATCH(scene) {
			await scene.page.getByLabel("Email ID").fill("does-not-exist");
			await expect(scene.page.getByText("No matching submissions")).toBeVisible();
			await expect(scene.page.getByRole("button", { name: "Clear filters" })).toBeVisible();
		},
		async OPEN_OUTBOX_SCHEDULED(scene) {
			await seedAndOpenOutbox(scene, "scheduled");
		},
		async OPEN_ROW_MENU(scene) {
			const menu = await openRowMenu(scene);
			await expect(menu.getByRole("menuitem", { name: "Cancel delivery" })).toBeVisible();
		},
		async PICK_SEND_NOW(scene) {
			await pick(scene.page, "Send now");
			await expect(scene.dialog("Send Now")).toBeVisible();
		},
		async PICK_RESCHEDULE(scene) {
			await pick(scene.page, "Reschedule");
			await expect(scene.dialog("Reschedule delivery")).toBeVisible();
		},
		async PICK_CANCEL(scene) {
			await pick(scene.page, "Cancel delivery");
			await expect(scene.dialog("Cancel Delivery")).toBeVisible();
		},
		async CONFIRM_CANCEL(scene) {
			await scene.dialog("Cancel Delivery").getByRole("button", { name: "Confirm" }).click();
			await expect(scene.toast(/back in your drafts/)).toBeVisible({ timeout: 15_000 });
			await expect(outboxRow(scene)).toBeHidden();
		},
		async PHONE_WIDTH(scene) {
			await scene.page.setViewportSize(PHONE);
			await scene.page.reload();
			await expect(scene.page.getByRole("button", { name: "Filter" })).toBeVisible();
			await expect(outboxRow(scene)).toBeVisible();
		},
		async OPEN_DETAILS_SLOW(scene) {
			await scene.hold(DETAILS);
			await outboxRow(scene).click();
			await expect(scene.page.getByRole("status", { name: "Loading" })).toBeVisible();
		},
		async DETAILS_LOAD(scene) {
			await scene.lastHold.release();
			await expect(scene.page.getByRole("button", { name: "Reschedule" })).toBeVisible();
		},
		async DETAILS_FAIL(scene) {
			const answered = scene.page.waitForResponse((response) => DETAILS.test(response.url()) && response.status() === 500);
			await scene.lastHold.abort(500);
			await answered;
			// The transport retries a server error; wait out its retries before the screenshot.
			await scene.page.waitForTimeout(8_000);
			await expect(scene.page.getByRole("status", { name: "Loading" })).toBeVisible();
		},
		async OPEN_OUTBOX_SENT(scene) {
			await seedAndOpenOutbox(scene, "sent");
		},
		async OPEN_FINAL_ROW_MENU(scene) {
			const menu = await openRowMenu(scene);
			await expect(menu.getByRole("menuitem", { name: "Send again" })).toBeVisible();
		},
		async PICK_SEND_AGAIN(scene) {
			await pick(scene.page, "Send again");
			await expect(scene.dialog("Send Again")).toBeVisible();
		},
		async OPEN_SENT_DETAILS(scene) {
			await openDetails(scene, "Sent");
		},
		async OPEN_QUEUED(scene) {
			await shapeSubmission(scene.page, "queued");
			await openDetails(scene, "Sending");
		},
		async OPEN_RETRYING(scene) {
			await shapeSubmission(scene.page, "retrying");
			await openDetails(scene, "Retrying");
		},
		async OPEN_FAILED(scene) {
			await shapeSubmission(scene.page, "failed");
			await openDetails(scene, "Failed");
		},
		async OPEN_DELIVERED(scene) {
			await shapeSubmission(scene.page, "delivered");
			await openDetails(scene, "Delivered");
		},
		async OPEN_READ(scene) {
			await shapeSubmission(scene.page, "displayed");
			await openDetails(scene, "Read");
		},
		async OPEN_CANCELLED(scene) {
			const subject = subjectOf(scene);
			const mail = await scheduleAndCancel(scene, subject);
			seeded.set(scene, { subject, submission: mail.submission_id });
			await scene.goto(`/mail/account/${mayaAccount.get(scene)}/outbox/${mail.submission_id}`);
			await expect(scene.page.getByRole("heading", { name: subject })).toBeVisible();
			await expect(scene.page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
		},
		async PHONE_COMPOSE(scene) {
			// The layout picks phone or desktop as it loads; it does not switch on a resize.
			await scene.page.setViewportSize(PHONE);
			await scene.page.reload();
			await scene.page.getByRole("button", { name: "Compose", exact: true }).click();
			await expect(scene.page.getByText("Compose Mail", { exact: true })).toBeVisible();
		},
		async PHONE_TYPE_NAME(scene) {
			await scene.page.locator("[data-recipient-input] input").first().pressSequentially("le");
			// The phone page lists suggestions inline, not as a listbox.
			await expect(scene.page.getByText("leo@northwind.test")).toBeVisible();
		},
		async PHONE_MORE_ACTIONS(scene) {
			await scene.page.getByRole("button", { name: "More actions" }).click();
			await expect(scene.page.getByText("Remind me if no reply")).toBeVisible();
		},
	},
});
