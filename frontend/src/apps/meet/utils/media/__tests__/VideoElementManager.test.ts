import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoElementManager } from "../VideoElementManager";

type StreamCtor = new (tracks: MediaStreamTrack[]) => MediaStream;

const globalAny = globalThis as unknown as { MediaStream?: StreamCtor };

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
		globalAny.MediaStream = MockMediaStream as unknown as StreamCtor;
	}
});

function makeTrack(id: string): MediaStreamTrack {
	return {
		id,
		kind: "video",
		stop: vi.fn(),
	} as unknown as MediaStreamTrack;
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
