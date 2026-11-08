import type { APIResponse } from "@playwright/test";

interface FrappeResponse<T> {
	message?: T;
	data?: T;
}

export async function frappeData<T>(response: APIResponse): Promise<T> {
	if (!response.ok()) {
		throw new Error(`Frappe request failed with ${response.status()}: ${await response.text()}`);
	}
	// SAFETY: the successful Frappe method response wraps its result in message/data; callers supply T from the endpoint they requested.
	const body = (await response.json()) as FrappeResponse<T>;
	const data = body.message ?? body.data;
	if (data === undefined) throw new Error("Frappe response contained no data");
	return data;
}
