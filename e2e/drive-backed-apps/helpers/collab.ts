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
import { shareWriterDocument, writerEditor } from "./writer";

/** Where a document's collab log stands, from `suite.writer.content.e2e_api.state`. */
export interface CollabState {
	body_rev: number;
	head_rev: number;
	tail_rows: number;
}

/** What Drive answers to a new version. */
interface VersionReply {
	data: { seq: string };
}

/** A paragraph's change as `e2e_api.paragraph_change` makes it. */
interface ParagraphChange {
	change: string;
	lineage: string;
	head_rev: number;
}

/** A run of text and the formatting keys it carries, as `e2e_api.block_runs` reads it. */
type TextRun = [string, Record<string, unknown>];

/** What `pushInPieces` saw: how many pieces it staged, the push's status, and its refusal if any. */
interface PushOutcome {
	pieces: number;
	status: number;
	collab?: string;
}

async function callTestHook<T>(testApi: APIRequestContext, name: string, node: string): Promise<T> {
	const response = await testApi.post(`/api/method/suite.writer.content.e2e_api.${name}`, {
		form: { node },
	});
	return frappeData<T>(response);
}

/** Turn collaboration on for the site and give `node` a collab log. Call before the document opens. */
function enableCollab(testApi: APIRequestContext, node: string) {
	return callTestHook<CollabState>(testApi, "enable_collab", node);
}

/** Give `node` a collab log and share it with `collaborator` for editing. */
export async function openForCollab(
	testApi: APIRequestContext,
	owner: APIRequestContext,
	node: string,
	collaborator: string,
): Promise<void> {
	await enableCollab(testApi, node);
	await shareWriterDocument(owner, node, { user: collaborator, read: true, write: true });
}

export function compactNow(testApi: APIRequestContext, node: string) {
	return callTestHook<CollabState>(testApi, "compact_now", node);
}

export function collabState(testApi: APIRequestContext, node: string) {
	return callTestHook<CollabState>(testApi, "state", node);
}

/** How big a document's compacted state is counted. */
export function stateBytes(testApi: APIRequestContext, node: string) {
	return callTestHook<number>(testApi, "state_bytes", node);
}

export function logId(testApi: APIRequestContext, node: string) {
	return callTestHook<string>(testApi, "log_id", node);
}

/** Age a document's edit rows past the evidence window and queue its trimming. */
export function trimNow(testApi: APIRequestContext, node: string) {
	return callTestHook<CollabState>(testApi, "trim_now", node);
}

/** Make a document's readable copy a minute old, so the next push asks for a render; its rev, 0 for none. */
export function ageCopy(testApi: APIRequestContext, node: string) {
	return callTestHook<number>(testApi, "age_copy", node);
}

/** The rev through which a document's edit rows may be gone. */
export function trimmedRev(testApi: APIRequestContext, node: string) {
	return callTestHook<number>(testApi, "trimmed_rev", node);
}

/** Hold a document for an admin; `why` is the judge's cause, and `bad_checkpoint` puts the whole document in question. */
export async function holdDocument(
	testApi: APIRequestContext,
	node: string,
	why: string,
): Promise<CollabState> {
	const response = await testApi.post("/api/method/suite.writer.content.e2e_api.hold", {
		form: { node, why },
	});
	return frappeData(response);
}

/** Clear a held document, as an admin does. */
export function releaseDocument(testApi: APIRequestContext, node: string) {
	return callTestHook<CollabState>(testApi, "release", node);
}

/** Quarantine a document's last row, as a judge that finds it bad does. */
export async function quarantineLast(
	testApi: APIRequestContext,
	node: string,
	why: string,
): Promise<CollabState> {
	const response = await testApi.post("/api/method/suite.writer.content.e2e_api.quarantine_last", {
		form: { node, why },
	});
	return frappeData(response);
}

