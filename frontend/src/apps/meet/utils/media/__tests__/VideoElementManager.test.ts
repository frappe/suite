import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoElementManager } from "../VideoElementManager";

type StreamCtor = new (tracks: MediaStreamTrack[]) => MediaStream;

const globalAny = globalThis as typeof globalThis & { MediaStream?: StreamCtor };

beforeEach(() => {
	if (globalAny.MediaStream === undefined) {
		class MockMediaStream {
			tracks: MediaStreamTrack[];
			id: string;
			constructor(tracks: MediaStreamTrack[] = []) {
				this.tracks = tracks;
				this.id = `mock-${Math.random().toString(36).slice(2)}`;
			}
			getVideoTracks() {
				return this.tracks.filter((t) => t.kind === "video");
			}
			getAudioTracks() {
				return this.tracks.filter((t) => t.kind === "audio");
			}
			getTracks() {
				return this.tracks;
			}
		}
		Reflect.set(globalAny, "MediaStream", MockMediaStream);
	}
});

function makeTrack(id: string): MediaStreamTrack {
	return Object.assign(Object.create(null), {
		id,
		kind: "video",
		stop: vi.fn(),
	}) as MediaStreamTrack;
}

function makeAudioTrack(id: string): MediaStreamTrack {
	return { ...makeTrack(id), kind: "audio" } as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[]): MediaStream {
	const Ctor = globalAny.MediaStream as StreamCtor;
	return new Ctor(tracks);
}

