import type { APIRequestContext, APIResponse } from "@playwright/test";

interface FrappeResponse<T> {
	message?: T;
	data?: T;
}

export async function frappeData<T>(response: Pick<APIResponse, "ok" | "status" | "text" | "json">): Promise<T> {
	if (!response.ok()) {
		throw new Error(`Frappe request failed with ${response.status()}: ${await response.text()}`);
	}
	// SAFETY: the successful Frappe method response wraps its result in message/data; callers supply T from the endpoint they requested.
	const body = (await response.json()) as FrappeResponse<T>;
	const data = body.message ?? body.data;
	if (data === undefined) throw new Error("Frappe response contained no data");
	return data;
}

/** Calls a whitelisted method as `api`'s user and answers its `message`, which a method returning nothing leaves out. */
export async function callMethod<T = unknown>(api: APIRequestContext, method: string, data: Record<string, unknown> = {}): Promise<T> {
	const response = await api.post(`/api/method/${method}`, { data });
	if (!response.ok()) throw new MethodRefused(method, response.status(), await response.text());
	// SAFETY: Frappe wraps a whitelisted method's return value in `message`; the caller names its type.
	return ((await response.json()) as { message: T }).message;
}

/** A whitelisted method answered with an error status. */
export class MethodRefused extends Error {
	constructor(
		readonly method: string,
		readonly status: number,
		body: string,
	) {
		super(`${method} answered ${status}: ${body}`);
	}
}

/**
 * For a cleanup whose record may be gone already, or never made: the server
 * refusing is fine. Anything else, the bench being away included, still throws.
 */
export function unlessRefused(error: unknown): void {
	if (!(error instanceof MethodRefused && error.status < 500)) throw error;
}
