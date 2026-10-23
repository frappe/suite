import { request, type APIRequestContext } from "@playwright/test";

import { loginViaApi } from "../../shared/auth";

export const DRIVE = "/api/suite/drive";

export interface DriveNode {
	name: string;
	title: string;
	kind: string;
	parent_node: string | null;
	content_doctype: string | null;
	content_docname: string | null;
}

export interface DriveRoots {
	personal: { node: string; title: string };
	organization?: { node: string; title: string } | null;
}

/** An admin API context that shares the browser login. */
export async function adminApi(baseURL: string): Promise<APIRequestContext> {
	const api = await request.newContext({ baseURL });
	await loginViaApi(api);
	return api;
}

/** Retry a write once per 400 ms: parallel workers can deadlock the same root. */
async function send(
	api: APIRequestContext,
	method: "get" | "post" | "patch" | "put" | "delete",
	path: string,
	body?: unknown,
) {
	let last = await api[method](path, body === undefined ? undefined : { data: body });
	for (let attempt = 0; attempt < 4 && last.status() >= 500; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 400));
		last = await api[method](path, body === undefined ? undefined : { data: body });
	}
	return last;
}

async function data<T>(
	api: APIRequestContext,
	method: "get" | "post" | "patch" | "put" | "delete",
	path: string,
	body?: unknown,
): Promise<T> {
	const response = await send(api, method, path, body);
	const text = await response.text();
	if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path} failed with ${response.status()}: ${text}`);
	const parsed = JSON.parse(text) as { data?: T; message?: T };
	return (parsed.data ?? parsed.message) as T;
}

export function roots(api: APIRequestContext): Promise<DriveRoots> {
	return data<DriveRoots>(api, "get", `${DRIVE}/roots`);
}

export function createFolder(api: APIRequestContext, parent: string, title: string): Promise<DriveNode> {
	return data<DriveNode>(api, "post", `${DRIVE}/nodes`, { parent_node: parent, title, kind: "folder" });
}

export function createDocument(
	api: APIRequestContext,
	parent: string,
	title: string,
	contentDoctype: string,
): Promise<DriveNode> {
	return data<DriveNode>(api, "post", `${DRIVE}/nodes`, {
		parent_node: parent,
		title,
		kind: "document",
		content_doctype: contentDoctype,
	});
}

export function createLink(api: APIRequestContext, parent: string, title: string, url: string): Promise<DriveNode> {
	return data<DriveNode>(api, "post", `${DRIVE}/nodes`, { parent_node: parent, title, kind: "link", url });
}

/** Upload one small file through the three upload routes. */
export async function uploadFile(
	api: APIRequestContext,
	parent: string,
	title: string,
	bytes: Buffer,
	mime = "application/octet-stream",
): Promise<DriveNode> {
	const session = await data<{ upload_id: string }>(api, "post", `${DRIVE}/uploads`, {
		parent_node: parent,
		filename: title,
		size: bytes.length,
		mime,
	});
	const chunk = await api.put(`${DRIVE}/uploads/${session.upload_id}/chunk?offset=0`, {
		data: bytes,
		headers: { "Content-Type": "application/octet-stream" },
	});
	if (!chunk.ok()) throw new Error(`upload chunk failed with ${chunk.status()}`);
	return data<DriveNode>(api, "post", `${DRIVE}/uploads/${session.upload_id}/finish`, { parent_node: parent, title });
}

export function getNode(api: APIRequestContext, node: string, expand?: string): Promise<DriveNode & Record<string, unknown>> {
	const query = expand ? `?expand=${encodeURIComponent(expand)}` : "";
	return data(api, "get", `${DRIVE}/nodes/${node}${query}`);
}

export function children(
	api: APIRequestContext,
	node: string,
	query = "",
): Promise<{ rows: DriveNode[]; next_cursor: string | null }> {
	return data(api, "get", `${DRIVE}/nodes/${node}/children${query}`);
}

export async function star(api: APIRequestContext, node: string): Promise<void> {
	await data(api, "put", `${DRIVE}/nodes/${node}/favourite`, {});
}

export async function visit(api: APIRequestContext, node: string): Promise<void> {
	await data(api, "post", `${DRIVE}/nodes/${node}/visit`, {});
}

export async function patchNode(api: APIRequestContext, node: string, patch: Record<string, unknown>): Promise<void> {
	await data(api, "patch", `${DRIVE}/nodes/${node}`, patch);
}

/** Gives `principal` `role` on `node` (10 is Read). */
export async function grantRole(api: APIRequestContext, node: string, principal: string, role: number): Promise<void> {
	await data(api, "put", `${DRIVE}/nodes/${node}/grants/${encodeURIComponent(principal)}`, { role });
}

export function listView(
	api: APIRequestContext,
	view: string,
	query = "",
): Promise<{ rows: DriveNode[]; next_cursor: string | null }> {
	return data(api, "get", `${DRIVE}/views/${view}${query}`);
}

/**
 * Permanent removal. The server deletes only a trash root, so the node is
 * trashed first; a node already gone or already trashed is fine.
 */
export async function purge(api: APIRequestContext, node: string): Promise<void> {
	const trash = await send(api, "patch", `${DRIVE}/nodes/${node}`, { state: "Trashed" });
	if (trash.status() === 404) return;
	if (!trash.ok() && trash.status() !== 409) {
		throw new Error(`trashing ${node} failed with ${trash.status()}: ${await trash.text()}`);
	}
	const response = await send(api, "delete", `${DRIVE}/nodes/${node}`);
	if (!response.ok() && response.status() !== 404) {
		throw new Error(`purge ${node} failed with ${response.status()}: ${await response.text()}`);
	}
}

/** A unique title fragment so parallel workers never collide. */
export function runTag(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
