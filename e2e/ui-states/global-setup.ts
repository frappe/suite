import { resolve } from "node:path";
import { request, type FullConfig } from "@playwright/test";
import { provisionUsers, readRun } from "../drive-backed-apps/global-setup";
import { removeUsers } from "../drive-backed-apps/global-teardown";
import { loginViaApi } from "../shared/auth";

/** This suite's own run, so drive-backed-apps never removes its users, nor it theirs. */
export const STATE_DIR = resolve(__dirname, ".state");
/** Actor, peer and fresh (see `People` in scene.ts), and a spare. */
const USER_COUNT = 4;

/** Real-looking names, so screenshots read like a workspace and not a test run. */
const NAMES = [
	["Priya", "Nair"],
	["Arjun", "Mehta"],
	["Sana", "Iqbal"],
	["Rohan", "Desai"],
] as const;

/**
 * Provisions the e2e users, then gives them names fit for a screenshot.
 * Answers the teardown, which removes them.
 */
export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
	await provisionUsers(config, STATE_DIR, USER_COUNT);
	const baseURL = config.projects[0]?.use.baseURL;
	if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required");
	const admin = await request.newContext({ baseURL });
	await loginViaApi(admin);
	for (const [index, user] of readRun(STATE_DIR).users.entries()) {
		const [first_name, last_name] = NAMES[index % NAMES.length];
		const response = await admin.put(`/api/resource/User/${encodeURIComponent(user.email)}`, {
			data: { first_name, last_name },
		});
		if (!response.ok()) throw new Error(`Renaming ${user.email} failed: ${response.status()}`);
	}
	await admin.dispose();
	return () => removeUsers(config, STATE_DIR);
}
