import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { request, type FullConfig } from "@playwright/test";

import { loginViaApi, type Credentials } from "../shared/auth";
import { testApiUrl } from "./global-setup";

const statePath = resolve(__dirname, ".state/run.json");
const admin: Credentials = {
	email: process.env.E2E_ADMIN_EMAIL ?? "Administrator",
	password: process.env.E2E_ADMIN_PASSWORD ?? "admin",
};

export default async function globalTeardown(config: FullConfig): Promise<void> {
	const baseURL = config.projects[0]?.use.baseURL;
	if (typeof baseURL !== "string") return;

	try {
		// SAFETY: global-setup writes this state file with run_id; teardown reads the same fixture path.
		const { run_id } = JSON.parse(readFileSync(statePath, "utf8")) as {
			run_id: string;
		};
		const api = await request.newContext({ baseURL: testApiUrl(baseURL) });
		await loginViaApi(api, admin);
		const response = await api.post("/api/method/suite.drive.e2e_api.cleanup_users", { form: { run_id } });
		if (!response.ok()) {
			console.warn(`E2E cleanup failed: ${await response.text()}`);
		}
		await api.dispose();
	} catch (error) {
		if ((error instanceof Error && "code" in error ? error.code : undefined) !== "ENOENT") throw error;
	} finally {
		rmSync(dirname(statePath), { recursive: true, force: true });
	}
}
