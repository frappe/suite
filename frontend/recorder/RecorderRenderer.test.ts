import { createApp, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import RecorderRenderer from "./RecorderRenderer.vue";

window.matchMedia = vi.fn((query: string) => ({ matches: Number(query.match(/\d+/)?.[0] || 0) <= window.innerWidth, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) as never;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as never;

describe("RecorderRenderer", () => {
	const meetingContext = () => ({
		participantStore: { participants: { alice: { user_id: "alice", user_name: "Alice", avatar: null, initials: "A", audio_enabled: false, video_enabled: false } }, activeSpeakerIds: [], stableSpeakerIds: [], getParticipantName: (id: string) => id },
		mediaState: { activeScreenShareConsumers: [], screenShareStreams: {}, isCameraOn: false, isMicOn: false, remoteAudioStreams: {} },
		currentUser: { currentUser: ref({ user_id: "recorder", name: "Recorder" }) },
		gridLayout: { pinnedTiles: ref([]), displayScreenShares: ref([]), pinTile: vi.fn(), unpinTile: vi.fn() },
		raiseHandStore: { raisedHands: {} }, reactionStore: { reactions: {} }, networkQuality: ref("good"),
	});

	it("renders chat fields as text rather than executable markup", () => {
		const root = document.createElement("div");
		const app = createApp(RecorderRenderer, {
			startedAt: Date.now(),
			messages: [{ id: "1", author: "<img src=x>", text: "<script>window.pwned=true</script>" }],
			videoManager: { registerVideoElement: vi.fn(), removeVideoElement: vi.fn() },
			meetingContext: meetingContext(),
		});
		app.mount(root);

		expect(root.querySelector("img")).toBeNull();
		expect(root.querySelector("script")).toBeNull();
		expect(root.textContent).toContain("<script>window.pwned=true</script>");
		app.unmount();
	});

	it("renders public chat with the meeting toast treatment", () => {
		const context = meetingContext();
		context.participantStore.participants.alice.avatar =
			"https://frappe.test/files/alice.png";
		const root = document.createElement("div");
		const app = createApp(RecorderRenderer, {
			startedAt: Date.now(),
			messages: [
				{
					id: "1",
					author: "Alice",
					text: "Hello from the meeting",
					avatar: "https://frappe.test/files/alice.png",
				},
			],
			videoManager: {
				registerVideoElement: vi.fn(),
				removeVideoElement: vi.fn(),
			},
			meetingContext: context,
		});
		app.mount(root);

		const toast = root.querySelector(".chat-toast");
		expect(toast?.classList).toContain("bg-surface-gray-9");
		expect(toast?.firstElementChild?.classList).toContain("w-full");
		expect(toast?.textContent).toContain("Alice");
		expect(toast?.textContent).toContain("Hello from the meeting");
		expect(toast?.querySelector('img[alt="Alice"]')?.getAttribute("src")).toBe(
			"https://frappe.test/files/alice.png",
		);
		expect(toast?.querySelector("span span")?.classList).not.toContain("truncate");
		expect(toast?.querySelector("span span")?.classList).toContain(
			"whitespace-pre-wrap",
		);
		expect(toast?.querySelector("button")).toBeNull();
		app.unmount();
	});

	it("uses the real MeetingLayout at 1920x1080 without a recorder reservation or controls", () => {
		Object.defineProperties(window, { innerWidth: { configurable: true, value: 1920 }, innerHeight: { configurable: true, value: 1080 } });
		const root = document.createElement("div");
		root.style.cssText = "width:1920px;height:1080px";
		const app = createApp(RecorderRenderer, { startedAt: Date.now(), videoManager: { registerVideoElement: vi.fn(), removeVideoElement: vi.fn() }, meetingContext: meetingContext() });
		app.mount(root);
		expect(root.querySelector('[data-testid="meeting-layout"]')).not.toBeNull();
		expect(root.querySelector('[data-testid="participant-tile-recorder"]')).toBeNull();
		expect(root.querySelectorAll('[data-testid^="participant-tile-"]')).toHaveLength(1);
		expect(root.querySelector("button")).toBeNull();
		expect((root.querySelector('[data-testid="participant-tile-alice"]') as HTMLElement).style.width).toContain("100%");
		expect(root.textContent).toContain("A");
		app.unmount();
	});

	it("renders the camera-off participant avatar image", () => {
		const context = meetingContext();
		context.participantStore.participants.alice.avatar =
			"https://frappe.test/files/alice.png";
		const root = document.createElement("div");
		const app = createApp(RecorderRenderer, {
			startedAt: Date.now(),
			videoManager: {
				registerVideoElement: vi.fn(),
				removeVideoElement: vi.fn(),
			},
			meetingContext: context,
		});
		app.mount(root);

		expect(root.querySelector('img[alt="Alice"]')?.getAttribute("src")).toBe(
			"https://frappe.test/files/alice.png",
		);
		app.unmount();
	});

	it("rings the active speaker tile", () => {
		const context = meetingContext();
		context.participantStore.activeSpeakerIds = ["alice"];
		const root = document.createElement("div");
		const app = createApp(RecorderRenderer, {
			startedAt: Date.now(),
			videoManager: {
				registerVideoElement: vi.fn(),
				removeVideoElement: vi.fn(),
			},
			meetingContext: context,
		});
		app.mount(root);

		const tile = root.querySelector('[data-testid="participant-tile-alice"]');
		expect(tile?.getAttribute("data-active-speaker")).toBe("true");
		app.unmount();
	});

	it("attaches each screen-share tile to its own consumer stream", async () => {
		const context = meetingContext();
		context.gridLayout.displayScreenShares.value = [
			{ participantId: "alice", consumerId: "screen-1" },
			{ participantId: "bob", consumerId: "screen-2" },
		] as never;
		context.mediaState.activeScreenShareConsumers = [
			{ participantId: "alice", consumerId: "screen-1", startedAt: 2 },
			{ participantId: "bob", consumerId: "screen-2", startedAt: 1 },
		] as never;
		const first = {} as MediaStream;
		const second = {} as MediaStream;
		context.mediaState.screenShareStreams = { "screen-1": first, "screen-2": second };
		const attached = vi.fn();
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
		const root = document.createElement("div");
		const app = createApp(RecorderRenderer, {
			startedAt: Date.now(),
			videoManager: { registerVideoElement: vi.fn(), removeVideoElement: vi.fn() },
			meetingContext: context,
			onScreenAttachment: attached,
		});
		app.mount(root);

		await vi.waitFor(() => expect(attached).toHaveBeenCalledTimes(2));
		const videos = [...root.querySelectorAll("video")];
		expect(videos.map((video) => video.srcObject).filter(Boolean)).toEqual([
			first,
			second,
		]);
		expect(attached.mock.calls.map(([consumerId]) => consumerId)).toEqual([
			"screen-1",
			"screen-2",
		]);
		play.mockRestore();
		app.unmount();
	});

	it("reports screen attachment play failures", async () => {
		const context = meetingContext();
		context.gridLayout.displayScreenShares.value = [{ participantId: "alice", consumerId: "screen-1" }] as never;
		context.mediaState.activeScreenShareConsumers = [{ participantId: "alice", consumerId: "screen-1", startedAt: 1 }] as never;
		context.mediaState.screenShareStreams = { "screen-1": {} } as never;
		const failure = vi.fn();
		const attachmentFailure = vi.fn();
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("decoder failed"));
		const root = document.createElement("div");
		const app = createApp(RecorderRenderer, {
			startedAt: Date.now(),
			videoManager: { registerVideoElement: vi.fn(), removeVideoElement: vi.fn() },
			meetingContext: context,
			onPlaybackFailure: failure,
			onScreenAttachment: (_consumerId: string, attachment: Promise<void>) =>
				attachment.catch(attachmentFailure),
		});
		app.mount(root);
		await vi.waitFor(() => expect(failure).toHaveBeenCalledWith("Screen playback failed: decoder failed"));
		expect(attachmentFailure).toHaveBeenCalledWith(new Error("decoder failed"));
		play.mockRestore();
		app.unmount();
	});

	it("retries screen playback when a new media load interrupts play", async () => {
		const context = meetingContext();
		context.gridLayout.displayScreenShares.value = [{ participantId: "alice", consumerId: "screen-1" }] as never;
		context.mediaState.activeScreenShareConsumers = [{ participantId: "alice", consumerId: "screen-1", startedAt: 1 }] as never;
		context.mediaState.screenShareStreams = { "screen-1": {} } as never;
		const failure = vi.fn();
		const attached = vi.fn();
		const play = vi.spyOn(HTMLMediaElement.prototype, "play")
			.mockRejectedValueOnce(new DOMException("superseded", "AbortError"))
			.mockResolvedValue(undefined);
		const root = document.createElement("div");
		const app = createApp(RecorderRenderer, {
			startedAt: Date.now(),
			videoManager: { registerVideoElement: vi.fn(), removeVideoElement: vi.fn() },
			meetingContext: context,
			onPlaybackFailure: failure,
			onScreenAttachment: (_consumerId: string, attachment: Promise<void>) => attachment.then(attached),
		});
		app.mount(root);

		await vi.waitFor(() => expect(attached).toHaveBeenCalledOnce());
		expect(play).toHaveBeenCalledTimes(2);
		expect(failure).not.toHaveBeenCalled();
		play.mockRestore();
		app.unmount();
	});
});
