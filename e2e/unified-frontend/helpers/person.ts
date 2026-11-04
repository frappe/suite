import { execFileSync } from "node:child_process";

import type { Browser, BrowserContext } from "@playwright/test";

import { loginViaApi } from "../../shared/auth";

// A System User the journeys create on the test site. Grants to it send no
// email: the bench runs no worker, and the address is not a real mailbox.
export const PERSON = "e2e-person@example.com";
export const PERSON_NAME = "E2E Person";
const PERSON_PASSWORD = "ShareJourney!2026";

let ensured = false;

/** Creates PERSON if missing and sets its password through the bench interpreter. */
export function ensurePerson(): void {
	if (ensured) return;
	const bench = process.env.BENCH_PATH ?? "/home/faris/benches/suite-bench";
	const site = process.env.BENCH_SITE ?? "slides.localhost";
	const program = [
		"import frappe",
		"from frappe.utils.password import update_password",
		`frappe.init(site=${JSON.stringify(site)})`,
		"frappe.connect()",
		`email = ${JSON.stringify(PERSON)}`,
		"if not frappe.db.exists('User', email):",
		"    try:",
		`        frappe.get_doc({'doctype': 'User', 'email': email, 'first_name': ${JSON.stringify(PERSON_NAME)}, 'user_type': 'System User', 'send_welcome_email': 0}).insert(ignore_permissions=True)`,
		"        frappe.db.commit()",
		"    except frappe.DuplicateEntryError:",
		"        # Another worker created it first.",
		"        frappe.db.rollback()",
		"if frappe.db.exists('Role', 'Suite User'):",
		"    frappe.get_doc('User', email).add_roles('Suite User')",
		`update_password(email, ${JSON.stringify(PERSON_PASSWORD)})`,
		"frappe.db.commit()",
		"frappe.destroy()",
	].join("\n");
	execFileSync(`${bench}/env/bin/python`, ["-c", program], { cwd: `${bench}/sites` });
	ensured = true;
}

/** A browser context signed in as PERSON. The caller closes it. */
export async function personContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
	ensurePerson();
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	await loginViaApi(context.request, { email: PERSON, password: PERSON_PASSWORD });
	return context;
}
