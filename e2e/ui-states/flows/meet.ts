import { expect, type Page } from "@playwright/test";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";
import {
	adminPage,
	createMeeting,
	GUEST_NAME,
	guestPage,
	hostElsewhere,
	hostWithMediaBlocked,
	joinFromPreview,
	LEO,
	meetingIdFromUrl,
	openMeetScene,
	pageAsPerson,
	removeMeetingLater,
	useSiteSfuConfig,
} from "./meet-helpers";

type Event =
	| { type: "START_SLOW" }
	| { type: "START_FAILS" }
	| { type: "INSTANT" }
	| { type: "INSTANT_WITHOUT_SFU" }
	| { type: "RESTRICTED" }
	| { type: "SCHEDULE" }
	| { type: "SCHEDULE_WITHOUT_ACCOUNT" }
	| { type: "TYPE_TITLE" }
	| { type: "SUBMIT" }
	| { type: "SUBMIT_SLOW" }
	| { type: "SUBMIT_FAILS" }
	| { type: "JOIN_WITH_CODE" }
	| { type: "TYPE_TEXT" }
	| { type: "TYPE_CODE" }
	| { type: "JOIN_UNKNOWN" }
	| { type: "OPEN_LINK" }
	| { type: "OPEN_LINK_WITHOUT_SFU" }
	| { type: "OPEN_LINK_MEDIA_BLOCKED" }
	| { type: "OPEN_BUSY_LINK" }
	| { type: "OPEN_LINK_ELSEWHERE" }
	| { type: "OPEN_AUDIO_TEST" }
	| { type: "PHONE" }
	| { type: "MEDIA_OFF" }
	| { type: "OPEN_SETTINGS" }
	| { type: "JOIN" }
	| { type: "JOIN_SLOW" }
	| { type: "TRY_CAMERA" }
	| { type: "SWITCH_HERE" }
	| { type: "GUEST_OPENS_LINK" }
	| { type: "GUEST_ASKS" }
	| { type: "HOST_NOTIFIED" }
	| { type: "OPEN_WAITING_PEOPLE" }
	| { type: "LEO_JOINS" }
	| { type: "OPEN_MORE" }
	| { type: "ENABLE_CAPTIONS" }
	| { type: "OPEN_STATS" }
	| { type: "OPEN_CALL_SETTINGS" }
	| { type: "OPEN_INFO" }
	| { type: "OPEN_CHAT" }
	| { type: "SEND_MESSAGE" }
	| { type: "SHARE_SCREEN" }
	| { type: "CAMERA_OFF" }
	| { type: "OPEN_REACTIONS" }
	| { type: "RAISE_HAND" }
	| { type: "LEAVE" }
	| { type: "LEAVE_CONFIRMED" }
	| { type: "OTHER_DEVICE" }
	| { type: "GO_OFFLINE" }
	| { type: "OPEN_PEOPLE" }
	| { type: "PARTICIPANT_MENU" }
	| { type: "REMOVE" }
	| { type: "CONFIRM_REMOVE" }
	| { type: "LEO_WRITES" }
	| { type: "LEO_SHARES" }
	| { type: "OPEN_CHAT_PHONE" };

/**
 * Meet from the home screen to a call. In the code the call screen is
 * `pages/Meeting.vue` choosing between `connectionMoved`, `connectionError`,
 * `showPreview` and the call from four stores (`useConnectionState`,
 * `useLobbyStore`, `useSFUConnection.isConnecting`, `e2eeJoinPendingMessage`),
 * with `LobbyOverlay` and `RejectionOverlay` drawn on top of the call. The
 * explicit machines it has are `ScheduleMeetingDialog`'s `readiness` union and
 * `useParticipantConnectionState`'s lifecycle.
 *
 * The demo site has no SFU and no `sfu_secret`. The flow runs its own SFU and
 * answers the token requests itself (`meet-helpers.ts`); the states named
 * "WithoutSfu" show what the site does on its own.
 */
