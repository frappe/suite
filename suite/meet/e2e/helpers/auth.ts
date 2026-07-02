import type { APIRequestContext } from "@playwright/test";

const HOST_EMAIL = process.env.E2E_HOST_EMAIL ?? "Administrator";
const HOST_PASSWORD = process.env.E2E_HOST_PASSWORD ?? "admin";

interface LoginOptions {
	usr?: string;
	pwd?: string;
}

export async function loginViaApi(
	request: APIRequestContext,
	options: LoginOptions = {},
): Promise<void> {
	const response = await request.post("/api/method/login", {
		form: {
			usr: options.usr ?? HOST_EMAIL,
			pwd: options.pwd ?? HOST_PASSWORD,
		},
	});

	if (!response.ok()) {
		throw new Error(`Host login failed with status ${response.status()}`);
	}
}
