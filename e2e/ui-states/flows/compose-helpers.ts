import type { APIRequestContext, Page } from "@playwright/test";
import { demoUser, identityOf, personalAccount } from "../demo";
import { callMethod, perScene, unlessRefused, type BaseScene } from "../scene";

/**
 * Mail calls the compose flow seeds and cleans up with. Every mail the flow
 * writes carries the path's own token in its subject, so cleanup finds it by
 * that token in every mailbox it reached.
 */

const MAYA = identityOf("maya");
const LEO = identityOf("leo");
/** Leo as a recipient, the way the composer sends one. */
export const LEO_RECIPIENT = { email: LEO.email, display_name: LEO.name };

/** Maya's mail account, which Mail's URLs and every call here name. Read in `enter`. */
export const mayaAccount = perScene<string>("compose: Maya's mail account");

type Json = Record<string, unknown>;

/** One row of a submission's `recipients_status`. */
type RecipientStatus = {
	email: string;
	status: Delivery;
	reason: string | null;
	smtp_reply: string | null;
	delivered: string | null;
	displayed: string | null;
	retries: number;
	next_retry: string | null;
};

function call<T>(api: APIRequestContext, method: string, data: Json): Promise<T> {
	return callMethod<T>(api, `suite.mail.api.${method}`, data);
}

/** Reads Maya's account for this path, for `mayaAccount`. */
export async function rememberAccount(scene: BaseScene): Promise<void> {
	mayaAccount.set(scene, await personalAccount(scene.api));
}

/** The text every mail of this path carries in its subject. */
export function tokenOf(scene: BaseScene): string {
	return scene.name("").trim();
}

interface MailResult {
	id: string;
	submission_id: string | null;
	thread_id: string | null;
}

/** Ids of every draft and sent copy this path's page wrote, so cleanup can delete them. */
const written = perScene<Set<string>>("compose: written mail ids");

/** Records the id of every mail the page saves or sends, from the server's own answers. */
export function recordWrites(scene: BaseScene): void {
	const ids = new Set<string>();
	written.set(scene, ids);
	scene.page.on("response", async (response) => {
		if (!/suite\.mail\.api\.mail\.(create_mail|update_draft_mail)$/.test(response.url())) return;
		// SAFETY: both methods answer `{message: {id, ...}}`, or an error with no `message`.
		const body = (await response.json().catch(() => null)) as { message?: { id?: string } } | null;
		if (body?.message?.id) ids.add(body.message.id);
	});
}

/** Creates a mail from Maya to Leo through the same call the composer makes. */
export async function sendAsMaya(scene: BaseScene, subject: string, sendAt?: Date): Promise<MailResult> {
	const result = await call<MailResult>(scene.api, "mail.create_mail", {
		account: mayaAccount.get(scene),
		from_email: MAYA.email,
		from_name: MAYA.name,
		to: [LEO_RECIPIENT],
		cc: [],
		bcc: [],
		subject,
		html_body: "<p>Hi Leo,</p><p>The vendor shortlist is ready for your review. Two of the four quotes came in under budget.</p><p>Maya</p>",
		send_at: sendAt?.toISOString().replace(/\.\d+Z$/, "Z"),
	});
	written.get(scene).add(result.id);
	return result;
}

interface SubmissionRow {
	id: string;
	subject: string | null;
	undo_status: string | null;
}

interface SearchRow {
	id: string;
	subject?: string | null;
	messages?: { id: string; subject?: string | null }[];
}

async function submissionsWith(api: APIRequestContext, account: string, token: string): Promise<SubmissionRow[]> {
	const rows: SubmissionRow[] = [];
	for (const undo_status of ["pending", "final", "canceled"]) {
		const page = await call<{ rows: SubmissionRow[] }>(api, "scheduled.get_submissions", {
			account,
			undo_status,
			start: 0,
			page_length: 100,
		});
		rows.push(...page.rows.filter((row) => row.subject?.includes(token)));
	}
	return rows;
}

/** Ids of the messages in `account` whose subject carries the token. */
async function messagesWith(api: APIRequestContext, account: string, token: string): Promise<string[]> {
	const page = await call<{ rows: SearchRow[] }>(api, "mail.search_mails", {
		account,
		filter: { text: token },
		limit: 50,
		start: 0,
		all_accounts: false,
	});
	const ids = new Set<string>();
	for (const row of page.rows) {
		// A thread can hold older mail of the same conversation; only this path's own goes.
		const own = (row.messages ?? []).filter((message) => message.subject?.includes(token)).map((message) => message.id);
		if (own.length) own.forEach((id) => ids.add(id));
		else if (row.subject?.includes(token)) ids.add(row.id);
	}
	return [...ids];
}

async function deleteMessages(api: APIRequestContext, account: string, ids: Iterable<string>): Promise<void> {
	// One already gone (a discard that committed, a draft replaced by a later save) is fine.
	for (const id of ids) await call(api, "mail.delete_mail", { account, id }).catch(unlessRefused);
}

