import {
	expect,
	test as base,
	type Browser,
	type BrowserContext,
	type Page,
} from "@playwright/test";
import { MEDIA_FAULT_SCRIPT, STUB_MEDIA_SCRIPT } from "./media";
import { loginViaApi } from "../../shared/auth";
import {
	clearMeetingCreateRateLimit,
	createMeetingViaApi,
	type MeetingType,
} from "../helpers/meeting";
import { meetHost } from "../helpers/auth";

const isCI = !!process.env.CI;
const previewTimeout = isCI ? 45_000 : 20_000;
const meetingReadyTimeout = isCI ? 60_000 : 20_000;
const baseURL = process.env.BASE_URL ?? "http://localhost:8098";

function appUrl(pathname: string): string {
	return new URL(pathname, baseURL).toString();
}

async function gotoAppPage(page: Page, pathname: string): Promise<void> {
	const url = appUrl(pathname);
	const response = await page.goto(url);
	if (!response || response.ok()) return;

	const traceback = (
		await page.locator(".error-content").textContent().catch(() => "")
	)?.trim();
	throw new Error(
		`${url} returned HTTP ${response.status()}${traceback ? `\n${traceback}` : ""}`,
	);
}

interface Participant {
	context: BrowserContext;
	page: Page;
	joinMeeting(meetingId: string): Promise<void>;
	joinAsGuest(meetingId: string, guestName: string): Promise<void>;
	joinAsHost(meetingId: string): Promise<void>;
	endCall(): Promise<void>;
}

interface TestFixtures {
	hostPage: Page;
	createMeeting: (meetingType?: MeetingType) => Promise<string>;
	createMeetingViaUi: (meetingType?: MeetingType) => Promise<string>;
	createParticipant: () => Promise<Participant>;
}

async function prepareContext(context: BrowserContext): Promise<void> {
	await context.addInitScript({
		content: `${STUB_MEDIA_SCRIPT}\n${MEDIA_FAULT_SCRIPT}`,
	});
	if (context.browser()?.browserType().name() !== "firefox") {
		await context.grantPermissions(["camera", "microphone"]);
	}
}

async function waitForMeetingReady(page: Page): Promise<void> {
	await page.getByTestId("meeting-layout").waitFor({
		state: "visible",
		timeout: meetingReadyTimeout,
	});
	await expect(page.getByRole("toolbar", { name: "Meeting controls" })).toBeVisible();
	await expect(page.getByRole("button", { name: "End Call" })).toBeVisible();
}

async function joinFromPreview(page: Page): Promise<void> {
	const preview = page.getByRole("heading", { name: "Ready to join?" });
	const meetingLayout = page.getByTestId("meeting-layout");
	const joinButton = page.getByRole("button", {
		name: /^(Join Meeting|Switch here)$/,
	});

	await expect(preview.or(meetingLayout)).toBeVisible({ timeout: previewTimeout });

	if (
		!(await meetingLayout.isVisible().catch(() => false)) &&
		(await preview.isVisible().catch(() => false))
	) {
		await joinButton.waitFor({ state: "visible", timeout: previewTimeout });
		await expect(joinButton).toBeEnabled({ timeout: previewTimeout });
		try {
			await joinButton.click({ timeout: previewTimeout });
			await waitForMeetingReady(page);
			return;
		} catch (error) {
			const previewStillVisible = await preview.isVisible().catch(() => false);
			const layoutVisible = await meetingLayout.isVisible().catch(() => false);
			if (previewStillVisible && !layoutVisible) {
				throw error;
			}
		}
	}

	await waitForMeetingReady(page);
}

/** Host and guest join the same open meeting concurrently. */
async function joinHostAndGuest(
	hostPage: Page,
	guest: Participant,
	meetingId: string,
	guestName: string,
): Promise<void> {
	await Promise.all([
		(async () => {
			await gotoAppPage(hostPage, `/meet/${meetingId}`);
			await joinFromPreview(hostPage);
		})(),
		guest.joinAsGuest(meetingId, guestName),
	]);
}

async function createMeetingViaUi(
	page: Page,
	meetingType: MeetingType = "open",
): Promise<string> {
	await page.getByRole("button", { name: "Instant meet" }).waitFor({
		state: "visible",
		timeout: 20_000,
	});

	if (meetingType === "open") {
		await page.getByRole("button", { name: "Instant meet" }).click();
	} else {
		await page.getByRole("button", { name: "Restricted meet" }).click();
	}

	await page.waitForURL(/\/meet\/[a-z0-9-]+$/);

	const url = new URL(page.url());
	const match = url.pathname.match(/\/meet\/([a-z0-9-]+)$/);
	if (!match) {
		throw new Error(`Could not extract meeting id from URL: ${page.url()}`);
	}

	return match[1];
}

async function buildParticipant(browser: Browser): Promise<Participant> {
	const context = await browser.newContext();
	await prepareContext(context);
	const page = await context.newPage();

	return {
		context,
		page,
		async joinMeeting(meetingId: string) {
			await gotoAppPage(page, `/meet/${meetingId}`);
			await joinFromPreview(page);
		},
		async joinAsGuest(meetingId: string, guestName: string) {
			await gotoAppPage(page, `/meet/${meetingId}`);
			await expect(page.getByRole("heading", { name: "Ready to join?" })).toBeVisible({
				timeout: previewTimeout,
			});
			const guestNameInput = page.getByPlaceholder("John Doe");
			await guestNameInput.fill(guestName);
			await expect(guestNameInput).toHaveValue(guestName);
			await expect(page.getByRole("button", { name: "Join Meeting" })).toBeEnabled({
				timeout: previewTimeout,
			});
			await joinFromPreview(page);
		},
		async joinAsHost(meetingId: string) {
			await loginViaApi(context.request, meetHost);
			await gotoAppPage(page, "/meet/");
			await gotoAppPage(page, `/meet/${meetingId}`);
			await joinFromPreview(page);
		},
		async endCall() {
			await page.getByRole("button", { name: "End Call" }).click();
			await page.waitForURL(/\/meet\/?$/);
		},
	};
}

export const test = base.extend<TestFixtures>({
	hostPage: async ({ browser }, use) => {
		const context = await browser.newContext();
		await prepareContext(context);
		await loginViaApi(context.request, meetHost);
		const page = await context.newPage();
		await gotoAppPage(page, "/meet/");
		await use(page);
		await context.close();
	},

	// API-only meeting create so tests do not share rooms across workers.
	createMeeting: async ({ playwright }, use) => {
		const api = await playwright.request.newContext({ baseURL });
		await loginViaApi(api, meetHost);

		await use(async (meetingType = "open") => {
			await clearMeetingCreateRateLimit(api);
			return createMeetingViaApi(api, meetingType);
		});

		await api.dispose();
	},

	createMeetingViaUi: async ({ hostPage }, use) => {
		await use(async (meetingType = "open") => {
			await clearMeetingCreateRateLimit(hostPage.request);
			return createMeetingViaUi(hostPage, meetingType);
		});
	},

	createParticipant: async ({ browser }, use) => {
		const participants: Participant[] = [];

		await use(async () => {
			const participant = await buildParticipant(browser);
			participants.push(participant);
			return participant;
		});

		await Promise.all(
			participants.map((participant) => participant.context.close()),
		);
	},
});

export { expect, joinFromPreview, joinHostAndGuest };
export { appUrl };
export type { Participant };
