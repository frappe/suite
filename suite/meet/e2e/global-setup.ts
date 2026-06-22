import * as fs from "node:fs";
import * as path from "node:path";
import { request } from "@playwright/test";
import type { FullConfig } from "@playwright/test";
import { loginViaApi } from "./helpers/auth";
import { createMeetingViaApi } from "./helpers/meeting";

async function waitForService(url: string, name: string): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			const response = await fetch(url, { method: "GET" });
			if (response.ok || response.status < 500) {
				return;
			}
		} catch {}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(`${name} did not become ready: ${url}`);
}

export const MEETINGS_STATE_FILE = path.join(__dirname, ".state", "meetings.json");

export interface MeetingsState {
	openMeetingId: string;
	restrictedMeetingId: string;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
	const projectUse = config.projects[0]?.use ?? {};
	const baseURL = String(
		projectUse.baseURL ?? process.env.BASE_URL ?? "http://localhost:8098",
	);
	const sfuBaseURL = process.env.SFU_URL ?? "http://localhost:3000";
	const sfuHealthURL = sfuBaseURL.endsWith("/health")
		? sfuBaseURL
		: `${sfuBaseURL.replace(/\/$/, "")}/health`;

	await waitForService(baseURL, "Frappe Meet");
	await waitForService(sfuHealthURL, "SFU server");

	// Create shared meetings once for the entire test run
	const apiContext = await request.newContext({ baseURL });
	await loginViaApi(apiContext);
	const openMeetingId = await createMeetingViaApi(apiContext, "open");
	const restrictedMeetingId = await createMeetingViaApi(apiContext, "restricted");
	await apiContext.dispose();

	const stateDir = path.dirname(MEETINGS_STATE_FILE);
	if (!fs.existsSync(stateDir)) {
		fs.mkdirSync(stateDir, { recursive: true });
	}

	const state: MeetingsState = { openMeetingId, restrictedMeetingId };
	fs.writeFileSync(MEETINGS_STATE_FILE, JSON.stringify(state, null, 2));
}