const machine = setupFlow<Event>().createMachine({
	id: "meet",
	initial: "home",
	states: {
		home: {
			meta: { description: "Meet home: four actions (Instant meet, Restricted meet, Schedule meet, Join with code). Maya has no meetings with a Meet link coming up, so Upcoming meetings is not shown at all." },
			on: {
				START_SLOW: "creating",
				START_FAILS: "createFailed",
				INSTANT: "callAlone",
				INSTANT_WITHOUT_SFU: "joinFailedWithoutSfu",
				RESTRICTED: "restrictedAlone",
				SCHEDULE: "schedule",
				SCHEDULE_WITHOUT_ACCOUNT: "scheduleNoAccount",
				JOIN_WITH_CODE: "joinCode",
				OPEN_LINK: "previewAlone",
				OPEN_LINK_WITHOUT_SFU: "previewWithoutSfu",
				OPEN_LINK_MEDIA_BLOCKED: "previewMediaBlocked",
				OPEN_BUSY_LINK: "previewOthersIn",
				OPEN_LINK_ELSEWHERE: "previewSwitchHere",
				OPEN_AUDIO_TEST: "audioTest",
				PHONE: "homePhone",
			},
		},
		homePhone: {
			meta: { description: "Meet home at phone width: the sidebar is replaced by a bottom tab bar (Home, Drive, Mail, Calendar, Meet, People, Account), and the four actions sit in two columns." },
		},
		creating: {
			meta: { description: "Instant meet pressed while the create request is out: a “Creating meeting...” toast, and Instant meet and Restricted meet are disabled." },
		},
		createFailed: {
			meta: { description: "The create request failed: a “Failed to create meeting. Please try again.” toast, and the home screen is usable again." },
		},
		joinFailedWithoutSfu: {
			meta: { description: "Instant meet on this site as it is configured: the meeting is created and the call screen opens, then join fails with the server's raw message “SFU secret not configured” and a Try Again button. The creation toast still says “Meeting created successfully!”." },
		},
		schedule: {
			meta: { description: "Schedule meet: Title, Date (today), Start and End (the next two whole hours) and a participant picker. Schedule is on before a title is typed." },
			on: { TYPE_TITLE: "scheduleFilled" },
		},
		scheduleAccountLoading: {
			meta: {
				description: "Schedule meet while the Calendar account loads: “Loading Calendar account...” and no form. Home has already loaded the account, so the dialog opens on the form at once.",
				transient: true,
			},
		},
		scheduleNoAccount: {
			meta: { description: "Schedule meet for a person with no Calendar account (Administrator here): no form, only an alert, “You do not have a Calendar account. Open Admin users to…”, cut off at one line, then Retry and Open Admin users. Schedule is disabled." },
		},
		scheduleFilled: {
			meta: { description: "A title typed and the date and times filled in. Maya is listed as the only participant, and Schedule is enabled." },
			on: { SUBMIT: "scheduled", SUBMIT_SLOW: "scheduling", SUBMIT_FAILS: "scheduleFailed" },
		},
		scheduling: {
			meta: { description: "Schedule pressed while the request is out: the button spins and a “Scheduling meeting...” toast shows. The form stays editable." },
		},
		scheduled: {
			meta: { description: "The dialog closes, a “Meeting scheduled.” toast shows and Upcoming meetings appears under the actions with the new meeting." },
		},
		scheduleFailed: {
			meta: { description: "The request failed: a red alert at the top of the dialog, “Could not schedule the meeting. Your details are kept. Please t…”, cut off at one line; the form keeps what was typed, and a toast says the meeting was not scheduled." },
		},
		joinCode: {
			meta: { description: "Join with meeting code: one field for a code or link. Join is disabled while the field is empty." },
			on: { TYPE_TEXT: "joinCodeInvalid", TYPE_CODE: "joinCodeValid" },
		},
		joinCodeInvalid: {
			meta: { description: "Text that is not a meeting code: Join stays disabled and nothing says why. The format message in the code only shows when the form is submitted, which a disabled Join prevents." },
		},
		joinCodeValid: {
			meta: { description: "A well-formed code (xxxx-xxxx-xxxx): Join turns on. The code is not checked against the server yet." },
			on: { JOIN_UNKNOWN: "meetingNotFound" },
		},
		meetingNotFound: {
			meta: { description: "A code that names no meeting: the pre-join screen still says “Ready to join?”, turns the camera on and offers Copy link, with “Meeting not found” where the Join button would be." },
		},
		previewStarting: {
			meta: {
				description: "The pre-join screen while the camera starts and the people in the call are fetched: the Join button spins. It lasts as long as the fake camera takes to open.",
				transient: true,
			},
		},
		permissionPrompt: {
			meta: {
				description: "The browser's own camera and microphone prompt over the pre-join screen. It is browser chrome, outside the page, so a page screenshot cannot show it.",
				transient: true,
			},
		},
		previewAlone: {
			meta: { description: "Pre-join for a meeting nobody is in: the camera preview with microphone, camera and settings buttons, “Ready to join?” and “You'll be the first to join this meeting”." },
			on: { MEDIA_OFF: "previewMediaOff", OPEN_SETTINGS: "previewSettings", JOIN: "callAlone", JOIN_SLOW: "connecting", PHONE: "previewPhone" },
		},
		previewPhone: {
			meta: { description: "Pre-join at phone width: the preview above, the join details below." },
		},
		previewMediaOff: {
			meta: { description: "Microphone and camera turned off before joining: the preview shows Maya's avatar and both buttons are red." },
		},
		previewSettings: {
			meta: { description: "Settings from the pre-join screen: “Meeting settings” opens on Devices, with the camera, microphone and speaker pickers." },
		},
		previewWithoutSfu: {
			meta: { description: "Pre-join on this site as it is configured: the people-in-call check fails, a red box shows the raw “SFU secret not configured”, and there is no Join button at all." },
		},
		previewMediaBlocked: {
			meta: { description: "Pre-join after the browser blocked the camera and microphone: Maya's avatar instead of video, both buttons red, no Settings button, and a toast “Media access denied. Enable permissions in browser settings.”" },
			on: { TRY_CAMERA: "previewCameraBlocked" },
		},
		previewCameraBlocked: {
			meta: { description: "The camera button pressed again while the browser still blocks it: a second toast, “Camera access denied. Enable in browser settings.”" },
		},
		previewOthersIn: {
			meta: { description: "Pre-join while Leo is in the call: his avatar and “Leo Park is in the meeting”." },
		},
		previewSwitchHere: {
			meta: { description: "Maya opens a meeting she is already in on another device: her own avatar is listed and the button reads “Switch here” instead of “Join Meeting”." },
			on: { SWITCH_HERE: "switchedHere" },
		},
		switchedHere: {
			meta: { description: "Switch here pressed: this tab joins the call without asking, and the other device's tab is moved out." },
		},
		connecting: {
			meta: { description: "Join pressed while the join request is slow: the call screen replaces the pre-join screen at once, with Maya's camera full size and the whole toolbar, before the server has answered. After five seconds a “Connecting…” toast appears; nothing else says she is not in the call yet." },
		},
		joinFailedAfterRecovery: {
			meta: {
				description: "The connection could not be restored after it dropped: “We couldn't restore your meeting connection. Try joining again.” with Try Again. Recovery keeps retrying for longer than a capture path can wait offline.",
				transient: true,
			},
		},
		e2eePending: {
			meta: {
				description: "Joining an end-to-end encrypted meeting before the host's key arrives: “Joining encrypted meeting” or “Waiting for the host to join” with an End-to-end encrypted badge. Not reached: it needs E2EE turned on for the meeting and a key exchange between devices.",
				transient: true,
			},
		},
		recording: {
			meta: {
				description: "Recording: the Start recording item in More, its preflight dialog, the red recording indicator in the header and the stop dialog. Not reached: recording is off in Meet Settings on this site and there is no recorder service.",
				transient: true,
			},
		},
		audioTest: {
			meta: { description: "The audio test at /meet/audio-test, for System Managers only (Maya is sent back to Meet home). Inside the Suite sidebar: one coloured card per notification sound (user joined, user left, join request, chat message, hand raised), each with a Play button and the notes it plays, then Play All Notifications and testing tips. The Play button labels are cut off." },
		},
		restrictedAlone: {
			meta: { description: "Restricted meet: Maya is let straight into her own restricted meeting. Nothing on the call screen says it is restricted." },
			on: { GUEST_OPENS_LINK: "guestPreview" },
		},
		guestPreview: {
			meta: { description: "A signed-out visitor opens the restricted meeting's link: pre-join with a Your name field and Sign in in the header, and Join Meeting disabled until a name is typed. Guests do not see who is in the call." },
			on: { GUEST_ASKS: "guestWaiting" },
		},
		guestWaiting: {
			meta: { description: "The guest asked to join: “Waiting to be admitted” with Leave, drawn over the call screen with the guest's own camera and the full toolbar behind the blur." },
			on: { HOST_NOTIFIED: "joinRequest" },
		},
		joinRequest: {
			meta: { description: "Maya's call while the guest waits: a card in the corner, “Dana Wright wants to join the meeting”, with Admit and Deny. It covers the People and Chat buttons." },
			on: { OPEN_WAITING_PEOPLE: "peopleWaiting" },
		},
		peopleWaiting: {
			meta: { description: "People with a guest waiting, after closing the request card: “Waiting to join” with Admit all, the guest marked Guest with tick and cross buttons, then the people in the call." },
		},
		guestAdmitted: {
			meta: {
				description: "Admit pressed: the guest's waiting screen gives way to the call and their tile joins Maya's. Not reached: the guest learns of the decision through Suite's realtime handler `guest_subscribe` (realtime/handlers.js), which only the Node realtime server loads. This bench runs Frappe's Python realtime server, so the guest's subscription is never answered and the guest waits for ever.",
				transient: true,
			},
		},
		guestDenied: {
			meta: {
				description: "Deny pressed, as the guest sees it: “Entry denied” over the blurred call screen, with a button back to Meet home. Not reached, for the same reason as the admitted guest: the decision travels through the `guest_subscribe` realtime handler, which this bench's Python realtime server does not load.",
				transient: true,
			},
		},
		callAlone: {
			meta: { description: "Instant meet: the meeting is created and Maya joins at once, alone, her camera filling the screen. A toast offers Copy link." },
			on: {
				LEO_JOINS: "callTwo",
				OPEN_MORE: "moreMenu",
				OPEN_INFO: "infoPopover",
				OPEN_CHAT: "chatEmpty",
				SHARE_SCREEN: "sharingScreen",
				CAMERA_OFF: "callCameraOff",
				OPEN_REACTIONS: "reactionPicker",
				RAISE_HAND: "handRaised",
				LEAVE: "leaveConfirm",
				OTHER_DEVICE: "movedAway",
			},
		},
		callTwo: {
			meta: { description: "Leo joins: two tiles side by side and a “Leo Park joined the meeting” toast." },
			on: {
				OPEN_PEOPLE: "people",
				LEO_WRITES: "chatToast",
				LEO_SHARES: "watchingShare",
				GO_OFFLINE: "connectionLost",
				PHONE: "callPhone",
			},
		},
		callPhone: {
			meta: { description: "A two-person call at phone width: the tiles stack one above the other and the toolbar is hidden until the screen is touched. Meeting information, People and Chat are in More here." },
			on: { OPEN_CHAT_PHONE: "chatPhone" },
		},
		chatPhone: {
			meta: { description: "Chat at phone width: the panel covers the whole call." },
		},
		moreMenu: {
			meta: { description: "More: Enable captions, Stats for nerds, Report an issue, Enter full screen and Settings." },
			on: { ENABLE_CAPTIONS: "captionsOn", OPEN_STATS: "statsOverlay", OPEN_CALL_SETTINGS: "callSettings" },
		},
		captionsOn: {
			meta: { description: "Captions turned on, More opened again: the item now reads Disable captions. Until someone speaks, this menu item is the only sign that captions are on." },
		},
		captionsWithText: {
			meta: {
				description: "Caption lines above the toolbar, each with the speaker's name. Not reached: the SFU turns call audio into text through ffmpeg, which is not installed on this machine (its log shows “spawn ffmpeg ENOENT”), and no speech-to-text server is configured.",
				transient: true,
			},
		},
		statsOverlay: {
			meta: { description: "Stats for nerds: a panel of connection numbers over the call, including the connection's lifecycle state." },
		},
		callSettings: {
			meta: { description: "Settings in the call, for the host: “Meeting settings” with a Controls tab for the meeting above the device and display tabs." },
		},
		infoPopover: {
			meta: { description: "Meeting information: the meeting ID and URL, each with a copy button." },
		},
		chatEmpty: {
			meta: { description: "Chat opened: a side panel with “No messages yet” and the message field." },
			on: { SEND_MESSAGE: "chatSent" },
		},
		chatSent: {
			meta: { description: "Maya's message in the chat panel." },
		},
		chatToast: {
			meta: { description: "Leo writes while Maya's chat is closed: a toast with his avatar, name and the start of the message. The toast sits over the side-panel buttons, so the unread dot on Chat is hidden while it shows." },
		},
		sharingScreen: {
			meta: { description: "Maya shares her screen: her screen becomes the large tile with “You are sharing your screen” over it, and the camera tiles move to a column." },
		},
		watchingShare: {
			meta: { description: "Leo shares his screen: it fills the large tile, labelled “Leo Park's screen”, with the camera tiles beside it." },
		},
		callCameraOff: {
			meta: { description: "Maya turns her camera off in the call: her tile shows her avatar and the camera button turns red." },
		},
		reactionPicker: {
			meta: { description: "Reactions: a grid of emoji above the toolbar." },
		},
		handRaised: {
			meta: { description: "Raise Hand: an orange hand badge in the top-left corner of Maya's tile, and the Raise Hand button turns orange." },
		},
		leaveConfirm: {
			meta: { description: "End Call asks first: “Leave meeting?” with Stay and Leave meeting." },
			on: { LEAVE_CONFIRMED: "left" },
		},
		left: {
			meta: { description: "After leaving, Maya is back on Meet home. Nothing says the call ended." },
		},
		movedAway: {
			meta: { description: "Maya switched the call to another device: this tab stops her audio and video and says “Meeting moved to another device”, with Back to Meet." },
		},
		connectionLost: {
			meta: { description: "Maya's network drops for fifteen seconds: a small Wi-Fi alert icon appears on her own tile, and Leo's tile falls back to his avatar with a muted microphone, as if he had turned his camera and microphone off. Nothing says the call is reconnecting." },
		},
		people: {
			meta: { description: "People: a search field and everyone in the call, Maya marked (You) and Host, with camera and microphone state and an actions button for Leo." },
			on: { PARTICIPANT_MENU: "participantMenu" },
		},
		participantMenu: {
			meta: { description: "The host's actions for Leo: Mute, Promote to Co-host and Remove." },
			on: { REMOVE: "removeConfirm" },
		},
		removeConfirm: {
			meta: { description: "Remove asks first: “Remove Participant”, naming Leo, with Cancel and Remove." },
			on: { CONFIRM_REMOVE: "removed" },
		},
		removed: {
			meta: { description: "Leo's side after Maya removes him: he is back on Meet home with “You have been removed from the meeting by the host”." },
		},
	},
});