/** Count a document's state as big as its tail leaves room for, so its next adding push waits for a compaction. */
export function leaveNoRoom(testApi: APIRequestContext, node: string) {
	return callTestHook<CollabState>(testApi, "leave_no_room", node);
}

/** Count a document as big as one may be, so the server takes no more adding changes. */
export function fillDocument(testApi: APIRequestContext, node: string) {
	return callTestHook<CollabState>(testApi, "fill_up", node);
}

/** Mark a document as written from here on by a Writer one schema newer than this site's. */
export function writeNewerSchema(testApi: APIRequestContext, node: string) {
	return callTestHook<CollabState>(testApi, "write_newer_schema", node);
}

/** Make `node` an old Writer document holding `html`, with no collab log and no conversion record. */
export async function makeOld(testApi: APIRequestContext, node: string, html: string): Promise<void> {
	const response = await testApi.post("/api/method/suite.writer.content.e2e_api.make_old", {
		form: { node, html },
	});
	expect(response.ok(), await response.text()).toBe(true);
}

/** Convert an old document now, as the queued conversion would; the outcome, or null if it didn't run. */
export function convertNow(testApi: APIRequestContext, node: string) {
	return callTestHook<string | null>(testApi, "convert_now", node);
}

/** How many rows each collab table holds for a log, keyed by table kind. */
export async function logRowCounts(
	testApi: APIRequestContext,
	log: string,
): Promise<Record<string, number>> {
	const response = await testApi.post("/api/method/suite.writer.content.e2e_api.log_rows", {
		form: { log },
	});
	return frappeData(response);
}

/** Start `node`'s log from a paragraph ending in text both code and bold. Call before the document opens. */
export function startCodeAndBold(testApi: APIRequestContext, node: string): Promise<CollabState> {
	return callTestHook<CollabState>(testApi, "start_code_and_bold", node);
}

/** Each top-level block's runs of text with their formatting, as the server holds them. */
export function blockRuns(testApi: APIRequestContext, node: string): Promise<TextRun[][]> {
	return callTestHook<TextRun[][]>(testApi, "block_runs", node);
}

/** The text of each top-level block, as the server would serve it. */
export function serverBlocks(testApi: APIRequestContext, node: string) {
	return callTestHook<string[]>(testApi, "server_text", node);
}

/** The text of each top-level block in the editor, without other people's carets. */
export function editorBlocks(page: Page): Promise<string[]> {
	return writerEditor(page).evaluate(blockTexts);
}

// Runs in the page, so it reads nothing from this module
function blockTexts(editor: Element): string[] {
	function textWithoutCarets(block: Element) {
		const copy = block.cloneNode(true) as Element;
		for (const caret of copy.querySelectorAll(".collaboration-carets__caret")) {
			caret.remove();
		}

		return copy.textContent ?? "";
	}

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
	testApi: APIRequestContext,
	node: string,
	pages: Page[],
	texts: string[],
	timeout?: number,
): Promise<string[]> {
	let lastStoredBlocks: string[] = [];
	async function compareWithServer() {
		const storedBlocks = await serverBlocks(testApi, node);
		const shownBlocks = await Promise.all(pages.map(editorBlocks));
		lastStoredBlocks = storedBlocks;
		const matchesServer = shownBlocks.every(
			(pageBlocks) => JSON.stringify(pageBlocks) === JSON.stringify(storedBlocks),
		);
		const missing = texts.filter((text) => !storedBlocks.join("\n").includes(text));
		return { matchesServer, missing };
	}

	await expect.poll(compareWithServer, { timeout }).toEqual({ matchesServer: true, missing: [] });
	return lastStoredBlocks;
}

/** Store the document's current bytes as a named version, through Drive's versions route; answers its seq. */
export async function saveNamedVersion(
	request: APIRequestContext,
	node: string,
	label: string,
): Promise<string> {
	const version = {
		kind: "named",
		label,
	};
	const encodedNode = encodeURIComponent(node);
	const response = await request.post(`/api/suite/drive/nodes/${encodedNode}/versions`, {
		data: version,
	});
	expect(response.ok(), await response.text()).toBe(true);

	const reply = (await response.json()) as VersionReply;
	return reply.data.seq;
}

