import { expect, type Locator, type Route } from "@playwright/test";
import { fillFolder, folderPath } from "../content";
import { defineFlow, setupFlow } from "../flow";
import type { Hold, Scene } from "../scene";

type Event =
	| { type: "METER_LOADS_SLOWLY" }
	| { type: "METER_FAILS" }
	| { type: "QUOTA_SET" }
	| { type: "NEAR_QUOTA" }
	| { type: "OVER_QUOTA" }
	| { type: "OPEN_STATISTICS" }
	| { type: "OPEN_STATISTICS_SLOWLY" }
	| { type: "OPEN_STATISTICS_FAILS" }
	| { type: "ONLY_TRASH_LEFT" }
	| { type: "OPEN_EXTERNAL_ACCESS_AS_ADMIN" }
	| { type: "OPEN_EXTERNAL_ACCESS" }
	| { type: "GENERATE_KEYS" };

/** Usage answers are whole bytes; the UI counts in base 1024. */
const gigabytes = (count: number) => Math.round(count * 1024 ** 3);

/**
 * The sidebar storage meter and Drive's two Settings tabs. In the code the
 * meter is `StorageMeter.vue` (`usage.data`, `failed`) and `storageMeter()`'s
 * `ok`/`near`/`full` levels; Statistics is `StatisticsSettings.vue`'s
 * `data`/`failed` pair; External access is `ExternalAccessSettings.vue`, whose
 * layout follows which of three shapes `webdav.get` answers, and whose tab
 * `settingsGroup.ts` hides when the answer is `{}`. This site sets no quota
 * and has WebDAV off, so quota levels and External access come from answers
 * the flow rewrites in the browser; the description of each such state says so.
 */
const machine = setupFlow<Event>().createMachine({
	id: "settings",
	initial: "meterNoQuota",
	states: {
		meterNoQuota: {
			meta: { description: "No quota on this site: the sidebar meter shows only the bytes used, with no bar." },
			on: {
				METER_LOADS_SLOWLY: "meterLoading",
				METER_FAILS: "meterFailed",
				QUOTA_SET: "meterOk",
				NEAR_QUOTA: "meterNear",
				OVER_QUOTA: "meterFull",
				OPEN_STATISTICS: "statistics",
				OPEN_STATISTICS_SLOWLY: "statisticsLoading",
				OPEN_STATISTICS_FAILS: "statisticsFailed",
				ONLY_TRASH_LEFT: "statisticsTrashOnly",
				OPEN_EXTERNAL_ACCESS_AS_ADMIN: "externalAccessOff",
				OPEN_EXTERNAL_ACCESS: "externalAccessConnected",
			},
		},
		meterLoading: {
			meta: { description: "The usage request is still out: a skeleton bar and line keep the meter's space." },
		},
		meterFailed: {
			meta: { description: "The usage request failed: the meter disappears, with nothing in its place and no retry." },
		},
		meterOk: {
			meta: { description: "Usage rewritten to 2.4 GB of a 10 GB quota: a grey bar and \"2.4 GB of 10 GB used\"." },
		},
		meterNear: {
			meta: { description: "Usage rewritten to 9.3 GB of 10 GB, past the 90% line: the bar turns amber. Nothing else warns." },
			on: { OPEN_STATISTICS: "statisticsNearQuota" },
		},
		meterFull: {
			meta: { description: "Usage rewritten to 10.4 GB of 10 GB: the bar is full and red, and the line still reads \"10.4 GB of 10 GB used\"." },
		},
		statistics: {
			meta: { description: "The meter opens Settings on Drive > Storage: the bytes used over an empty bar track (there is no quota, but the bar still shows), totals by type and the largest files. External access is absent from the nav because WebDAV is off and the user is no admin." },
		},
		statisticsNearQuota: {
			meta: { description: "Statistics with the rewritten 9.3 GB of 10 GB: the progress bar stays neutral, unlike the amber sidebar meter." },
		},
		statisticsLoading: {
			meta: { description: "Statistics while its usage request is out: \"Loading…\" and three skeleton rows in each list, in the loaded layout." },
		},
		statisticsFailed: {
			meta: { description: "The usage request fails as Statistics opens: \"Storage use could not load.\" and two empty boxes, with no retry. The sidebar meter, a separate request, still shows." },
		},
		statisticsTrashOnly: {
			meta: { description: "Usage rewritten to bytes with no active files behind them: By type explains that Trash and versions still count; Largest files says only \"No files\"." },
		},
		externalAccessOff: {
			meta: { description: "A Drive admin while WebDAV is off for the site (answer rewritten): one switch to enable it, nothing else." },
		},
		externalAccessConnected: {
			meta: { description: "WebDAV on and allowed for this user (answer rewritten): the admin switch, the user's own switch, server URL and username to copy, and Generate keys." },
			on: { GENERATE_KEYS: "apiSecretDialog" },
		},
		apiSecretDialog: {
			meta: { description: "Generate keys: a dialog shows the API key and secret once, each with Copy." },
		},
	},
});

interface Usage {
	used_bytes: number;
	effective_quota: number;
}

const holds = new WeakMap<Scene, Hold>();
const USAGE = "**/api/suite/drive/roots/*/usage*";
const BREAKDOWN = "**/api/suite/drive/roots/*/usage?*expand=breakdown*";
const WEBDAV = "**/api/suite/drive/webdav";