const leo = perScene<Page>("Leo's page");
const guest = perScene<Page>("the guest's page");
const elsewhere = perScene<Page>("another page");
const meetingId = perScene<string>("meeting");

const PHONE = { width: 390, height: 844 };
const UNKNOWN_CODE = "qxzv-wmbt-klop";

/** States screenshotted from a page other than Maya's main tab. */
const FRAMED: Record<string, (scene: BaseScene) => Page> = {
	guestPreview: (scene) => guest.get(scene),
	guestWaiting: (scene) => guest.get(scene),
	previewMediaBlocked: (scene) => elsewhere.get(scene),
	previewCameraBlocked: (scene) => elsewhere.get(scene),
	removed: (scene) => leo.get(scene),
	audioTest: (scene) => elsewhere.get(scene),
	scheduleNoAccount: (scene) => elsewhere.get(scene),
};

/**
 * The first tile on the page: Maya's own in the preview and in a call she is
 * alone in. Its video element stays in the page when the camera is off.
 */
function ownTile(page: Page) {
	return page.locator("[data-video-enabled]").first();
}

function button(page: Page, name: string) {
	return page.getByRole("button", { name, exact: true });
}

async function waitInCall(page: Page) {
	await expect(button(page, "End Call")).toBeVisible({ timeout: 30_000 });
}

