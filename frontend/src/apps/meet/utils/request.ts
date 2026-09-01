interface FrappeErrorPayload {
	message?: string;
	type?: string;
}

export interface Call<T, P = never> {
	readonly error: unknown;
	submit(params?: P): Promise<T | null>;
}

export class MeetRequestError extends Error {
	constructor(
		readonly status: number,
		readonly errors: FrappeErrorPayload[],
	) {
		super(errors[0]?.message || errors[0]?.type || `Request failed with status ${status}`);
	}
}

export async function request<T>(
	path: `/api/v2/${string}`,
	params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<T> {
	if (!path.startsWith("/api/v2/")) {
		throw new TypeError("Meet requests require an absolute /api/v2/ path");
	}

	const headers: Record<string, string> = {
		Accept: "application/json",
		"Content-Type": "application/json; charset=utf-8",
	};
	if (typeof window !== "undefined") {
		headers["X-Frappe-Site-Name"] = window.location.hostname;
		if (window.csrf_token && window.csrf_token !== "{{ csrf_token }}") {
			headers["X-Frappe-CSRF-Token"] = window.csrf_token;
		}
	}

	const response = await fetch(path, {
		method: "POST",
		headers,
		body: JSON.stringify(params),
	});
	const payload = (await response.json().catch(() => null)) as {
		data?: T;
		errors?: FrappeErrorPayload[];
	} | null;
	if (!response.ok) {
		throw new MeetRequestError(response.status, Array.isArray(payload?.errors) ? payload.errors : []);
	}
	if (!payload || !Object.hasOwn(payload, "data")) {
		throw new MeetRequestError(response.status, [
			{ type: "InvalidResponse", message: "Frappe response did not contain data" },
		]);
	}
	return payload.data as T;
}

export async function submit<T, P = never>(
	call: Call<T, P>,
	params?: P,
): Promise<T> {
	const result = await call.submit(params);
	if (result === null) {
		throw call.error || new Error("Frappe request failed without an error response");
	}
	return result;
}
