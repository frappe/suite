import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { request, type FullConfig } from "@playwright/test";

import { loginViaApi } from "../shared/auth";

const authStatePath = resolve(__dirname, ".state/admin.json");

export default async function globalSetup(config: FullConfig): Promise<void> {
	const baseURL = config.projects[0]?.use.baseURL;
	if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required");

	const api = await request.newContext({ baseURL });
	await loginViaApi(api);
	mkdirSync(dirname(authStatePath), { recursive: true });
	await api.storageState({ path: authStatePath });
	await api.dispose();
}