/** Paste a 16 px PNG at the cursor, as a picture copied from another app would be. */
export async function pastePicture(page: Page): Promise<void> {
	const clipboard = await page.evaluateHandle(pictureClipboard);
	await writerEditor(page).evaluate(dispatchPaste, clipboard);
}

/** Paste plain text at the end of the document, as text copied from another app would be. */
export async function pasteText(page: Page, text: string): Promise<void> {
	await writerEditor(page).click();
	await page.keyboard.press("ControlOrMeta+End");
	const clipboard = await page.evaluateHandle(textClipboard, text);
	await writerEditor(page).evaluate(dispatchPaste, clipboard);
}

/** Paste HTML at the end of the document, as content copied from another document would be. */
export async function pasteHtml(page: Page, html: string): Promise<void> {
	await writerEditor(page).click();
	await page.keyboard.press("ControlOrMeta+End");
	const clipboard = await page.evaluateHandle(htmlClipboard, html);
	await writerEditor(page).evaluate(dispatchPaste, clipboard);
}

// These four run in the page, so they read nothing from this module
function pictureClipboard() {
	const pngBase64 =
		"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEhrVMKphVMOohlENQ1UDAOWw/wF6FG3VAAAAAElFTkSuQmCC";
	const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
	const picture = new File([bytes], "dot.png", { type: "image/png" });
	const clipboard = new DataTransfer();
	clipboard.items.add(picture);
	return clipboard;
}

function textClipboard(text: string) {
	const clipboard = new DataTransfer();
	clipboard.setData("text/plain", text);
	return clipboard;
}

function htmlClipboard(html: string) {
	const clipboard = new DataTransfer();
	clipboard.setData("text/html", html);
	return clipboard;
}

function dispatchPaste(editor: Element, clipboard: DataTransfer) {
	const pasteInit: ClipboardEventInit = {
		clipboardData: clipboard,
		bubbles: true,
		cancelable: true,
	};
	const paste = new ClipboardEvent("paste", pasteInit);
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

function buildFrame(header: object, bytes: Buffer): Buffer {
	const headerJson = Buffer.from(JSON.stringify(header));
	const headerLength = Buffer.alloc(4);
	headerLength.writeUInt32BE(headerJson.length);
	return Buffer.concat([headerLength, headerJson, bytes]);
}

/** Add a paragraph of `length` letters to `node` as `user`, staged over the piece route in reverse order and then pushed; `sendWhole` sends it in the push itself. */
export async function pushInPieces(
	userRequest: APIRequestContext,
	testApi: APIRequestContext,
	node: string,
	user: string,
	length: number,
	sendWhole = false,
): Promise<PushOutcome> {
	const encodedNode = encodeURIComponent(node);
	const contentUrl = `/api/suite/content/${encodedNode}`;
	const headers = {
		"X-Expected-User": user,
		"Content-Type": "application/octet-stream",
	};
	const sessionId = randomUUID().replaceAll("-", "");

	const sessionJson = JSON.stringify({ sid: sessionId });
	const sessionResponse = await userRequest.post(`${contentUrl}/sessions`, {
		headers,
		data: Buffer.from(sessionJson),
	});
	expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true);
	const sessionReply = (await sessionResponse.json()) as { client_id: number };
	const clientId = sessionReply.client_id;

	const paragraphForm = {
		node,
		client_id: String(clientId),
		length: String(length),
	};
	const changeResponse = await testApi.post(
		"/api/method/suite.writer.content.e2e_api.paragraph_change",
		{
			form: paragraphForm,
		},
	);
	const paragraphChange = await frappeData<ParagraphChange>(changeResponse);

	const changeBytes = Buffer.from(paragraphChange.change, "hex");
	const changeSha = createHash("sha256").update(changeBytes).digest("hex");
	const stageId = randomUUID().replaceAll("-", "");
	const pieceSize = 256 * 1024;
	let pieces = 0;
	if (!sendWhole) {
		pieces = Math.ceil(changeBytes.length / pieceSize);
	}

	for (let pieceIndex = pieces - 1; pieceIndex >= 0; pieceIndex--) {
		const pieceHeader = {
			lineage: paragraphChange.lineage,
			expected_user: user,
			sid: sessionId,
			from: 1,
			to: 1,
			total_len: changeBytes.length,
			sha_total: changeSha,
		};
		const piece = changeBytes.subarray(pieceIndex * pieceSize, (pieceIndex + 1) * pieceSize);
		const stageResponse = await userRequest.put(`${contentUrl}/stage/${stageId}/${pieceIndex}`, {
			headers,
			data: buildFrame(pieceHeader, piece),
		});
		expect(stageResponse.status(), await stageResponse.text()).toBe(200);
	}

	const pushHeader: Record<string, unknown> = {
		lineage: paragraphChange.lineage,
		expected_user: user,
		sid: sessionId,
		from: 1,
		to: 1,
		cid: clientId,
		seen_rev: paragraphChange.head_rev,
		schema: 1,
		shas: [changeSha],
	};
	let pushBody = Buffer.alloc(0);
	if (sendWhole) {
		pushBody = changeBytes;
	} else {
		pushHeader.stage_id = stageId;
	}

	const pushResponse = await userRequest.post(`${contentUrl}/updates`, {
		headers,
		data: buildFrame(pushHeader, pushBody),
	});
	const status = pushResponse.status();
	if (pushResponse.ok()) {
		return { pieces, status };
	}

	const refusal = (await pushResponse.json()) as { collab: string };
	return {
		pieces,
		status,
		collab: refusal.collab,
	};
}

