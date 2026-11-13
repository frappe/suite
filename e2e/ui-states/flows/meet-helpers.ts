import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { DEMO_URL, demoUser, identityOf, type DemoPerson, type Identity } from "../demo";
import { openBrowserScene, perScene, VIEWPORT, type BaseScene } from "../scene";
import { loginViaApi, type Credentials } from "../../shared/auth";

/**
 * Meet needs a media server (SFU) and a site secret to sign its tokens. The
 * demo site has neither, and its configuration must stay as it is, so the
 * meet flow brings its own:
 *
 * - An SFU started outside the bench from `suite/meet/sfu-server`, with
 *   `JWT_SECRET` set to `SFU_SECRET` below, listening on `SFU_URL`.
 * - Page routes that pass every Meet request to the site and replace only an
 *   answer that failed with "SFU secret not configured" by the details the
 *   site would have sent, signed with that same secret.
 *
 * A path that wants the site's own failure turns the replacement off with
 * `useSiteSfuConfig`.
 */
export const SFU_URL = process.env.UI_STATES_SFU_URL ?? "http://127.0.0.1:3021";
const SFU_SECRET = process.env.UI_STATES_SFU_SECRET ?? "ui-states-meet-sfu";
const SITE = new URL(DEMO_URL).hostname;

/** Fake camera, microphone and screen, so calls have media without devices. */
const MEDIA_ARGS = [
	`--unsafely-treat-insecure-origin-as-secure=${DEMO_URL}`,
	"--use-fake-device-for-media-stream",
	"--auto-select-desktop-capture-source=Entire screen",
	"--autoplay-policy=no-user-gesture-required",
];

export type MediaAnswer = "allow" | "deny";

/**
 * The fake prompt answers getUserMedia but leaves the Permissions API at
 * "prompt", which a person who allowed the camera never sees. Granting both
 * makes the device pickers match what that person sees.
 */
function allowMedia(context: BrowserContext): Promise<void> {
	return context.grantPermissions(["camera", "microphone"]);
}

const HOST = identityOf("maya");
export const GUEST_NAME = "Dana Wright";

const shapingOff = perScene<boolean>("SFU shaping");
const meetBrowser = perScene<Browser>("Meet browser");

