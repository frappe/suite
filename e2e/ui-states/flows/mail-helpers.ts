import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_URL } from "../demo";
import { fixture } from "../content";
import type { BaseScene } from "../scene";

/**
 * Test mail for the Mail flow, delivered straight into a demo person's
 * Stalwart account over JMAP, the way `suite/composition/demo/mail.py`
 * imports the seed. Every message carries a Message-ID that starts with
 * `ui-states-mail-`, so a path removes what it delivered, and `enter` removes
 * what an interrupted path left behind.
 */

const MAIL = "urn:ietf:params:jmap:mail";
const API = "**/api/method/suite.mail.api";
export const THREADS_URL = `${API}.mail.get_threads`;
export const SEARCH_URL = `${API}.mail.search_mails`;
export const MAILBOXES_URL = `${API}.mail.get_mailboxes`;
export const MIME_URL = `${API}.mail.get_mime_message`;
const USING = ["urn:ietf:params:jmap:core", MAIL];
export const MESSAGE_ID_PREFIX = "ui-states-mail-";

interface StalwartConfig {
	server_url: string;
	username: string;
	password: string;
}

function stalwartConfig(): StalwartConfig {
	const bench = process.env.E2E_BENCH_PATH;
	if (!bench) throw new Error("E2E_BENCH_PATH must name the bench that serves the demo site");
	const site = new URL(DEMO_URL).hostname;
	// SAFETY: the demo site's config holds the `mail` block the seed itself reads (see suite/mail/dev_stalwart.py).
	const config = JSON.parse(readFileSync(resolve(bench, "sites", site, "site_config.json"), "utf8")) as { mail?: StalwartConfig };
	if (!config.mail) throw new Error(`${site} has no mail config`);
	return config.mail;
}

/** One person's mail over JMAP, signed in through the Stalwart admin's master login. */
export class Mailbox {
	private constructor(
		private readonly url: string,
		private readonly auth: string,
		private readonly account: string,
	) {}

	static async open(email: string): Promise<Mailbox> {
		const config = stalwartConfig();
		const url = config.server_url.replace(/\/$/, "");
		const auth = `Basic ${Buffer.from(`${email}%${config.username}:${config.password}`).toString("base64")}`;
		const response = await fetch(`${url}/.well-known/jmap`, { headers: { Authorization: auth } });
		if (!response.ok) throw new Error(`JMAP session for ${email} failed: ${response.status}`);
		// SAFETY: a JMAP session object names the primary account per capability.
		const session = (await response.json()) as { primaryAccounts: Record<string, string> };
		const account = session.primaryAccounts[MAIL];
		if (!account) throw new Error(`${email} has no mail account`);
		return new Mailbox(url, auth, account);
	}

