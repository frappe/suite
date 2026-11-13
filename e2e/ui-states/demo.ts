import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { expect, type APIRequestContext, type Browser } from "@playwright/test";
import type { Credentials } from "../shared/auth";
import { setSiteConfig } from "./bench";
import { callMethod, openBrowserScene, type BaseScene } from "./scene";

/**
 * The two sites beside the Drive site, on the same bench:
 *
 * - The demo site holds the Northwind dataset (`suite.composition.demo.drive.seed`),
 *   with its own Stalwart, so Mail, Calendar, People, Home and Admin have
 *   real-looking content. Six people, in `NAMES` below; Maya is the Suite Admin.
 * - The setup site was never set up, so it shows the first Admin's wizard.
 *
 * The seed prints the Northwind password once; `UI_STATES_DEMO` names the
 * file it was saved to.
 */
export const DEMO_URL = process.env.UI_STATES_DEMO_URL ?? "http://ui-states-suite.localhost:8021";
export const SETUP_URL = process.env.UI_STATES_SETUP_URL ?? "http://ui-states-setup.localhost:8021";
export const DEMO_DOMAIN = "northwind.test";

/** Each demo person's display name, as the seed's cast (`suite/composition/demo/cast.py`) gives it. */
const NAMES = {
	maya: "Maya Chen",
	leo: "Leo Park",
	arjun: "Arjun Rao",
	nisha: "Nisha Patel",
	theo: "Theo Williams",
	sofia: "Sofia Martinez",
} as const;

export type DemoPerson = keyof typeof NAMES;

export interface Identity {
	email: string;
	name: string;
}

export function identityOf(person: DemoPerson): Identity {
	return { email: `${person}@${DEMO_DOMAIN}`, name: NAMES[person] };
}

/** `Name <address>`, as a mail header names the person. */
export function mailboxOf(person: DemoPerson): string {
	const { email, name } = identityOf(person);
	return `${name} <${email}>`;
}

/**
 * The signed-in person's own mail account id, which Mail's URLs and methods
 * name. The seed does not fix it, so it is read each time.
 */
export async function personalAccount(api: APIRequestContext): Promise<string> {
	const info = await callMethod<{ accounts: { id: string; is_personal: boolean }[] }>(api, "suite.mail.api.account.get_user_info");
	const account = info.accounts.find((candidate) => candidate.is_personal);
	if (!account) throw new Error("The signed-in demo person has no personal mail account");
	return account.id;
}

const demoFile = process.env.UI_STATES_DEMO ?? resolve(homedir(), ".local/state/ui-states/demo.json");

export function demoUser(person: DemoPerson): Credentials {
	// SAFETY: the operator wrote this file from the seed's output; it holds the shared Northwind password.
	const { password } = JSON.parse(readFileSync(demoFile, "utf8")) as { password: string };
	return { email: identityOf(person).email, password };
}

/** A page on the demo site, signed in as `person` (Maya, the Suite Admin, by default). */
export function openDemoScene(browser: Browser, person: DemoPerson = "maya"): Promise<BaseScene> {
	return openBrowserScene(browser, DEMO_URL, demoUser(person));
}

/** A page on the setup site, signed in as Administrator, the only user it has. */
export function openSetupScene(browser: Browser): Promise<BaseScene> {
	return openBrowserScene(browser, SETUP_URL);
}

/** Each server process reads the site config again after up to a minute. */
const CONFIG_REREAD_MS = 90_000;
/** Answers in a row that must agree, in case the bench serves from more than one process. */
const AGREEING_ANSWERS = 3;

/**
 * Turns the demo site's Suite Cloud stand-in (`suite_cloud_fake`, see
 * `suite/mail/dev_suite_cloud.py`) on or off, then waits until the site
 * answers Maya that way.
 */
export async function setSuiteCloudStandIn(browser: Browser, on: boolean): Promise<void> {
	await setSiteConfig(new URL(DEMO_URL).hostname, "suite_cloud_fake", on ? 1 : 0);
	const scene = await openDemoScene(browser);
	try {
		let agreeing = 0;
		await expect
			.poll(
				async () => {
					const info = await callMethod<{ is_suite_cloud_configured: boolean }>(scene.api, "suite.mail.api.account.get_user_info");
					agreeing = info.is_suite_cloud_configured === on ? agreeing + 1 : 0;
					return agreeing;
				},
				{ message: `the demo site to answer with Suite Cloud ${on ? "on" : "off"}`, timeout: CONFIG_REREAD_MS, intervals: [1_000] },
			)
			.toBeGreaterThanOrEqual(AGREEING_ANSWERS);
	} finally {
		await scene.close();
	}
}