function base64Url(value: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signToken(claims: Record<string, unknown>): string {
	const header = base64Url({ alg: "HS256", typ: "JWT" });
	const payload = base64Url(claims);
	const signature = createHmac("sha256", SFU_SECRET).update(`${header}.${payload}`).digest("base64url");
	return `${header}.${payload}.${signature}`;
}

function sfuEndpoint() {
	const url = new URL(SFU_URL);
	return { sfu_url: `${url.protocol}//${url.hostname}`, sfu_port: Number(url.port) };
}

function meetingIdOf(url: string, body: string | null): string {
	const fromQuery = new URL(url).searchParams.get("meeting_id");
	if (fromQuery) return fromQuery;
	// SAFETY: Meet's mutations post a JSON object that names the meeting.
	const input = JSON.parse(body ?? "{}") as { meeting_id?: string };
	if (!input.meeting_id) throw new Error(`No meeting_id in ${url}`);
	return input.meeting_id;
}

/** What `_build_sfu_connection_details` answers for a signed-in person. */
function memberDetails(person: Identity, meetingId: string, isHost: boolean, scope: "full" | "presence-preview") {
	const now = Math.floor(Date.now() / 1000);
	const claims = {
		user_id: person.email,
		meeting_id: meetingId,
		site: SITE,
		scope,
		exp: now + 3600,
		iat: now,
		user_name: person.name,
		user_avatar: null,
		is_host: isHost,
		is_cohost: false,
		e2ee_required: false,
		host_only_chat: false,
	};
	const token = signToken(scope === "presence-preview" ? { ...claims, session_id: randomUUID() } : claims);
	return {
		status: "joined",
		message: "Successfully joined the meeting",
		...sfuEndpoint(),
		auth_token: token,
		user_id: person.email,
		meeting_id: meetingId,
		is_host: isHost,
		is_cohost: false,
		codec_strategy: "svc",
		recording_enabled: false,
		e2ee_required: false,
		user_data: { name: person.name, email: person.email, avatar: null },
		expires_in: 3600,
		host_only_chat: false,
	};
}

/** What `_build_guest_connection_details` answers for an admitted guest. */
function guestDetails(body: string | null) {
	// SAFETY: the guest endpoints post the meeting, the guest id and its session token.
	const input = JSON.parse(body ?? "{}") as { meeting_id: string; guest_id: string; guest_session_token?: string };
	const now = Math.floor(Date.now() / 1000);
	const token = signToken({
		user_id: input.guest_id,
		meeting_id: input.meeting_id,
		site: SITE,
		scope: "full",
		exp: now + 300,
		iat: now,
		user_name: GUEST_NAME,
		is_host: false,
		is_cohost: false,
		is_guest: true,
		guest_generation: 1,
		e2ee_required: false,
		host_only_chat: false,
	});
	return {
		status: "joined",
		meeting_id: input.meeting_id,
		guest_id: input.guest_id,
		guest_name: GUEST_NAME,
		guest_session_token: input.guest_session_token,
		auth_token: token,
		expires_in: 300,
		...sfuEndpoint(),
		codec_strategy: "svc",
		host_only_chat: false,
		e2ee_required: false,
		recording: null,
	};
}

const SECRET_MISSING = "SFU secret not configured";

/**
 * Passes a request on to the site. The bench restarts while other flows run,
 * and the harness only retries a path when the page itself sees the restart,
 * so a refused connection here is retried for a while.
 */
async function fetchFromSite(route: Route, options?: Parameters<Route["fetch"]>[0]) {
	for (let attempt = 1; ; attempt++) {
		try {
			return await route.fetch(options);
		} catch (error) {
			if (attempt >= 30 || !String(error).includes("ECONNREFUSED")) throw error;
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
	}
}

/**
 * Lets `person` reach the SFU on a site without `sfu_secret`. `isHost` is
 * what the site would put in the token: Maya owns every meeting the flow makes.
 */
async function shapeMemberRequests(context: BrowserContext, scene: BaseScene, person: Identity, isHost: boolean) {
	await context.route(/\/api\/suite\/meet\/rooms\/(joins|connections|presence-tokens|tokens)(\?|$)/, async (route) => {
		const response = await fetchFromSite(route);
		const body = await response.text();
		const siteOnly = (() => {
			try {
				return shapingOff.get(scene);
			} catch {
				return false;
			}
		})();
		if (siteOnly || response.status() !== 417 || !body.includes(SECRET_MISSING)) {
			await route.fulfill({ response, body });
			return;
		}
		const request = route.request();
		const meetingId = meetingIdOf(request.url(), request.postData());
		const scope = request.url().includes("presence-tokens") ? "presence-preview" : "full";
		const data = memberDetails(person, meetingId, isHost, scope);
		await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
	});
}

/**
 * The same for a signed-out guest. Each guest also gets an address of its own,
 * since the site allows ten fresh guest joins per address an hour.
 */
async function shapeGuestRequests(context: BrowserContext) {
	const address = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
	await context.route(/\/api\/suite\/meet\/rooms\/(guest-joins|guest-connections|guest-tokens)(\?|$)/, async (route) => {
		const request = route.request();
		const response = await fetchFromSite(route, { headers: { ...request.headers(), "x-forwarded-for": address } });
		const body = await response.text();
		if (response.status() !== 417 || !body.includes(SECRET_MISSING)) {
			await route.fulfill({ response, body });
			return;
		}
		const data = guestDetails(request.postData());
		await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
	});
}

/** From now on, this scene's Meet requests get the site's own answers, failures included. */
export function useSiteSfuConfig(scene: BaseScene): void {
	shapingOff.set(scene, true);
}

async function sfuIsUp(): Promise<boolean> {
	try {
		return (await fetch(new URL("/health", SFU_URL))).ok;
	} catch {
		return false;
	}
}

function launchMeetBrowser(browser: Browser, answer: MediaAnswer): Promise<Browser> {
	const ui = answer === "allow" ? "--use-fake-ui-for-media-stream" : "--use-fake-ui-for-media-stream=deny";
	return browser.browserType().launch({ args: [...MEDIA_ARGS, ui] });
}

/**
 * Maya on the demo site, in a browser of the path's own with a fake camera,
 * microphone and screen. Pages opened with `pageAs` share that browser.
 */
export async function openMeetScene(browser: Browser): Promise<BaseScene> {
	// A path here joins calls with two or three browsers; the capture's default budget is for Drive flows.
	test.setTimeout(60 * 60_000);
	if (!(await sfuIsUp())) {
		throw new Error(
			`The meet flow needs an SFU at ${SFU_URL} with JWT_SECRET=${SFU_SECRET}. ` +
				"Start one from suite/meet/sfu-server (see flows/meet-helpers.ts).",
		);
	}
	const own = await launchMeetBrowser(browser, "allow");
	const scene = await openBrowserScene(own, DEMO_URL, demoUser("maya"));
	meetBrowser.set(scene, own);
	await allowMedia(scene.context);
	await shapeMemberRequests(scene.context, scene, HOST, true);
	const close = scene.close.bind(scene);
	return Object.assign(scene, {
		async close() {
			try {
				await close();
			} finally {
				await own.close();
			}
		},
	});
}

/** A second person on the demo site, in the scene's browser, closed with the scene. */
export async function pageAsPerson(scene: BaseScene, who: DemoPerson): Promise<Page> {
	const page = await scene.pageAs(demoUser(who));
	await allowMedia(page.context());
	await shapeMemberRequests(page.context(), scene, identityOf(who), false);
	return page;
}

/** Another tab of Maya's, in a second browser context: a second device as far as Meet knows. */
export async function hostElsewhere(scene: BaseScene): Promise<Page> {
	const page = await scene.pageAs(demoUser("maya"));
	await allowMedia(page.context());
	await shapeMemberRequests(page.context(), scene, HOST, true);
	return page;
}

/** A signed-out visitor in the scene's browser. */
export async function guestPage(scene: BaseScene): Promise<Page> {
	const context = await meetBrowser.get(scene).newContext({ baseURL: DEMO_URL, viewport: VIEWPORT, colorScheme: "light" });
	scene.defer(() => context.close());
	await allowMedia(context);
	await shapeGuestRequests(context);
	return context.newPage();
}

/** Maya in a browser whose camera and microphone prompt is always answered Block. */
export async function hostWithMediaBlocked(scene: BaseScene): Promise<Page> {
	const blocked = await launchMeetBrowser(meetBrowser.get(scene), "deny");
	scene.defer(() => blocked.close());
	const context = await blocked.newContext({ baseURL: DEMO_URL, viewport: VIEWPORT, colorScheme: "light" });
	await loginViaApi(context.request, demoUser("maya"));
	await shapeMemberRequests(context, scene, HOST, true);
	return context.newPage();
}

/** Administrator, who alone may open the audio test, and who has no Calendar account. */
export function adminPage(scene: BaseScene): Promise<Page> {
	const admin: Credentials = { email: "Administrator", password: process.env.E2E_ADMIN_PASSWORD ?? "admin" };
	return scene.pageAs(admin);
}

/** Creates a meeting owned by Maya and removes it when the scene closes. */
export async function createMeeting(scene: BaseScene, type: "open" | "restricted" = "open"): Promise<string> {
	const response = await scene.api.post("/api/suite/meet/rooms", { data: { type } });
	if (!response.ok()) throw new Error(`Creating a meeting failed with ${response.status()}`);
	// SAFETY: rooms.create answers the new meeting's code.
	const { data } = (await response.json()) as { data: { code: string } };
	removeMeetingLater(scene, data.code);
	return data.code;
}

/** Removes a meeting the path made through the UI. One already gone is fine. */
export function removeMeetingLater(scene: BaseScene, meetingId: string): void {
	scene.defer(async () => {
		const response = await scene.api.delete(`/api/v2/document/Meet Room/${meetingId}`);
		if (response.status() >= 500) throw new Error(`Removing meeting ${meetingId} answered ${response.status()}`);
	});
}

export function meetingIdFromUrl(page: Page): string {
	const id = new URL(page.url()).pathname.split("/").pop();
	if (!id) throw new Error(`No meeting in ${page.url()}`);
	return id;
}

/** Joins from the preview and waits until the call's controls are up. */
export async function joinFromPreview(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Join Meeting" }).click();
	await expect(page.getByRole("button", { name: "End Call" })).toBeVisible({ timeout: 30_000 });
}
