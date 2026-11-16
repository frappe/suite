import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { SETUP_URL } from "../demo";

/**
 * Bench access for the onboarding flows: Python run against a site of the
 * capture's bench, and a snapshot of the setup site that puts it back after a
 * path finished the wizard.
 */

function benchPath(): string {
	const path = process.env.E2E_BENCH_PATH;
	if (!path) throw new Error("E2E_BENCH_PATH must name the bench that serves the sites");
	return path;
}

/** The Frappe site a URL of this bench serves. */
export function siteOf(url: string): string {
	return new URL(url).hostname;
}

const RESULT = "@@ui-states-result@@";

/**
 * Runs `code` on `site` with the bench's Python and returns what its `run(data)`
 * returns. The transaction commits when `run` returns.
 */
export function benchPython<T>(site: string, code: string, data: unknown = null): T {
	const script = [
		"import json, sys",
		"import frappe",
		`frappe.init(site=${JSON.stringify(site)})`,
		"frappe.connect()",
		code,
		"try:",
		"    result = run(json.loads(sys.argv[1]))",
		"    frappe.db.commit()",
		`    print(${JSON.stringify(RESULT)} + json.dumps(result, default=str))`,
		"finally:",
		"    frappe.destroy()",
	].join("\n");
	const output = execFileSync(resolve(benchPath(), "env/bin/python"), ["-W", "ignore", "-c", script, JSON.stringify(data)], {
		cwd: resolve(benchPath(), "sites"),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const line = output.split("\n").find((candidate) => candidate.startsWith(RESULT));
	if (line === undefined) throw new Error(`bench python on ${site} printed no result:\n${output}`);
	// SAFETY: the caller's `run` decides the shape; the caller names it as T.
	return JSON.parse(line.slice(RESULT.length)) as T;
}

interface SiteConfig {
	db_name: string;
	db_user?: string;
	db_password: string;
	db_socket?: string;
	db_host?: string;
	db_port?: number;
}

function siteDirectory(site: string): string {
	return resolve(benchPath(), "sites", site);
}

function databaseArguments(config: SiteConfig): string[] {
	const connection = config.db_socket
		? [`--socket=${config.db_socket}`]
		: [`--host=${config.db_host ?? "127.0.0.1"}`, `--port=${config.db_port ?? 3306}`];
	return [`--user=${config.db_user ?? config.db_name}`, ...connection];
}

const FILE_FOLDERS = ["public/files", "private/files"];

/**
 * Finishing the wizard changes much of the setup site: Suite Settings, System
 * Settings, the installed apps' setup flags, the Administrator's starter files
 * in Drive, Writer, Sheets, Slides and Draw, user defaults, and the logo file.
 * The snapshot is the whole database and the list of files, so restoring it
 * undoes every one of these without knowing them.
 */
export function snapshotSetupSite(): () => void {
	const site = siteOf(SETUP_URL);
	const directory = siteDirectory(site);
	// SAFETY: a bench writes site_config.json with these keys.
	const config = JSON.parse(readFileSync(join(directory, "site_config.json"), "utf8")) as SiteConfig;
	const env = { ...process.env, MYSQL_PWD: config.db_password };
	const dump = join(mkdtempSync(join(tmpdir(), "ui-states-setup-")), "site.sql");
	execFileSync(
		"mariadb-dump",
		[...databaseArguments(config), "--single-transaction", "--skip-lock-tables", `--result-file=${dump}`, config.db_name],
		{ env, stdio: ["ignore", "ignore", "pipe"] },
	);
	const files = new Map(FILE_FOLDERS.map((folder) => [folder, new Set(entries(join(directory, folder)))]));

	return () => {
		execFileSync("mariadb", [...databaseArguments(config), config.db_name], {
			env,
			input: readFileSync(dump),
			stdio: ["pipe", "ignore", "pipe"],
		});
		for (const [folder, before] of files) {
			for (const entry of entries(join(directory, folder))) {
				if (!before.has(entry)) rmSync(join(directory, folder, entry), { recursive: true, force: true });
			}
		}
		rmSync(dump, { force: true });
		const onboarded = benchPython<number>(
			site,
			"def run(_):\n    frappe.clear_cache()\n    return frappe.db.get_single_value('Suite Settings', 'is_onboarded')",
		);
		if (onboarded) throw new Error("The setup site still reads as set up after the restore");
	};
}

function entries(folder: string): string[] {
	try {
		return readdirSync(folder);
	} catch {
		return [];
	}
}

/** Fails every completion request (`PATCH /api/suite/site` with `is_onboarded`), and lets the workspace save through. */
export async function failCompletion(page: Page): Promise<void> {
	await page.route("**/api/suite/site", async (route) => {
		const request = route.request();
		if (request.method() !== "PATCH" || !request.postData()?.includes("is_onboarded")) return route.continue();
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ exc_type: "ServerError", message: "Something went wrong" }),
		});
	});
}

/** Waits until every finite CSS animation on the page has finished; onboarding steps enter with a 0.5 to 1.2 s fade. */
export async function animationsDone(page: Page): Promise<void> {
	await page.waitForFunction(() =>
		document
			.getAnimations()
			.every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
	);
}