/**
 * Removes everything this path wrote: held and scheduled deliveries are
 * cancelled, Outbox records dropped, and every copy deleted from Maya's
 * mailboxes and from Leo's Inbox once a delivery has reached it.
 */
export async function forgetMail(scene: BaseScene): Promise<void> {
	const token = tokenOf(scene);
	// Off the composer first, so no autosave writes a draft after this.
	await scene.page.goto("about:blank").catch(() => undefined);
	const api = scene.api;
	const account = mayaAccount.get(scene);
	let delivered = false;
	for (const submission of await submissionsWith(api, account, token)) {
		if (submission.undo_status === "pending") {
			await call(api, "scheduled.cancel_scheduled_mail", { account, id: submission.id }).catch(unlessRefused);
		} else if (submission.undo_status === "final") delivered = true;
	}
	// Cancelled ones settle as `canceled`; every record of this path is dropped.
	for (const submission of await submissionsWith(api, account, token)) {
		if (submission.undo_status === "final") delivered = true;
		await call(api, "scheduled.dismiss_failed_mail", { account, id: submission.id }).catch(unlessRefused);
	}
	await deleteMessages(api, account, written.get(scene));
	await deleteMessages(api, account, await messagesWith(api, account, token));
	if (!delivered) return;
	const leo = await scene.as(demoUser("leo"));
	const leoAccount = await personalAccount(leo);
	// Delivery to the local Stalwart takes a moment; wait for the copy rather than miss it.
	for (let attempt = 0; attempt < 20; attempt++) {
		const ids = await messagesWith(leo, leoAccount, token);
		if (ids.length) {
			await deleteMessages(leo, leoAccount, ids);
			return;
		}
		await scene.page.waitForTimeout(1000);
	}
}

type Delivery = "queued" | "retrying" | "failed" | "delivered" | "displayed";

/**
 * Answers the submission details read with the real submission, moved to a
 * delivery state the local mail server never reaches on its own: every mail
 * to a Northwind address is accepted at once, so nothing queues, defers,
 * bounces or reports back.
 */
export async function shapeSubmission(page: Page, delivery: Delivery): Promise<void> {
	const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
	await page.route(/suite\.mail\.api\.scheduled\.get_scheduled_mail/, async (route) => {
		const response = await route.fetch().catch(() => null);
		if (!response) return;
		// SAFETY: the method answers the submission under `message`, as the generated client types it.
		const body = (await response.json()) as { message?: Json & { recipients_status: Json[] } };
		const submission = body.message;
		if (submission) {
			const recipient: RecipientStatus = {
				email: LEO.email,
				status: delivery,
				reason: null,
				smtp_reply: "250 2.0.0 Message queued for delivery",
				delivered: null,
				displayed: null,
				retries: 0,
				next_retry: null,
			};
			submission.status = delivery;
			submission.delivery_errors = [];
			if (delivery === "queued") {
				submission.undo_status = "pending";
				recipient.smtp_reply = null;
			} else if (delivery === "retrying") {
				submission.undo_status = "pending";
				submission.next_retry = at(14);
				Object.assign(recipient, { retries: 3, next_retry: at(14), reason: "451 4.7.1 Greylisted, please try again later", smtp_reply: null });
			} else if (delivery === "failed") {
				const reason = `550 5.1.1 <${LEO.email}>: Recipient address rejected: mailbox is full`;
				submission.delivery_errors = [{ email: LEO.email, reason }];
				Object.assign(recipient, { retries: 5, reason, smtp_reply: reason });
			} else if (delivery === "delivered") {
				Object.assign(recipient, { delivered: at(-2), smtp_reply: "250 2.0.0 Delivered to mailbox" });
				submission.dsn_count = 1;
			} else {
				Object.assign(recipient, { delivered: at(-20), displayed: at(-3), smtp_reply: "250 2.0.0 Delivered to mailbox" });
				submission.dsn_count = 1;
				submission.mdn_count = 1;
			}
			submission.recipients_status = [recipient];
		}
		await route.fulfill({ response, json: body }).catch(() => undefined);
	});
}

/**
 * Keeps the Outbox list to this path's own submissions. The Outbox lists
 * Maya's whole account, and other flows send as Maya too.
 */
export async function onlyOwnSubmissions(scene: BaseScene): Promise<void> {
	const token = tokenOf(scene);
	await scene.page.route(/suite\.mail\.api\.scheduled\.get_submissions/, async (route) => {
		const response = await route.fetch().catch(() => null);
		if (!response) return;
		// SAFETY: the method answers a page of submissions under `message`, or an error without it.
		const body = (await response.json()) as { message?: { rows: SubmissionRow[]; total?: number } };
		if (body.message) {
			body.message.rows = body.message.rows.filter((row) => row.subject?.includes(token));
			body.message.total = body.message.rows.length;
		}
		await route.fulfill({ response, json: body }).catch(() => undefined);
	});
}

/** Cancels a scheduled submission the way the Outbox does, which moves its mail back to Drafts. */
export async function cancelAsMaya(scene: BaseScene, submission: string): Promise<void> {
	await call(scene.api, "scheduled.cancel_scheduled_mail", { account: mayaAccount.get(scene), id: submission });
}
