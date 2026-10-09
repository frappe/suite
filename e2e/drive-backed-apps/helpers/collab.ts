import { createHash, randomUUID } from "node:crypto";
import {
	createServer,
	request as forward,
	type IncomingMessage,
	type RequestOptions,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { frappeData } from "../../shared/frappe";
import { writerEditor } from "./writer";

/** Where a document's collab log stands, from `suite.writer.content.e2e_api.state`. */
export interface CollabState {
	body_rev: number;
	head_rev: number;
	tail_rows: number;
}

/** What Drive answers to a new version. */
type VersionReply = { data: { seq: string } };

/** A paragraph's change as `e2e_api.paragraph_change` makes it. */
type ParagraphChange = { change: string; lineage: string; head_rev: number };

/** What `pushInPieces` saw: how many pieces it staged, the push's status, and its refusal if any. */
type PushOutcome = { pieces: number; status: number; collab?: string };

async function hook<T>(api: APIRequestContext, name: string, node: string): Promise<T> {
	const response = await api.post(`/api/method/suite.writer.content.e2e_api.${name}`, { form: { node } });
	return frappeData<T>(response);
}

/** Turn collaboration on for the site and give `node` a collab log. Call before the document opens. */
export const enableCollab = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "enable_collab", node);

export const compactNow = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "compact_now", node);

export const collabState = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "state", node);

/** How big a document's compacted state is counted. */
export const stateBytes = (api: APIRequestContext, node: string) => hook<number>(api, "state_bytes", node);

export const logId = (api: APIRequestContext, node: string) => hook<string>(api, "log_id", node);

/** Hold a document for an admin; `why` is the judge's cause, and `bad_checkpoint` puts the whole document in question. */
export async function holdDocument(api: APIRequestContext, node: string, why: string): Promise<CollabState> {
	const response = await api.post("/api/method/suite.writer.content.e2e_api.hold", { form: { node, why } });
	return frappeData(response);
}

/** Clear a held document, as an admin does. */
export const releaseDocument = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "release", node);

/** Quarantine a document's last row, as a judge that finds it bad does. */
export async function quarantineLast(api: APIRequestContext, node: string, why: string): Promise<CollabState> {
	const response = await api.post("/api/method/suite.writer.content.e2e_api.quarantine_last", {
		form: { node, why },
	});
	return frappeData(response);
}

/** Count a document's state as big as its tail leaves room for, so its next adding push waits for a compaction. */
export const leaveNoRoom = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "leave_no_room", node);

/** Count a document as big as one may be, so the server takes no more adding changes. */
export const fillUp = (api: APIRequestContext, node: string) => hook<CollabState>(api, "fill_up", node);

/** Mark a document as written from here on by a Writer one schema newer than this site's. */
export const writeNewerSchema = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "write_newer_schema", node);

/** How many rows each collab table holds for a log, keyed by table kind. */
export async function logRows(api: APIRequestContext, log: string): Promise<Record<string, number>> {
	const response = await api.post("/api/method/suite.writer.content.e2e_api.log_rows", { form: { log } });
	return frappeData(response);
}

/** The text of each top-level block, as the server would serve it. */
export const serverText = (api: APIRequestContext, node: string) =>
	hook<string[]>(api, "server_text", node);

/** The text of each top-level block in the editor, without other people's carets. */
export function editorBlocks(page: Page): Promise<string[]> {
	return writerEditor(page).evaluate(blockTexts);
}

// Runs in the page, so it reads nothing from this module
function blockTexts(editor: Element): string[] {
	const textWithoutCarets = (block: Element) => {
		const copy = block.cloneNode(true) as Element;
		copy.querySelectorAll(".collaboration-carets__caret").forEach((caret) => caret.remove());
		return copy.textContent ?? "";
	};

	return [...editor.children].map(textWithoutCarets);
}