/** Starts a meeting from a home action and joins it, as Instant and Restricted do. */
async function startFromHome(scene: BaseScene, action: "Instant meet" | "Restricted meet") {
	const created = scene.page.waitForResponse(
		(response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/suite/meet/rooms",
	);
	await scene.page.getByRole("button", { name: action }).click();
	// Remove the meeting as soon as it exists, so a path that fails while joining does not leave it behind.
	// SAFETY: rooms.create answers the new meeting's code.
	const { data } = (await (await created).json()) as { data: { code: string } };
	removeMeetingLater(scene, data.code);
	meetingId.set(scene, data.code);
	await waitInCall(scene.page);
}

async function openLink(scene: BaseScene, page: Page, id: string) {
	await page.goto(`/meet/${id}`);
	await expect(page.getByRole("heading", { name: "Ready to join?" })).toBeVisible({ timeout: 20_000 });
}

async function leoJoins(scene: BaseScene): Promise<Page> {
	const page = await pageAsPerson(scene, "leo", LEO);
	leo.set(scene, page);
	await openLink(scene, page, meetingId.get(scene));
	await joinFromPreview(page);
	return page;
}

async function openSchedule(page: Page) {
	await page.getByRole("button", { name: "Schedule meet" }).click();
	await expect(page.getByRole("dialog", { name: "Schedule meet" })).toBeVisible();
}

/** Clicks a toolbar item that sits in More at phone width. */
async function moreItem(page: Page, label: string) {
	await button(page, "More options").click();
	await page.getByRole("menuitem", { name: label }).click();
}

export const meet = defineFlow<Event, BaseScene>({
	id: "meet",
	title: "Meet",
	source: "frontend/src/apps/meet/pages/Meeting.vue",
	open: openMeetScene,
	machine,
	async enter(scene) {
		await scene.goto("/meet");
		await expect(scene.page.getByRole("button", { name: "Instant meet" })).toBeVisible();
	},
	events: {
		async START_SLOW(scene) {
			await scene.hold("**/api/suite/meet/rooms");
			await scene.page.getByRole("button", { name: "Instant meet" }).click();
			await expect(scene.page.getByText("Creating meeting...")).toBeVisible();
		},
		async START_FAILS(scene) {
			const hold = await scene.hold("**/api/suite/meet/rooms");
			await hold.abort(500);
			await scene.page.getByRole("button", { name: "Instant meet" }).click();
			await expect(scene.page.getByText("Failed to create meeting. Please try again.")).toBeVisible({ timeout: 30_000 });
		},
		async INSTANT(scene) {
			await startFromHome(scene, "Instant meet");
		},
		async INSTANT_WITHOUT_SFU(scene) {
			useSiteSfuConfig(scene);
			await scene.page.getByRole("button", { name: "Instant meet" }).click();
			await expect(button(scene.page, "Try Again")).toBeVisible({ timeout: 30_000 });
			removeMeetingLater(scene, meetingIdFromUrl(scene.page));
		},
		async RESTRICTED(scene) {
			await startFromHome(scene, "Restricted meet");
		},
		async SCHEDULE(scene) {
			await openSchedule(scene.page);
			await expect(scene.page.getByLabel("Title")).toBeVisible();
		},
		async SCHEDULE_WITHOUT_ACCOUNT(scene) {
			const page = await adminPage(scene);
			elsewhere.set(scene, page);
			await page.goto("/meet");
			await openSchedule(page);
			await expect(button(page, "Retry")).toBeVisible();
		},
		async TYPE_TITLE(scene) {
			await scene.page.getByLabel("Title").fill("Quarterly planning");
		},
		async SUBMIT(scene) {
			const answered = scene.page.waitForResponse((response) => response.url().includes("/api/suite/meet/calendar-meetings"));
			await button(scene.page, "Schedule").click();
			const response = await answered;
			// SAFETY: meetings.createCalendar posts the account and answers the new event and meeting.
			const { account } = response.request().postDataJSON() as { account: string };
			const { data } = (await response.json()) as { data: { event_id: string; meeting_id: string } };
			removeMeetingLater(scene, data.meeting_id);
			scene.defer(() =>
				scene.api.post("/api/method/suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_events", {
					data: { account, ids: [data.event_id] },
				}),
			);
			await expect(scene.page.getByText("Meeting scheduled.")).toBeVisible();
			await expect(scene.page.getByText("Quarterly planning")).toBeVisible();
		},
		async SUBMIT_SLOW(scene) {
			await scene.hold("**/api/suite/meet/calendar-meetings");
			await button(scene.page, "Schedule").click();
			await expect(scene.page.getByText("Scheduling meeting...")).toBeVisible();
		},
		async SUBMIT_FAILS(scene) {
			const hold = await scene.hold("**/api/suite/meet/calendar-meetings");
			await hold.abort(500);
			await button(scene.page, "Schedule").click();
			await expect(scene.page.getByText("Could not schedule the meeting. Your details are kept. Please try again.")).toBeVisible({ timeout: 30_000 });
		},
		async JOIN_WITH_CODE(scene) {
			await scene.page.getByRole("button", { name: "Join with code" }).click();
			await expect(scene.page.getByRole("dialog", { name: "Join with meeting code" })).toBeVisible();
		},
		async TYPE_TEXT(scene) {
			await scene.page.getByPlaceholder("Enter a code or link").fill("weekly sync");
			await expect(button(scene.page, "Join")).toBeDisabled();
		},
		async TYPE_CODE(scene) {
			await scene.page.getByPlaceholder("Enter a code or link").fill(UNKNOWN_CODE);
			await expect(button(scene.page, "Join")).toBeEnabled();
		},
		async JOIN_UNKNOWN(scene) {
			await button(scene.page, "Join").click();
			await expect(scene.page.getByText("Meeting not found")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_LINK(scene) {
			await openLink(scene, scene.page, await createMeeting(scene));
			await expect(scene.page.getByText("You'll be the first to join this meeting")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_LINK_WITHOUT_SFU(scene) {
			useSiteSfuConfig(scene);
			await openLink(scene, scene.page, await createMeeting(scene));
			await expect(scene.page.getByText("SFU secret not configured")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_LINK_MEDIA_BLOCKED(scene) {
			const id = await createMeeting(scene);
			const page = await hostWithMediaBlocked(scene);
			elsewhere.set(scene, page);
			await openLink(scene, page, id);
			await expect(page.getByText("Media access denied. Enable permissions in browser settings.")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_BUSY_LINK(scene) {
			meetingId.set(scene, await createMeeting(scene));
			await leoJoins(scene);
			await openLink(scene, scene.page, meetingId.get(scene));
			await expect(scene.page.getByText("Leo Park is in the meeting")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_LINK_ELSEWHERE(scene) {
			const id = await createMeeting(scene);
			const other = await hostElsewhere(scene);
			elsewhere.set(scene, other);
			await openLink(scene, other, id);
			await joinFromPreview(other);
			await openLink(scene, scene.page, id);
			await expect(button(scene.page, "Switch here")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_AUDIO_TEST(scene) {
			const page = await adminPage(scene);
			elsewhere.set(scene, page);
			await page.goto("/meet/audio-test");
			await expect(page.getByRole("heading", { name: "Audio Notification Test" })).toBeVisible({ timeout: 20_000 });
		},
		async PHONE(scene) {
			await scene.page.setViewportSize(PHONE);
			await scene.settle();
		},
		async MEDIA_OFF(scene) {
			await button(scene.page, "Toggle Audio (Ctrl+D)").click();
			await button(scene.page, "Toggle Video (Ctrl+E)").click();
			await expect(ownTile(scene.page)).toHaveAttribute("data-video-enabled", "false");
		},
		async OPEN_SETTINGS(scene) {
			await button(scene.page, "Settings").click();
			await expect(scene.page.getByRole("dialog", { name: "Meeting settings" })).toBeVisible();
		},
		async JOIN(scene) {
			await joinFromPreview(scene.page);
		},
		async JOIN_SLOW(scene) {
			await scene.hold("**/api/suite/meet/rooms/joins");
			await button(scene.page, "Join Meeting").click();
			await expect(scene.page.getByText("Connecting…")).toBeVisible({ timeout: 15_000 });
		},
		async TRY_CAMERA(scene) {
			const page = elsewhere.get(scene);
			await button(page, "Toggle Video (Ctrl+E)").click();
			await expect(page.getByText("Camera access denied. Enable in browser settings.")).toBeVisible();
		},
		async SWITCH_HERE(scene) {
			await button(scene.page, "Switch here").click();
			await waitInCall(scene.page);
			await expect(elsewhere.get(scene).getByText("Meeting moved to another device")).toBeVisible({ timeout: 20_000 });
		},
		async GUEST_OPENS_LINK(scene) {
			const page = await guestPage(scene);
			guest.set(scene, page);
			await openLink(scene, page, meetingId.get(scene));
			await expect(page.getByPlaceholder("John Doe")).toBeVisible();
		},
		async GUEST_ASKS(scene) {
			const page = guest.get(scene);
			await page.getByPlaceholder("John Doe").fill(GUEST_NAME);
			await button(page, "Join Meeting").click();
			await expect(page.getByRole("heading", { name: "Waiting to be admitted" })).toBeVisible({ timeout: 20_000 });
		},
		async HOST_NOTIFIED(scene) {
			await expect(scene.page.locator("[data-testid^='join-request-']")).toBeVisible({ timeout: 20_000 });
			// The eight-second “Meeting created” toast sits on top of the request card until it times out.
			await expect(scene.page.getByText("Meeting created successfully!")).toBeHidden({ timeout: 15_000 });
		},
		async OPEN_WAITING_PEOPLE(scene) {
			// The request card covers People. Its close button is the card's first button; it has no name.
			const card = scene.page.locator("[data-testid^='join-request-']");
			await card.getByRole("button").first().click();
			await expect(card).toBeHidden();
			await button(scene.page, "Show Participants").click();
			await expect(scene.page.getByText("Waiting to join")).toBeVisible();
		},
		async LEO_JOINS(scene) {
			await leoJoins(scene);
			await expect(scene.page.getByText("Leo Park joined the meeting")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_MORE(scene) {
			await button(scene.page, "More options").click();
			await expect(scene.page.getByRole("menuitem", { name: "Stats for nerds" })).toBeVisible();
		},
		async ENABLE_CAPTIONS(scene) {
			await scene.page.getByRole("menuitem", { name: "Enable captions" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Enable captions" })).toBeHidden();
			await button(scene.page, "More options").click();
			await expect(scene.page.getByRole("menuitem", { name: "Disable captions" })).toBeVisible({ timeout: 10_000 });
		},
		async OPEN_STATS(scene) {
			await scene.page.getByRole("menuitem", { name: "Stats for nerds" }).click();
			await expect(scene.page.getByText("Lifecycle")).toBeVisible();
		},
		async OPEN_CALL_SETTINGS(scene) {
			await scene.page.getByRole("menuitem", { name: "Settings" }).click();
			await expect(scene.page.getByRole("dialog", { name: "Meeting settings" })).toBeVisible();
		},
		async OPEN_INFO(scene) {
			await button(scene.page, "Meeting information").click();
			await expect(scene.page.getByText("Meeting URL")).toBeVisible();
		},
		async OPEN_CHAT(scene) {
			await button(scene.page, "Show Chat").click();
			await expect(scene.page.getByText("No messages yet")).toBeVisible();
		},
		async SEND_MESSAGE(scene) {
			await scene.page.getByPlaceholder("Type a message").fill("Starting in two minutes, grabbing a coffee.");
			await scene.page.keyboard.press("Enter");
			await expect(scene.page.getByText("Starting in two minutes, grabbing a coffee.")).toBeVisible();
		},
		async SHARE_SCREEN(scene) {
			// The button works before the call's send transport exists, and a share started then fails with
			// “not loaded”; give the transport time to come up.
			await scene.page.waitForTimeout(3_000);
			await button(scene.page, "Toggle Screen Share").click();
			await expect(scene.page.getByText("You are sharing your screen")).toBeVisible({ timeout: 20_000 });
		},
		async CAMERA_OFF(scene) {
			await button(scene.page, "Toggle Video (Ctrl+E)").click();
			await expect(ownTile(scene.page)).toHaveAttribute("data-video-enabled", "false");
		},
		async OPEN_REACTIONS(scene) {
			await button(scene.page, "Reactions").click();
			await expect(scene.page.getByTestId("reaction-picker")).toBeVisible();
		},
		async RAISE_HAND(scene) {
			// The hand shows at once and is taken down again if the server has not confirmed it, which happens
			// when the button is pressed right after joining. Wait for the call to settle, then check the hand
			// is still up after the server's answer.
			await scene.page.waitForTimeout(3_000);
			await button(scene.page, "Raise Hand").click();
			const hand = scene.page.getByLabel("Maya Chen has raised their hand").first();
			await expect(hand).toBeVisible();
			await scene.page.waitForTimeout(1_500);
			await expect(hand).toBeVisible();
		},
		async LEAVE(scene) {
			await button(scene.page, "End Call").click();
			await expect(scene.page.getByText("Leave meeting?")).toBeVisible();
		},
		async LEAVE_CONFIRMED(scene) {
			await button(scene.page, "Leave meeting").click();
			await expect(scene.page.getByRole("button", { name: "Instant meet" })).toBeVisible({ timeout: 20_000 });
		},
		async OTHER_DEVICE(scene) {
			const other = await hostElsewhere(scene);
			elsewhere.set(scene, other);
			await openLink(scene, other, meetingId.get(scene));
			await button(other, "Switch here").click();
			await waitInCall(other);
			await expect(scene.page.getByText("Meeting moved to another device")).toBeVisible({ timeout: 20_000 });
		},
		async GO_OFFLINE(scene) {
			await scene.context.setOffline(true);
			await expect(scene.page.getByRole("img", { name: /Your internet connection is unstable/ })).toBeVisible({ timeout: 30_000 });
			// Long enough for Leo's video to stop arriving.
			await scene.page.waitForTimeout(15_000);
		},
		async OPEN_PEOPLE(scene) {
			await button(scene.page, "Show Participants").click();
			await expect(scene.page.getByPlaceholder("Search people")).toBeVisible();
		},
		async PARTICIPANT_MENU(scene) {
			await button(scene.page, "Actions for Leo Park").click();
			await expect(scene.page.getByRole("menuitem", { name: "Remove" })).toBeVisible();
		},
		async REMOVE(scene) {
			await scene.page.getByRole("menuitem", { name: "Remove" }).click();
			await expect(scene.page.getByRole("dialog", { name: "Remove Participant" })).toBeVisible();
		},
		async CONFIRM_REMOVE(scene) {
			await scene.page.getByRole("dialog", { name: "Remove Participant" }).getByRole("button", { name: "Remove" }).click();
			await expect(leo.get(scene).getByText("You have been removed from the meeting by the host")).toBeVisible({ timeout: 20_000 });
		},
		async LEO_WRITES(scene) {
			const page = leo.get(scene);
			await button(page, "Show Chat").click();
			await page.getByPlaceholder("Type a message").fill("Morning! I'll share the Q3 numbers in a minute.");
			await page.keyboard.press("Enter");
			await expect(scene.page.getByText(/Morning! I'll share the Q3/)).toBeVisible({ timeout: 20_000 });
		},
		async LEO_SHARES(scene) {
			await button(leo.get(scene), "Toggle Screen Share").click();
			await expect(scene.page.getByText("Leo Park's screen")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_CHAT_PHONE(scene) {
			await moreItem(scene.page, "Chat");
			await expect(scene.page.getByPlaceholder("Type a message")).toBeVisible();
		},
	},
	frame(scene, state) {
		const page = FRAMED[state]?.(scene);
		return page ? page.locator("body") : null;
	},
});