function makeVideoElement(): HTMLVideoElement {
	const el = document.createElement("video");
	el.play = vi.fn().mockResolvedValue(undefined) as never;
	return el;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("VideoElementManager.attachStream stale re-attach", () => {
	let manager: VideoElementManager;

	beforeEach(() => {
		manager = new VideoElementManager();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-attaches a new track with a different id", async () => {
		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		const track1 = makeTrack("track-1");
		await manager.attachStream("p1", makeStream([track1]), false);
		expect((el.srcObject as MediaStream).getVideoTracks()[0].id).toBe(
			"track-1",
		);

		const track2 = makeTrack("track-2");
		await manager.attachStream("p1", makeStream([track2]), false);
		expect((el.srcObject as MediaStream).getVideoTracks()[0].id).toBe(
			"track-2",
		);
	});

	it("strict mode waits for a delayed video tile to mount and play", async () => {
		manager = new VideoElementManager(1000);
		const attached = manager.attachStream("p1", makeStream([makeTrack("track-1")]), false);
		let settled = false;
		void attached.then(() => settled = true);
		await Promise.resolve();
		expect(settled).toBe(false);

		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		await attached;
		expect(el.srcObject).not.toBeNull();
		expect(el.play).toHaveBeenCalledOnce();
	});

	it("strict mode rejects when delayed video playback fails", async () => {
		manager = new VideoElementManager(1000);
		const attached = manager.attachStream("p1", makeStream([makeTrack("track-1")]), false);
		const el = makeVideoElement();
		el.play = vi.fn().mockRejectedValue(new Error("decoder failed"));
		manager.registerVideoElement("p1", el);
		await expect(attached).rejects.toThrow("decoder failed");
	});

	it("strict mode times out while waiting for a video tile", async () => {
		vi.useFakeTimers();
		manager = new VideoElementManager(100);
		const attached = manager.attachStream("p1", makeStream([makeTrack("track-1")]), false);
		const rejected = expect(attached).rejects.toThrow("Timed out waiting for video element");
		await vi.advanceTimersByTimeAsync(100);
		await rejected;
	});

	it("settles a strict deferred attachment when its participant is removed", async () => {
		vi.useFakeTimers();
		manager = new VideoElementManager(100);
		const attached = manager.attachStream(
			"p1",
			makeStream([makeTrack("track-1")]),
			false,
		);

		manager.removeVideoElement("p1");

		await expect(attached).resolves.toBeUndefined();
		expect(manager.deferredAttachments.size).toBe(0);
		await vi.advanceTimersByTimeAsync(100);
	});

	it("settles an obsolete strict attachment when a replacement arrives", async () => {
		manager = new VideoElementManager(1000);
		const obsolete = manager.attachStream(
			"p1",
			makeStream([makeTrack("track-old")]),
			false,
		);
		const current = manager.attachStream(
			"p1",
			makeStream([makeTrack("track-current")]),
			false,
		);

		await expect(obsolete).resolves.toBeUndefined();
		const element = makeVideoElement();
		manager.registerVideoElement("p1", element);
		await current;
		expect((element.srcObject as MediaStream).getVideoTracks()[0]?.id).toBe(
			"track-current",
		);
	});

	it("attaches audio and surfaces autoplay failure", async () => {
		manager = new VideoElementManager(1000);
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(new Error("blocked"));
		const track = { ...makeTrack("audio-1"), kind: "audio" } as MediaStreamTrack;
		await expect(manager.attachStream("p1", makeStream([track]), false)).rejects.toThrow("blocked");
		expect(manager.audioElements.get("p1")?.srcObject).not.toBeNull();
		play.mockRestore();
	});

	it("retries blocked audio after user interaction outside strict mode", async () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, "play")
			.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
			.mockResolvedValue(undefined);
		const track = { ...makeTrack("audio-1"), kind: "audio" } as MediaStreamTrack;

		await expect(manager.attachStream("p1", makeStream([track]), false)).resolves.toBeUndefined();
		document.dispatchEvent(new Event("click"));
		await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
		play.mockRestore();
	});

	it("deduplicates and removes pending playback interaction handlers", async () => {
		const element = makeVideoElement();
		element.play = vi.fn().mockRejectedValue(new Error("still blocked"));
		manager.addUserInteractionHandler(element, "p1");
		manager.addUserInteractionHandler(element, "p1");

		document.dispatchEvent(new Event("click"));
		await vi.waitFor(() => expect(element.play).toHaveBeenCalledOnce());

		manager.registerVideoElement("p1", element);
		manager.removeVideoElement("p1");
		document.dispatchEvent(new Event("click"));
		await Promise.resolve();
		expect(element.play).toHaveBeenCalledOnce();
	});

	it("skips re-attach when track id is unchanged", async () => {
		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		const track1 = makeTrack("track-1");
		await manager.attachStream("p1", makeStream([track1]), false);
		const originalSrc = el.srcObject;

		await manager.attachStream("p1", makeStream([track1]), false);
		expect(el.srcObject).toBe(originalSrc);
	});

	it("re-attaches when the last attach is older than the stale threshold", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_000_000));

		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		const track1 = makeTrack("track-1");
		await manager.attachStream("p1", makeStream([track1]), false);
		const originalSrc = el.srcObject;

		vi.setSystemTime(new Date(1_000_000 + 70_000));

		await manager.attachStream("p1", makeStream([track1]), false);
		expect(el.srcObject).not.toBe(originalSrc);
		expect((el.srcObject as MediaStream).getVideoTracks()[0].id).toBe(
			"track-1",
		);
	});

	it("clears the attach timestamp when the element is removed", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_000_000));

		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		await manager.attachStream("p1", makeStream([makeTrack("t1")]), false);

		manager.removeVideoElement("p1");

		const el2 = makeVideoElement();
		manager.registerVideoElement("p1", el2);
		await manager.attachStream("p1", makeStream([makeTrack("t1")]), false);
		expect((el2.srcObject as MediaStream).getVideoTracks()[0].id).toBe("t1");
	});

	it("retries playback for attached video and audio after resume", async () => {
		const video = makeVideoElement();
		video.srcObject = makeStream([makeTrack("video-1")]);
		manager.registerVideoElement("p1", video);
		const audio = document.createElement("audio");
		audio.srcObject = makeStream([
			{ ...makeTrack("audio-1"), kind: "audio" } as MediaStreamTrack,
		]);
		audio.play = vi.fn().mockResolvedValue(undefined);
		manager.audioElements.set("p1", audio);

		await manager.retryPlayback();

		expect(video.play).toHaveBeenCalledOnce();
		expect(audio.play).toHaveBeenCalledOnce();
	});
});