export async function expectSaved(page: Page): Promise<void> {
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/** Type at the end of the document, in a paragraph of its own. */
export async function typeParagraph(page: Page, text: string): Promise<void> {
	await writerEditor(page).click();
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.press("Enter");
	await page.keyboard.type(text);
}

/** Wait until every page shows the same blocks as the server, and those blocks hold every text. */
export async function expectConverged(
	api: APIRequestContext,
	node: string,
	pages: Page[],
	texts: string[],
	timeout?: number,
): Promise<string[]> {
	let blocks: string[] = [];
	const compareWithServer = async () => {
		const server = await serverText(api, node);
		const shown = await Promise.all(pages.map(editorBlocks));
		blocks = server;
		const matchesServer = shown.every((page) => JSON.stringify(page) === JSON.stringify(server));
		const missing = texts.filter((text) => !server.join("\n").includes(text));
		return { matchesServer, missing };
	};

	await expect.poll(compareWithServer, { timeout }).toEqual({ matchesServer: true, missing: [] });
	return blocks;
}

/** Store the document's current bytes as a named version, through Drive's versions route; answers its seq. */
export async function takeVersion(
	request: APIRequestContext,
	node: string,
	label: string,
): Promise<string> {
	const version = {
		kind: "named",
		label,
	};
	const response = await request.post(`/api/suite/drive/nodes/${encodeURIComponent(node)}/versions`, {
		data: version,
	});
	expect(response.ok(), await response.text()).toBe(true);

	const reply = (await response.json()) as VersionReply;
	return reply.data.seq;
}

/** Paste a 16 px PNG at the cursor, as a picture copied from another app would be. */
export async function pastePicture(page: Page): Promise<void> {
	await writerEditor(page).evaluate(pasteDot);
}

// Runs in the page, so it reads nothing from this module
function pasteDot(editor: Element) {
	const png =
		"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEhrVMKphVMOohlENQ1UDAOWw/wF6FG3VAAAAAElFTkSuQmCC";
	const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
	const picture = new File([bytes], "dot.png", { type: "image/png" });
	const data = new DataTransfer();
	data.items.add(picture);

	const pasted: ClipboardEventInit = {
		clipboardData: data,
		bubbles: true,
		cancelable: true,
	};
	const paste = new ClipboardEvent("paste", pasted);
	editor.dispatchEvent(paste);
}

/** Paste plain text at the end of the document, as text copied from another app would be. */
export async function pasteText(page: Page, text: string): Promise<void> {
	await writerEditor(page).click();
	await page.keyboard.press("ControlOrMeta+End");
	await writerEditor(page).evaluate(pastePlainText, text);
}

// Runs in the page, so it reads nothing from this module
function pastePlainText(editor: Element, text: string) {
	const data = new DataTransfer();
	data.setData("text/plain", text);

	const pasted: ClipboardEventInit = {
		clipboardData: data,
		bubbles: true,
		cancelable: true,
	};
	const paste = new ClipboardEvent("paste", pasted);
	editor.dispatchEvent(paste);
}

/** Whether each picture the editor shows has loaded. */
export function picturesLoaded(page: Page): Promise<boolean[]> {
	return writerEditor(page)
		.locator("img[src]")
		.evaluateAll((images) =>
			(images as HTMLImageElement[]).map((image) => image.complete && image.naturalWidth > 0),
		);
}

function framed(header: object, bytes: Buffer): Buffer {
	const json = Buffer.from(JSON.stringify(header));
	const length = Buffer.alloc(4);
	length.writeUInt32BE(json.length);
	return Buffer.concat([length, json, bytes]);
}

/** Add a paragraph of `length` letters to `node` as `user`, staged over the piece route in reverse order and then pushed; `whole` sends it in the push itself. */
export async function pushInPieces(
	request: APIRequestContext,
	api: APIRequestContext,
	node: string,
	user: string,
	length: number,
	whole = false,
): Promise<PushOutcome> {
	const base = `/api/suite/content/${encodeURIComponent(node)}`;
	const headers = {
		"X-Collab-Principal": user,
		"Content-Type": "application/octet-stream",
	};
	const sid = randomUUID().replaceAll("-", "");

	const sessionJson = JSON.stringify({ sid });
	const session = await request.post(`${base}/sessions`, {
		headers,
		data: Buffer.from(sessionJson),
	});
	expect(session.ok(), await session.text()).toBe(true);
	const sessionReply = (await session.json()) as { client_id: number };
	const cid = sessionReply.client_id;

	const paragraph = {
		node,
		client_id: String(cid),
		length: String(length),
	};
	const madeResponse = await api.post("/api/method/suite.writer.content.e2e_api.paragraph_change", {
		form: paragraph,
	});
	const made = await frappeData<ParagraphChange>(madeResponse);

	const change = Buffer.from(made.change, "hex");
	const sha = createHash("sha256").update(change).digest("hex");
	const stage = randomUUID().replaceAll("-", "");
	const size = 256 * 1024;
	const pieces = whole ? 0 : Math.ceil(change.length / size);
	for (let idx = pieces - 1; idx >= 0; idx--) {
		const pieceHeader = {
			lineage: made.lineage,
			principal: user,
			sid,
			from: 1,
			to: 1,
			total_len: change.length,
			sha_total: sha,
		};
		const piece = change.subarray(idx * size, (idx + 1) * size);
		const put = await request.put(`${base}/stage/${stage}/${idx}`, {
			headers,
			data: framed(pieceHeader, piece),
		});
		expect(put.status(), await put.text()).toBe(200);
	}

	const pushHeader = {
		lineage: made.lineage,
		principal: user,
		sid,
		from: 1,
		to: 1,
		cid,
		seen_rev: made.head_rev,
		schema: 1,
		shas: [sha],
		...(whole ? {} : { stage_id: stage }),
	};
	const pushBody = whole ? change : Buffer.alloc(0);
	const push = await request.post(`${base}/updates`, {
		headers,
		data: framed(pushHeader, pushBody),
	});
	const status = push.status();
	if (push.ok()) {
		return { pieces, status };
	}

	const refusal = (await push.json()) as { collab: string };
	return {
		pieces,
		status,
		collab: refusal.collab,
	};
}

/** A proxy in front of `target` that refuses request bodies over `limit` bytes with 413, as nginx's `client_max_body_size 1m` does.
 * A `bare` refusal has no body, as some load balancers send. */
export async function bodyLimitProxy(target: string, limit = 2 ** 20, bare = false) {
	const upstream = new URL(target);
	const seen = {
		largest: 0,
		refused: 0,
	};

	const refuse = (outgoing: ServerResponse) => {
		seen.refused++;
		if (bare) {
			outgoing.writeHead(413).end();
		} else {
			outgoing.writeHead(413, { "content-type": "text/html" }).end("<h1>413 Request Entity Too Large</h1>");
		}
	};

	const relay = (incoming: IncomingMessage, outgoing: ServerResponse) => {
		const chunks: Buffer[] = [];
		const forwardBody = () => {
			const body = Buffer.concat(chunks);
			seen.largest = Math.max(seen.largest, body.length);
			if (body.length > limit) {
				refuse(outgoing);
				return;
			}

			const upstreamRequest: RequestOptions = {
				host: upstream.hostname,
				port: upstream.port,
				method: incoming.method,
				path: incoming.url,
				headers: incoming.headers,
			};
			const passBack = (answer: IncomingMessage) => {
				outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
				answer.pipe(outgoing);
			};
			const sent = forward(upstreamRequest, passBack);
			sent.on("error", () => outgoing.writeHead(502).end());
			sent.end(body);
		};

		incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
		incoming.on("end", forwardBody);
	};

	const server = createServer(relay);
	await new Promise<void>((listening) => server.listen(0, listening));
	const { port } = server.address() as AddressInfo;

	const lift = () => {
		limit = Infinity;
	};
	const shutDown = (closed: () => void) => {
		server.close(() => closed());
		server.closeAllConnections();
	};
	const close = () => new Promise<void>(shutDown);
	const origin = `${upstream.protocol}//${upstream.hostname}:${port}`;
	return { origin, seen, lift, close };
}
