import {
	expect,
	request,
	test as base,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loginViaApi, type Credentials } from "../../shared/auth";
import { testApiUrl } from "../global-setup";

const statePath = resolve(__dirname, "../.state/run.json");
const userStatePath = (index: number) =>
	resolve(__dirname, `../.state/user-${index}.json`);

/** One row of `suite.drive.e2e_api.provision_users`. */
interface ProvisionedUser extends Credentials {
	user: string;
	/** The user's Personal root node; inserting the user provisions it. */
	personal_root: string | null;
}

interface ProvisionedRun {
	run_id: string;
	users: ProvisionedUser[];
}

interface AuthenticatedPage {
	context: BrowserContext;
	page: Page;
	user: ProvisionedUser;
}

interface Fixtures {
	owner: AuthenticatedPage;
	collaborator: AuthenticatedPage;
	guestPage: Page;
	/** The owner's session against the server that serves `suite.drive.e2e_api` (see `testApiUrl`). */
	testApi: APIRequestContext;
}

interface WorkerFixtures {
	run: ProvisionedRun;
}

async function authenticatedPage(
	browser: Browser,
	user: ProvisionedUser,
	storageState: string,
): Promise<AuthenticatedPage> {
	const context = await browser.newContext({ storageState });
	return { context, page: await context.newPage(), user };
}

export const test = base.extend<Fixtures, WorkerFixtures>({
	run: [
		async ({}, use) => {
			const run = JSON.parse(readFileSync(statePath, "utf8")) as ProvisionedRun;
			await use(run);
		},
		{ scope: "worker" },
	],
	owner: async ({ browser, run }, use, workerInfo) => {
		const userIndex = workerInfo.parallelIndex * 2;
		const authenticated = await authenticatedPage(
			browser,
			run.users[userIndex],
			userStatePath(userIndex),
		);
		await use(authenticated);
		await authenticated.context.close();
	},
	collaborator: async ({ browser, run }, use, workerInfo) => {
		const userIndex = workerInfo.parallelIndex * 2 + 1;
		const authenticated = await authenticatedPage(
			browser,
			run.users[userIndex],
			userStatePath(userIndex),
		);
		await use(authenticated);
		await authenticated.context.close();
	},
	guestPage: async ({ browser }, use) => {
		const context = await browser.newContext();
		const page = await context.newPage();
		await use(page);
		await context.close();
	},
	testApi: async ({ baseURL, owner }, use) => {
		if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required");
		const api = await request.newContext({ baseURL: testApiUrl(baseURL) });
		await loginViaApi(api, owner.user);
		await use(api);
		await api.dispose();
	},
});

export { expect };
