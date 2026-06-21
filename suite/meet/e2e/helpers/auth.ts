import type { APIRequestContext } from "@playwright/test";

const HOST_EMAIL = process.env.E2E_HOST_EMAIL ?? "Administrator";
const HOST_PASSWORD = process.env.E2E_HOST_PASSWORD ?? "admin";
const baseURL = process.env.BASE_URL ?? "http://localhost:8096";

interface LoginOptions {
	usr?: string;
	pwd?: string;
}

export async function loginViaApi(
	request: APIRequestContext,
	options: LoginOptions = {},
): Promise<void> {
	const response = await request.post(new URL("/api/method/login", baseURL).toString(), {
		form: {
			usr: options.usr ?? HOST_EMAIL,
			pwd: options.pwd ?? HOST_PASSWORD,
		},
	});

	if (!response.ok()) {
		throw new Error(`Host login failed with status ${response.status()}`);
	}
}