describe("VideoElementManager.attachAudioStream stale re-attach", () => {
	let manager: VideoElementManager;

	beforeEach(() => {
		manager = new VideoElementManager();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-attaches audio when the last attach is older than the stale threshold", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_000_000));

		const createElementSpy = vi
			.spyOn(document, "createElement")
			.mockImplementation(((tag: string) => {
				const el = document.createElementNS
					? document.createElementNS("http://www.w3.org/1999/xhtml", tag)
					: ({} as HTMLElement);
				Object.defineProperty(el, "play", {
					value: vi.fn().mockResolvedValue(undefined),
					writable: true,
				});
				return el as HTMLElement;
			}) as never);

		const track = { id: "a1", kind: "audio" } as MediaStreamTrack;
		manager.attachAudioStream("p1", [track]);
		const audioEl = manager.audioElements.get("p1");
		expect(audioEl).toBeDefined();
		const originalSrc = audioEl?.srcObject;

		vi.setSystemTime(new Date(1_000_000 + 70_000));

		manager.attachAudioStream("p1", [track]);
		expect(audioEl?.srcObject).not.toBe(originalSrc);

		createElementSpy.mockRestore();
	});
});

describe("VideoElementManager role-aware attachments", () => {
	let manager: VideoElementManager;
	let mediaPlay: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		manager = new VideoElementManager();
		mediaPlay = vi
			.spyOn(HTMLMediaElement.prototype, "play")
			.mockResolvedValue(undefined);
	});

	afterEach(() => {
		manager.cleanup();
		mediaPlay.mockRestore();
	});

	it("attaches and configures a borrowed local preview", async () => {
		const track = makeTrack("camera");
		const element = makeVideoElement();

		manager.registerLocalPreview(element);
		await manager.attachLocalPreview(makeStream([track]));

		expect(element.autoplay).toBe(true);
		expect(element.muted).toBe(true);
		expect(element.playsInline).toBe(true);
		expect(element.play).toHaveBeenCalledOnce();
		manager.registerLocalPreview(null);
		expect(element.srcObject).toBeNull();
		expect(track.stop).not.toHaveBeenCalled();
	});

	it("moves a local preview to a replacement element without stopping capture", async () => {
		const track = makeTrack("camera");
		const first = makeVideoElement();
		const second = makeVideoElement();
		manager.registerLocalPreview(first);
		await manager.attachLocalPreview(makeStream([track]));

		manager.registerLocalPreview(second);
		await vi.waitFor(() => expect(second.srcObject).not.toBeNull());

		expect(first.srcObject).toBeNull();
		expect(track.stop).not.toHaveBeenCalled();
	});

	it("preserves remote media across Vue element unmount and replacement", async () => {
		const track = makeTrack("remote-camera");
		const first = makeVideoElement();
		const replacement = makeVideoElement();
		manager.registerRemoteVideoElement("p1", first);
		await manager.attachStream("p1", makeStream([track]));

		manager.registerRemoteVideoElement("p1", null);
		manager.registerRemoteVideoElement("p1", replacement);
		await vi.waitFor(() => expect(replacement.srcObject).not.toBeNull());

		expect(first.srcObject).toBeNull();
		expect(track.stop).not.toHaveBeenCalled();
	});

	it("cleans remote attachments on manager replacement without detaching local preview", async () => {
		const localTrack = makeTrack("local-camera");
		const remoteTrack = makeTrack("remote-camera");
		const local = makeVideoElement();
		const remote = makeVideoElement();
		manager.registerLocalPreview(local);
		manager.registerRemoteVideoElement("p1", remote);
		await manager.attachLocalPreview(makeStream([localTrack]));
		await manager.attachStream("p1", makeStream([remoteTrack]));

		manager.cleanupRemoteMedia();

		expect(local.srcObject).not.toBeNull();
		expect(remote.srcObject).toBeNull();
		expect(localTrack.stop).not.toHaveBeenCalled();
		expect(remoteTrack.stop).toHaveBeenCalledOnce();
	});

	it("retains an owned remote track across fresh stream wrappers", async () => {
		manager = new VideoElementManager(1000);
		const track = makeTrack("remote-camera");
		manager.registerRemoteVideoElement("p1", makeVideoElement());

		await manager.attachStream("p1", makeStream([track]));
		await manager.attachStream("p1", makeStream([track]));
		await manager.attachStream("p1", makeStream([track]));

		expect(track.stop).not.toHaveBeenCalled();
		manager.removeVideoElement("p1");
		expect(track.stop).toHaveBeenCalledOnce();
	});

	it("stops only replaced owned remote tracks", async () => {
		const retained = makeTrack("retained");
		const replaced = makeTrack("replaced");
		const replacement = makeTrack("replacement");
		manager.registerRemoteVideoElement("p1", makeVideoElement());
		await manager.attachStream("p1", makeStream([retained, replaced]));

		await manager.attachStream("p1", makeStream([retained, replacement]));

		expect(retained.stop).not.toHaveBeenCalled();
		expect(replaced.stop).toHaveBeenCalledOnce();
		expect(replacement.stop).not.toHaveBeenCalled();
	});

	it("uses a stable track id fallback when wrappers expose equivalent tracks", async () => {
		const previous = makeTrack("stable-track");
		const equivalent = makeTrack("stable-track");
		manager.registerRemoteVideoElement("p1", makeVideoElement());
		await manager.attachStream("p1", makeStream([previous]));

		await manager.attachStream("p1", makeStream([equivalent]));

		expect(previous.stop).not.toHaveBeenCalled();
	});

	it("keeps local screen capture alive but stops owned remote screen tracks", async () => {
		const localTrack = makeTrack("local-screen");
		const remoteTrack = makeTrack("remote-screen");
		manager.registerScreenSharePreview("local-screen", makeVideoElement());
		manager.registerScreenSharePreview("remote-screen", makeVideoElement());
		await manager.attachScreenSharePreview(
			"local-screen",
			makeStream([localTrack]),
			"borrowed",
		);
		await manager.attachScreenSharePreview(
			"remote-screen",
			makeStream([remoteTrack]),
			"owned",
		);

		manager.removeScreenSharePreview("local-screen");
		manager.removeScreenSharePreview("remote-screen");

		expect(localTrack.stop).not.toHaveBeenCalled();
		expect(remoteTrack.stop).toHaveBeenCalledOnce();
	});

	it("preserves owned screen attachment semantics when its element registers later", async () => {
		const removedTrack = makeTrack("removed-screen");
		await manager.attachScreenSharePreview(
			"consumer-1",
			makeStream([removedTrack]),
			"owned",
		);
		manager.registerScreenSharePreview("consumer-1", makeVideoElement());
		manager.registerScreenSharePreview("consumer-1", null);
		manager.removeScreenSharePreview("consumer-1");
		expect(removedTrack.stop).toHaveBeenCalledOnce();

		const cleanupTrack = makeTrack("cleanup-screen");
		await manager.attachScreenSharePreview(
			"consumer-2",
			makeStream([cleanupTrack]),
			"owned",
		);
		manager.registerScreenSharePreview("consumer-2", makeVideoElement());
		manager.registerScreenSharePreview("consumer-2", null);
		manager.cleanupRemoteMedia();
		expect(cleanupTrack.stop).toHaveBeenCalledOnce();
	});

	it("ignores delayed playback failure from a superseded stream", async () => {
		const firstPlay = deferred<void>();
		const element = makeVideoElement();
		element.play = vi
			.fn()
			.mockReturnValueOnce(firstPlay.promise)
			.mockResolvedValue(undefined);
		manager.registerLocalPreview(element);
		const firstAttach = manager.attachLocalPreview(makeStream([makeTrack("first")]));
		await Promise.resolve();

		await manager.attachLocalPreview(makeStream([makeTrack("second")]));
		firstPlay.reject(new DOMException("blocked", "NotAllowedError"));
		await firstAttach;
		document.dispatchEvent(new Event("click"));
		await Promise.resolve();

		expect(element.play).toHaveBeenCalledTimes(2);
	});

	it("ignores delayed playback success from a superseded stream", async () => {
		const firstPlay = deferred<void>();
		const element = makeVideoElement();
		element.play = vi
			.fn()
			.mockReturnValueOnce(firstPlay.promise)
			.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
			.mockResolvedValue(undefined);
		manager.registerLocalPreview(element);
		const firstAttach = manager.attachLocalPreview(makeStream([makeTrack("first")]));
		await Promise.resolve();

		await manager.attachLocalPreview(makeStream([makeTrack("second")]));
		firstPlay.resolve();
		await firstAttach;
		document.dispatchEvent(new Event("click"));
		await vi.waitFor(() => expect(element.play).toHaveBeenCalledTimes(3));
	});

	it("retries NotAllowedError playback on user interaction for local preview", async () => {
		const element = makeVideoElement();
		element.play = vi
			.fn()
			.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
			.mockResolvedValue(undefined);
		manager.registerLocalPreview(element);
		await manager.attachLocalPreview(makeStream([makeTrack("camera")]));

		document.dispatchEvent(new Event("click"));

		await vi.waitFor(() => expect(element.play).toHaveBeenCalledTimes(2));
	});

	it("retries playback across remote, local, screen, and background roles", async () => {
		const remote = makeVideoElement();
		const local = makeVideoElement();
		const screen = makeVideoElement();
		const background = makeVideoElement();
		manager.registerRemoteVideoElement("p1", remote);
		manager.registerLocalPreview(local);
		manager.registerScreenSharePreview("screen", screen);
		await manager.attachStream("p1", makeStream([makeTrack("remote")]), false);
		await manager.attachLocalPreview(makeStream([makeTrack("local")]));
		await manager.attachScreenSharePreview(
			"screen",
			makeStream([makeTrack("screen")]),
		);
		await manager.attachBackgroundEffectsSource(
			"effects",
			background,
			makeStream([makeTrack("effects")]),
		);
		const audio = manager.audioElements.get("p1");
		await manager.attachStream("p1", makeStream([makeAudioTrack("audio")]), false);
		for (const element of [remote, local, screen, background]) {
			vi.mocked(element.play).mockClear();
		}
		const remoteAudio = manager.audioElements.get("p1") ?? audio;
		if (remoteAudio) remoteAudio.play = vi.fn().mockResolvedValue(undefined);

		await manager.retryPlayback();

		for (const element of [remote, local, screen, background]) {
			expect(element.play).toHaveBeenCalledOnce();
		}
		expect(remoteAudio?.play).toHaveBeenCalledOnce();
	});

	it("applies the selected sink to existing and future remote audio elements", async () => {
		const previousDescriptor = Object.getOwnPropertyDescriptor(
			HTMLMediaElement.prototype,
			"setSinkId",
		);
		const setSinkId = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
			configurable: true,
			value: setSinkId,
		});
		await manager.attachAudioStream("p1", [makeAudioTrack("audio-1")]);
		setSinkId.mockClear();
		await manager.setAudioOutputDevice("speaker-1");
		await manager.attachAudioStream("p2", [makeAudioTrack("audio-2")]);

		expect(setSinkId).toHaveBeenCalledTimes(2);
		expect(setSinkId).toHaveBeenNthCalledWith(1, "speaker-1");
		expect(setSinkId).toHaveBeenNthCalledWith(2, "speaker-1");
		if (previousDescriptor) {
			Object.defineProperty(
				HTMLMediaElement.prototype,
				"setSinkId",
				previousDescriptor,
			);
		} else {
			Reflect.deleteProperty(HTMLMediaElement.prototype, "setSinkId");
		}
	});
});