/** A proxy in front of `target` that refuses request bodies over `limit` bytes with 413, as nginx's `client_max_body_size 1m` does.
 * With `bareRefusal` the 413 has no body, as some load balancers send. */
export async function bodyLimitProxy(target: string, limit = 2 ** 20, bareRefusal = false) {
	const upstream = new URL(target);
	const bodyStats = {
		largest: 0,
		refused: 0,
	};

	function refuse(outgoing: ServerResponse) {
		bodyStats.refused++;
		if (bareRefusal) {
			outgoing.writeHead(413).end();
		} else {
			outgoing
				.writeHead(413, { "content-type": "text/html" })
				.end("<h1>413 Request Entity Too Large</h1>");
		}
	}

	function relay(incoming: IncomingMessage, outgoing: ServerResponse) {
		const chunks: Buffer[] = [];
		function forwardBody() {
			const body = Buffer.concat(chunks);
			bodyStats.largest = Math.max(bodyStats.largest, body.length);
			if (body.length > limit) {
				refuse(outgoing);
				return;
			}

			const upstreamOptions: RequestOptions = {
				host: upstream.hostname,
				port: upstream.port,
				method: incoming.method,
				path: incoming.url,
				headers: incoming.headers,
			};
			function passBack(upstreamResponse: IncomingMessage) {
				outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
				upstreamResponse.pipe(outgoing);
			}

			const upstreamRequest = forward(upstreamOptions, passBack);
			upstreamRequest.on("error", () => outgoing.writeHead(502).end());
			upstreamRequest.end(body);
		}

		incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
		incoming.on("end", forwardBody);
	}

	const server = createServer(relay);
	await new Promise<void>((listening) => server.listen(0, listening));
	const { port } = server.address() as AddressInfo;

	function liftLimit() {
		limit = Infinity;
	}

	function shutDown(closed: () => void) {
		server.close(() => closed());
		server.closeAllConnections();
	}

	function close() {
		return new Promise<void>(shutDown);
	}

	const origin = `${upstream.protocol}//${upstream.hostname}:${port}`;
	return { origin, bodyStats, liftLimit, close };
}
