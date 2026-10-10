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

async function callTestHook<T>(testApi: APIRequestContext, name: string, node: string): Promise<T> {
	const response = await testApi.post(`/api/method/suite.writer.content.e2e_api.${name}`, {
		form: { node },
	});
	return frappeData<T>(response);
}

/** Turn collaboration on for the site and give `node` a collab log. Call before the document opens. */
export const enableCollab = (testApi: APIRequestContext, node: string) =>
	callTestHook<CollabState>(testApi, "enable_collab", node);

export const compactNow = (testApi: APIRequestContext, node: string) =>
	callTestHook<CollabState>(testApi, "compact_now", node);

export const collabState = (testApi: APIRequestContext, node: string) =>
	callTestHook<CollabState>(testApi, "state", node);

/** How big a document's compacted state is counted. */
export const stateBytes = (testApi: APIRequestContext, node: string) =>
	callTestHook<number>(testApi, "state_bytes", node);

export const logId = (testApi: APIRequestContext, node: string) =>
	callTestHook<string>(testApi, "log_id", node);

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
export const releaseDocument = (testApi: APIRequestContext, node: string) =>
	callTestHook<CollabState>(testApi, "release", node);

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
export const leaveNoRoom = (testApi: APIRequestContext, node: string) =>
	callTestHook<CollabState>(testApi, "leave_no_room", node);

/** Count a document as big as one may be, so the server takes no more adding changes. */
export const fillDocument = (testApi: APIRequestContext, node: string) =>
	callTestHook<CollabState>(testApi, "fill_up", node);

/** Mark a document as written from here on by a Writer one schema newer than this site's. */
export const writeNewerSchema = (testApi: APIRequestContext, node: string) =>
	callTestHook<CollabState>(testApi, "write_newer_schema", node);

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

/** The text of each top-level block, as the server would serve it. */
export const serverBlocks = (testApi: APIRequestContext, node: string) =>
	callTestHook<string[]>(testApi, "server_text", node);

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
	testApi: APIRequestContext,
	node: string,
	pages: Page[],
	texts: string[],
	timeout?: number,
): Promise<string[]> {
	let lastStoredBlocks: string[] = [];
	const compareWithServer = async () => {
		const storedBlocks = await serverBlocks(testApi, node);
		const shownBlocks = await Promise.all(pages.map(editorBlocks));
		lastStoredBlocks = storedBlocks;
		const matchesServer = shownBlocks.every(
			(pageBlocks) => JSON.stringify(pageBlocks) === JSON.stringify(storedBlocks),
		);
		const missing = texts.filter((text) => !storedBlocks.join("\n").includes(text));
		return { matchesServer, missing };
	};

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
	const response = await request.post(
		`/api/suite/drive/nodes/${encodeURIComponent(node)}/versions`,
		{
			data: version,
		},
	);
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
	const pngBase64 =
		"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEhrVMKphVMOohlENQ1UDAOWw/wF6FG3VAAAAAElFTkSuQmCC";
	const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
	const picture = new File([bytes], "dot.png", { type: "image/png" });
	const clipboard = new DataTransfer();
	clipboard.items.add(picture);

	const pasteInit: ClipboardEventInit = {
		clipboardData: clipboard,
		bubbles: true,
		cancelable: true,
	};
	const paste = new ClipboardEvent("paste", pasteInit);
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
	const clipboard = new DataTransfer();
	clipboard.setData("text/plain", text);

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
	const contentUrl = `/api/suite/content/${encodeURIComponent(node)}`;
	const headers = {
		"X-Collab-Principal": user,
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

	const paragraph = {
		node,
		client_id: String(clientId),
		length: String(length),
	};
	const changeResponse = await testApi.post(
		"/api/method/suite.writer.content.e2e_api.paragraph_change",
		{
			form: paragraph,
		},
	);
	const paragraphChange = await frappeData<ParagraphChange>(changeResponse);

	const changeBytes = Buffer.from(paragraphChange.change, "hex");
	const changeSha = createHash("sha256").update(changeBytes).digest("hex");
	const stageId = randomUUID().replaceAll("-", "");
	const pieceSize = 256 * 1024;
	const pieces = sendWhole ? 0 : Math.ceil(changeBytes.length / pieceSize);
	for (let pieceIndex = pieces - 1; pieceIndex >= 0; pieceIndex--) {
		const pieceHeader = {
			lineage: paragraphChange.lineage,
			principal: user,
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

	const pushHeader = {
		lineage: paragraphChange.lineage,
		principal: user,
		sid: sessionId,
		from: 1,
		to: 1,
		cid: clientId,
		seen_rev: paragraphChange.head_rev,
		schema: 1,
		shas: [changeSha],
		...(sendWhole ? {} : { stage_id: stageId }),
	};
	const pushBody = sendWhole ? changeBytes : Buffer.alloc(0);
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
	const traffic = {
		largest: 0,
		refused: 0,
	};

	const refuse = (outgoing: ServerResponse) => {
		traffic.refused++;
		if (bareRefusal) {
			outgoing.writeHead(413).end();
		} else {
			outgoing
				.writeHead(413, { "content-type": "text/html" })
				.end("<h1>413 Request Entity Too Large</h1>");
		}
	};

	const relay = (incoming: IncomingMessage, outgoing: ServerResponse) => {
		const chunks: Buffer[] = [];
		const forwardBody = () => {
			const body = Buffer.concat(chunks);
			traffic.largest = Math.max(traffic.largest, body.length);
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
			const passBack = (upstreamResponse: IncomingMessage) => {
				outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
				upstreamResponse.pipe(outgoing);
			};
			const forwarded = forward(upstreamRequest, passBack);
			forwarded.on("error", () => outgoing.writeHead(502).end());
			forwarded.end(body);
		};

		incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
		incoming.on("end", forwardBody);
	};

	const server = createServer(relay);
	await new Promise<void>((listening) => server.listen(0, listening));
	const { port } = server.address() as AddressInfo;

	const liftLimit = () => {
		limit = Infinity;
	};
	const shutDown = (closed: () => void) => {
		server.close(() => closed());
		server.closeAllConnections();
	};
	const close = () => new Promise<void>(shutDown);
	const origin = `${upstream.protocol}//${upstream.hostname}:${port}`;
	return { origin, traffic, liftLimit, close };
}
