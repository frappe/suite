import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { request, type APIRequestContext, type FullConfig } from "@playwright/test";

import { loginViaApi, type Credentials } from "../shared/auth";
import { frappeData } from "../shared/frappe";

/** Where this suite keeps its run; another suite that provisions users keeps its own. */
export const STATE_DIR = resolve(__dirname, ".state");
const runPath = (stateDir: string) => resolve(stateDir, "run.json");
const userStatePath = (stateDir: string, index: number) => resolve(stateDir, `user-${index}.json`);
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

/** The users `provisionUsers` made for the run kept in `stateDir`. */
export interface Run {
	run_id: string;
	users: Credentials[];
}

export function readRun(stateDir: string): Run {
	// SAFETY: only `provisionUsers` writes this file, with the run the server answered.
	return JSON.parse(readFileSync(runPath(stateDir), "utf8")) as Run;
}

async function cleanupPreviousRun(api: APIRequestContext, stateDir: string): Promise<void> {
	try {
		const { run_id } = readRun(stateDir);
		await api.post("/api/method/suite.drive.e2e_api.cleanup_users", {
			form: { run_id },
		});
	} catch {
		// No interrupted run to clean up.
	}
}

export default function globalSetup(config: FullConfig): Promise<void> {
	return provisionUsers(config, STATE_DIR, Math.max(1, config.workers) * 2);
}

/** Provisions `userCount` users for this run, after removing the users of the last run kept in `stateDir`. */
export async function provisionUsers(config: FullConfig, stateDir: string, userCount: number): Promise<void> {
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
	await cleanupPreviousRun(api, stateDir);
	const runId = `${Date.now().toString(36)}-${process.pid}`;
	const response = await api.post("/api/method/suite.drive.e2e_api.provision_users", {
		form: {
			run_id: runId,
			password: process.env.E2E_USER_PASSWORD ?? "DriveWriterE2E!2026",
			user_count: userCount,
		},
	});
	const run = await frappeData<Run>(response);
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(runPath(stateDir), JSON.stringify(run));
	for (const [index, user] of run.users.entries()) {
		const userApi = await request.newContext({ baseURL });
		await loginViaApi(userApi, user);
		await userApi.storageState({ path: userStatePath(stateDir, index) });
		await userApi.dispose();
	}
	await api.dispose();
}
