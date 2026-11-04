import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { request, type APIRequestContext, type FullConfig } from "@playwright/test";
import { loginViaApi, type Credentials } from "../shared/auth";
import { frappeData } from "../shared/frappe";

const statePath = resolve(__dirname, ".state/run.json");
const userStatePath = (index: number) =>
	resolve(__dirname, `.state/user-${index}.json`);
const admin: Credentials = {
	email: process.env.E2E_ADMIN_EMAIL ?? "Administrator",
	password: process.env.E2E_ADMIN_PASSWORD ?? "admin",
};

/**
 * Where `suite.drive.e2e_api` is called. Those endpoints are `whitelist_for_tests`,
 * so Frappe only serves them from a dev server started with `DEV_SERVER=1` and
 * `allow_tests` in the site config. When the site under test runs without that
 * flag, point this at a second `frappe serve` on the same site that has it.
 */
export function testApiUrl(baseURL: string): string {
	return process.env.E2E_TEST_API_URL ?? baseURL;
}

async function cleanupPreviousRun(api: APIRequestContext): Promise<void> {
	try {
		const { run_id } = JSON.parse(readFileSync(statePath, "utf8")) as {
			run_id: string;
		};
		await api.post("/api/method/suite.drive.e2e_api.cleanup_users", {
			form: { run_id },
		});
	} catch {
		// No interrupted run to clean up.
	}
}

export default async function globalSetup(config: FullConfig): Promise<void> {
	const baseURL = config.projects[0]?.use.baseURL;
	if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required");

	let ready = false;
	for (let attempt = 1; attempt <= 40; attempt++) {
		try {
			const response = await fetch(baseURL, { redirect: "manual" });
			if (response.status < 500) {
				ready = true;
				break;
			}
		} catch {
			// Bench may still be starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	if (!ready) throw new Error(`Frappe did not become ready at ${baseURL}`);

	const api = await request.newContext({ baseURL: testApiUrl(baseURL) });
	await loginViaApi(api, admin);
	await cleanupPreviousRun(api);
	const runId = `${Date.now().toString(36)}-${process.pid}`;
	const userCount = Math.max(1, config.workers) * 2;
	const response = await api.post(
		"/api/method/suite.drive.e2e_api.provision_users",
		{
			form: {
				run_id: runId,
				password: process.env.E2E_USER_PASSWORD ?? "DriveWriterE2E!2026",
				user_count: userCount,
			},
		},
	);
	const run = await frappeData<{
		run_id: string;
		users: Credentials[];
	}>(response);
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, JSON.stringify(run));
	for (const [index, user] of run.users.entries()) {
		const userApi = await request.newContext({ baseURL });
		await loginViaApi(userApi, user);
		await userApi.storageState({ path: userStatePath(index) });
		await userApi.dispose();
	}
	await api.dispose();
}
