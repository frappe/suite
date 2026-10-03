import { expect, test, type APIRequestContext } from "@playwright/test";

import {
	dropNotifications,
	notificationState,
	restoreUnread,
	seedNotifications,
	unreadNotificationNames,
} from "../../helpers/bench";
import { adminApi, createFolder, DRIVE, purge, roots, runTag, type DriveNode } from "../../helpers/drive";
import { failRequest } from "../../helpers/shell";

/** Ticket 005: the notifications bell, its badge and Mark all read. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let folder: DriveNode;
let seeded: string[] = [];
let alreadyUnread: string[] = [];
let baseline = 0;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	folder = await createFolder(api, personal, runTag("w4-bell"));
	// Nothing creates a Drive Notification over HTTP yet: sharing is ticket 008.
	// One legacy row on this site carries no activity link, so the route never
	// counts it. The badge baseline therefore comes from the route itself.
	alreadyUnread = unreadNotificationNames();
	baseline = ((await (await api.get(`${DRIVE}/notifications/unread-count`)).json()) as {
		data: { unread: number };
	}).data.unread;
	seeded = seedNotifications(folder.name);
});

test.afterEach(async () => {
	dropNotifications(seeded);
	restoreUnread(alreadyUnread);
	seeded = [];
	await purge(api, folder.name);
	await api.dispose();
});

test("the badge counts unread notifications and Mark all read clears them", async ({ page }) => {
	const expected = String(baseline + seeded.length);
	await page.goto("/home");
	await expect(page.getByTestId("notification-count")).toHaveText(expected);

	await page.getByRole("button", { name: "Notifications" }).click();
	const popover = page.getByTestId("notifications-popover");
	await expect(popover).toBeVisible();
	// The feed paints one plain button per notification, read ones included, so
	// it carries no list semantics and no count to compare against the badge.
	const rows = popover.locator("button[type='button']");
	expect(await rows.count()).toBeGreaterThanOrEqual(seeded.length);

	const readCall = page.waitForResponse(
		(response) => response.url().includes("/notifications/read") && response.request().method() === "POST",
	);
	await popover.getByRole("button", { name: "Mark all read" }).click();
	expect((await readCall).ok()).toBe(true);

	await expect(page.getByTestId("notification-count")).toHaveCount(0);
	await expect(popover.getByRole("button", { name: "Mark all read" })).toBeDisabled();
	expect(notificationState(seeded).every((row) => row.read === 1)).toBe(true);
});

test("a failing feed keeps the bell usable and offers Retry", async ({ page }) => {
	await failRequest(page, "**/api/suite/drive/notifications?*");
	await page.goto("/home");
	await page.getByRole("button", { name: "Notifications" }).click();

	const popover = page.getByTestId("notifications-popover");
	await expect(popover.getByRole("button", { name: "Retry" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
});