function meter(scene: Scene): Locator {
	return scene.page.getByRole("button", { name: /^Storage: / });
}

function settingsDialog(scene: Scene): Locator {
	return scene.page.getByRole("dialog", { name: "Settings" });
}

/** Rewrites the usage answer, then reloads so the meter reads it. */
async function rewriteUsage(scene: Scene, usage: Partial<Usage> & Record<string, unknown>): Promise<void> {
	await scene.page.route(USAGE, async (route: Route) => {
		// The page can close while a rewrite is in flight; that request no longer matters.
		const response = await route.fetch().catch(() => null);
		if (!response) return;
		// SAFETY: the Drive API's usage endpoint answers an object under `data`.
		const body = (await response.json()) as { data: Record<string, unknown> };
		await route.fulfill({ response, json: { data: { ...body.data, ...usage } } }).catch(() => undefined);
	});
	await scene.page.reload();
}

async function answerWebdav(scene: Scene, answer: Record<string, unknown>): Promise<void> {
	await scene.page.route(WEBDAV, (route) => route.fulfill({ json: { data: answer } }));
}

export const settings = defineFlow<Event>({
	id: "settings",
	title: "Drive settings",
	folderTitle: "Annual report",
	source: "frontend/src/apps/drive/files/features/settings/StatisticsSettings.vue",
	machine,
	async enter(scene) {
		await fillFolder(scene.api, scene.folder.name);
		await scene.goto(folderPath(scene.folder));
		await expect(meter(scene)).toHaveAccessibleName(/^Storage: [\d.]+ \w+ used\./);
	},
	events: {
		async METER_LOADS_SLOWLY(scene) {
			holds.set(scene, await scene.hold(USAGE));
			await scene.page.reload();
			await expect(scene.page.getByRole("searchbox", { name: "Search all files" })).toBeVisible();
			await expect(meter(scene)).toBeHidden();
		},
		async METER_FAILS(scene) {
			const hold = await scene.hold(USAGE);
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByRole("button", { name: /^Actions for / }).first()).toBeVisible();
			await expect(meter(scene)).toBeHidden();
		},
		async QUOTA_SET(scene) {
			await rewriteUsage(scene, { used_bytes: gigabytes(2.4), effective_quota: gigabytes(10) });
			await expect(meter(scene)).toHaveAccessibleName(/2\.4 GB of 10 GB used/);
		},
		async NEAR_QUOTA(scene) {
			await rewriteUsage(scene, { used_bytes: gigabytes(9.3), effective_quota: gigabytes(10) });
			await expect(meter(scene)).toHaveAccessibleName(/9\.3 GB of 10 GB used/);
		},
		async OVER_QUOTA(scene) {
			await rewriteUsage(scene, { used_bytes: gigabytes(10.4), effective_quota: gigabytes(10) });
			await expect(meter(scene)).toHaveAccessibleName(/10\.4 GB of 10 GB used/);
		},
		async OPEN_STATISTICS(scene) {
			await meter(scene).click();
			const dialog = settingsDialog(scene);
			await expect(dialog.getByText("Largest files")).toBeVisible();
			await expect(dialog.getByText(/ used$/).first()).toBeVisible();
		},
		async OPEN_STATISTICS_SLOWLY(scene) {
			holds.set(scene, await scene.hold(BREAKDOWN));
			await meter(scene).click();
			await expect(settingsDialog(scene).getByText("Loading…")).toBeVisible();
		},
		async OPEN_STATISTICS_FAILS(scene) {
			const hold = await scene.hold(BREAKDOWN);
			await hold.abort(500);
			await meter(scene).click();
			await expect(settingsDialog(scene).getByText("Storage use could not load.")).toBeVisible();
		},
		async ONLY_TRASH_LEFT(scene) {
			await rewriteUsage(scene, { by_type: [], largest: [] });
			await meter(scene).click();
			await expect(settingsDialog(scene).getByText(/^No active files/).first()).toBeVisible();
		},
		async OPEN_EXTERNAL_ACCESS_AS_ADMIN(scene) {
			await answerWebdav(scene, { globally_enabled: false, is_admin: true });
			await meter(scene).click();
			const dialog = settingsDialog(scene);
			await dialog.getByText("External access", { exact: true }).first().click();
			await expect(dialog.getByRole("switch", { name: "Enable WebDAV" })).toBeVisible();
		},
		async OPEN_EXTERNAL_ACCESS(scene) {
			await answerWebdav(scene, {
				globally_enabled: true,
				is_admin: true,
				server_url: `${scene.baseURL}/dav/`,
				username: scene.people.actor.email,
				enabled_for_user: true,
				two_factor_blocked: false,
				api_key: null,
			});
			await meter(scene).click();
			const dialog = settingsDialog(scene);
			await dialog.getByText("External access", { exact: true }).first().click();
			await expect(dialog.getByRole("button", { name: "Generate keys" })).toBeVisible();
		},
		async GENERATE_KEYS(scene) {
			await settingsDialog(scene).getByRole("button", { name: "Generate keys" }).click();
			const secret = scene.page.getByRole("dialog", { name: "API access" });
			await expect(secret.getByText("API secret", { exact: true })).toBeVisible();
		},
	},
});