	private async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
		const body = { using: USING, methodCalls: [[method, { accountId: this.account, ...args }, "0"]] };
		const response = await fetch(`${this.url}/jmap/`, {
			method: "POST",
			headers: { Authorization: this.auth, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!response.ok) throw new Error(`${method} failed: ${response.status}`);
		// SAFETY: a JMAP response holds one method response per call made.
		const [[name, result]] = ((await response.json()) as { methodResponses: [string, T][] }).methodResponses;
		if (name === "error") throw new Error(`${method} failed: ${JSON.stringify(result)}`);
		return result;
	}

	private async inbox(): Promise<string> {
		const { list } = await this.call<{ list: { id: string; role: string | null }[] }>("Mailbox/get", {});
		const inbox = list.find((mailbox) => mailbox.role === "inbox");
		if (!inbox) throw new Error("No Inbox");
		return inbox.id;
	}

	/** Imports raw messages into the Inbox, received now, and returns their ids. */
	async deliver(messages: { raw: string; keywords?: string[] }[]): Promise<string[]> {
		const inbox = await this.inbox();
		const emails: Record<string, unknown> = {};
		for (const [index, message] of messages.entries()) {
			const upload = await fetch(`${this.url}/jmap/upload/${this.account}/`, {
				method: "POST",
				headers: { Authorization: this.auth, "Content-Type": "message/rfc822" },
				body: message.raw,
			});
			if (!upload.ok) throw new Error(`Upload failed: ${upload.status}`);
			// SAFETY: a JMAP upload answers with the blob it stored.
			const { blobId } = (await upload.json()) as { blobId: string };
			const keywords = Object.fromEntries((message.keywords ?? []).map((keyword) => [keyword, true]));
			emails[`m${index}`] = { blobId, mailboxIds: { [inbox]: true }, keywords, receivedAt: new Date().toISOString() };
		}
		const { created } = await this.call<{ created?: Record<string, { id: string }> }>("Email/import", { emails });
		return Object.values(created ?? {}).map((email) => email.id);
	}

	/**
	 * Removes every message this flow delivered, from every folder. Stalwart's
	 * header filter does not match part of a Message-ID, so this reads the
	 * Message-ID of every message the account holds; a demo account holds a few
	 * hundred at most.
	 */
	async removeDelivered(): Promise<void> {
		const { ids } = await this.call<{ ids: string[] }>("Email/query", { limit: 5000 });
		if (!ids.length) return;
		const { list } = await this.call<{ list: { id: string; messageId: string[] | null }[] }>("Email/get", {
			ids,
			properties: ["messageId"],
		});
		const ours = list.filter((email) => email.messageId?.some((id) => id.startsWith(MESSAGE_ID_PREFIX))).map((email) => email.id);
		if (ours.length) await this.call("Email/set", { destroy: ours });
	}
}

export interface Letter {
	from: string;
	subject: string;
	html: string;
	/** Unique per path and message, after MESSAGE_ID_PREFIX. */
	id: string;
	attachments?: { filename: string; type: string; content: Buffer }[];
	/** A text/calendar invitation, sent as `invite.ics` like the seed's. */
	calendar?: string;
}

const MAYA = "Maya Chen <maya@northwind.test>";

function base64Lines(content: Buffer): string {
	return content.toString("base64").replace(/.{76}/g, "$&\r\n");
}

/** A multipart message to Maya: text and HTML alternatives, then any attachments. */
export function compose(letter: Letter): string {
	const mixed = `mixed-${letter.id}`;
	const alternative = `alt-${letter.id}`;
	const text = letter.html.replace(/<[^>]+>/g, "").trim();
	const parts = [
		`--${alternative}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`,
		`--${alternative}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${letter.html}\r\n`,
		`--${alternative}--\r\n`,
	];
	const attachments = (letter.attachments ?? []).map(
		(file) =>
			`--${mixed}\r\nContent-Type: ${file.type}; name="${file.filename}"\r\nContent-Disposition: attachment; filename="${file.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(file.content)}\r\n`,
	);
	if (letter.calendar) {
		attachments.push(
			`--${mixed}\r\nContent-Type: text/calendar; charset=utf-8; method=REQUEST; name="invite.ics"\r\nContent-Disposition: attachment; filename="invite.ics"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(Buffer.from(letter.calendar))}\r\n`,
		);
	}
	const headers = [
		`From: ${letter.from}`,
		`To: ${MAYA}`,
		`Subject: ${letter.subject}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${MESSAGE_ID_PREFIX}${letter.id}@northwind.test>`,
		"MIME-Version: 1.0",
		`Content-Type: multipart/mixed; boundary="${mixed}"`,
	];
	return `${headers.join("\r\n")}\r\n\r\n--${mixed}\r\nContent-Type: multipart/alternative; boundary="${alternative}"\r\n\r\n${parts.join("")}${attachments.join("")}--${mixed}--\r\n`;
}

function icsDate(date: Date): string {
	return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** An invitation from Theo to Maya, next week, for an event no calendar holds yet. */
export function invitation(uid: string, start: Date): string {
	return [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Northwind Labs//UI states//EN",
		"METHOD:REQUEST",
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${icsDate(new Date())}`,
		`DTSTART:${icsDate(start)}`,
		"DURATION:PT45M",
		"SUMMARY:Beta launch walkthrough",
		"LOCATION:Studio room",
		"ORGANIZER;CN=Theo Okafor:mailto:theo@northwind.test",
		"ATTENDEE;CN=Theo Okafor;ROLE=CHAIR;PARTSTAT=ACCEPTED:mailto:theo@northwind.test",
		"ATTENDEE;CN=Maya Chen;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:maya@northwind.test",
		"END:VEVENT",
		"END:VCALENDAR",
		"",
	].join("\r\n");
}

/** The three letters every Mail path starts with, newest last so the first one heads the list. */
export function testLetters(stamp: string): { raw: string; keywords?: string[] }[] {
	const start = new Date(Date.now() + 6 * 24 * 3600 * 1000);
	start.setUTCHours(9, 30, 0, 0);
	return [
		{
			raw: compose({
				id: `${stamp}-invite`,
				from: "Theo Okafor <theo@northwind.test>",
				subject: "Invitation: Beta launch walkthrough",
				html: "<p>Hi Maya,</p><p>Let's walk through the launch plan together before the beta opens. I booked the studio room.</p><p>Theo</p>",
				calendar: invitation(`ui-states-mail-${stamp}@northwind.test`, start),
			}),
		},
		{
			raw: compose({
				id: `${stamp}-screened`,
				from: "Dana Whitfield <dana@brightline-partners.example>",
				subject: "Partnership enquiry for the Northwind beta",
				html: "<p>Hello Maya,</p><p>We run onboarding for several analytics teams and would like to offer Northwind to our customers during the beta. Could we find 30 minutes next week?</p><p>Best,<br>Dana Whitfield<br>Brightline Partners</p>",
			}),
			keywords: ["unscreened"],
		},
		{
			raw: compose({
				id: `${stamp}-assets`,
				from: "Priya Raman <priya@lumen-studio.example>",
				subject: "Beta launch kit: review deck and logo",
				html: "<p>Hi Maya,</p><p>Attached are the quarter review deck and the final logo for the beta launch page. Could you look at the pricing slide before Thursday?</p><p>Thanks,<br>Priya<br>Lumen Studio</p>",
				attachments: [
					{ filename: "Quarter review.pdf", type: "application/pdf", content: fixture("Quarter review.pdf") },
					{ filename: "Logo.png", type: "image/png", content: fixture("Logo.png") },
				],
			}),
		},
	];
}

/**
 * Puts the three test letters in Maya's Inbox for this path, after removing
 * any an interrupted path left, and removes them when the scene closes.
 */
export async function deliverTestMail(scene: BaseScene): Promise<void> {
	const maya = await Mailbox.open("maya@northwind.test");
	await maya.removeDelivered();
	scene.defer(() => maya.removeDelivered());
	await maya.deliver(testLetters(Date.now().toString(36)));
}

/** The reader's own folder the folder states make, and remove when the path closes. */
export const FOLDER_NAME = "Beta feedback";
const METHOD = "/api/method/suite.mail.api";

async function post<T>(scene: BaseScene, method: string, data: Record<string, unknown>): Promise<T> {
	const response = await scene.api.post(`${METHOD}.${method}`, { data });
	if (!response.ok()) throw new Error(`${method} failed: ${response.status()} ${await response.text()}`);
	// SAFETY: a whitelisted method answers `{ message }`, typed by its caller.
	return ((await response.json()) as { message: T }).message;
}

/** The signed-in person's mail account id, as Mail's URLs name it. */
export async function mailAccount(scene: BaseScene): Promise<string> {
	const user = await post<{ accounts: { id: string }[] }>(scene, "account.get_user_info", {});
	const account = user.accounts[0]?.id;
	if (!account) throw new Error("The signed-in person has no mail account");
	return account;
}

/** Creates FOLDER_NAME through Mail's own API, after removing one left behind. */
export async function createFolder(scene: BaseScene): Promise<void> {
	await removeFolder(scene);
	scene.defer(() => removeFolder(scene));
	await post(scene, "mail.create_mailbox", { account: await mailAccount(scene), name: FOLDER_NAME, icon: "folder", color: "Gray" });
}

/** Deletes every folder called FOLDER_NAME through Mail's own API. */
export async function removeFolder(scene: BaseScene): Promise<void> {
	const account = await mailAccount(scene);
	const folders = await post<{ id: string; _name: string }[]>(scene, "mail.get_mailboxes", { account });
	for (const folder of folders.filter((mailbox) => mailbox._name === FOLDER_NAME)) {
		await post(scene, "mail.delete_mailbox", { account, id: folder.id, name: folder._name });
	}
}
