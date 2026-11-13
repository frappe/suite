import { rmSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";

import { loginViaApi, type Credentials } from "../shared/auth";
import { readRun, STATE_DIR, testApiUrl } from "./global-setup";

const admin: Credentials = {
	email: process.env.E2E_ADMIN_EMAIL ?? "Administrator",
	password: process.env.E2E_ADMIN_PASSWORD ?? "admin",
};

export default function globalTeardown(config: FullConfig): Promise<void> {
	return removeUsers(config, STATE_DIR);
}

/** Removes the users of the run kept in `stateDir`, then the directory. */
export async function removeUsers(config: FullConfig, stateDir: string): Promise<void> {
	const baseURL = config.projects[0]?.use.baseURL;
	if (typeof baseURL !== "string") return;

	try {
		const { run_id } = readRun(stateDir);
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
		rmSync(stateDir, { recursive: true, force: true });
	}
}
