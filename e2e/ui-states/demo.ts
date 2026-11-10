import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Browser } from "@playwright/test";
import type { Credentials } from "../shared/auth";
import { openBrowserScene, type BaseScene } from "./scene";

/**
 * The two sites beside the Drive site, on the same bench:
 *
 * - The demo site holds the Northwind dataset (`suite.composition.demo.drive.seed`),
 *   with its own Stalwart, so Mail, Calendar, People, Home and Admin have
 *   real-looking content. Six people: maya (Suite Admin), leo, arjun, nisha,
 *   theo and sofia, all `@northwind.test`.
 * - The setup site was never set up, so it shows the first Admin's wizard.
 *
 * The seed prints the Northwind password once; `UI_STATES_DEMO` names the
 * file it was saved to.
 */
export const DEMO_URL = process.env.UI_STATES_DEMO_URL ?? "http://ui-states-suite.localhost:8021";
export const SETUP_URL = process.env.UI_STATES_SETUP_URL ?? "http://ui-states-setup.localhost:8021";
export const DEMO_DOMAIN = "northwind.test";

export type DemoPerson = "maya" | "leo" | "arjun" | "nisha" | "theo" | "sofia";

const demoFile = process.env.UI_STATES_DEMO ?? resolve(homedir(), ".local/state/ui-states/demo.json");

export function demoUser(person: DemoPerson): Credentials {
	// SAFETY: the operator wrote this file from the seed's output; it holds the shared Northwind password.
	const { password } = JSON.parse(readFileSync(demoFile, "utf8")) as { password: string };
	return { email: `${person}@${DEMO_DOMAIN}`, password };
}

/** A page on the demo site, signed in as `person` (Maya, the Suite Admin, by default). */
export function openDemoScene(browser: Browser, person: DemoPerson = "maya"): Promise<BaseScene> {
	return openBrowserScene(browser, DEMO_URL, demoUser(person));
}

/** A page on the setup site, signed in as Administrator, the only user it has. */
export function openSetupScene(browser: Browser): Promise<BaseScene> {
	return openBrowserScene(browser, SETUP_URL);
}
