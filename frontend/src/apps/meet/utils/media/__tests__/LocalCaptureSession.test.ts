import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	LocalCaptureSession,
	mergeReacquiredMedia,
	type LocalCaptureSessionOptions,
} from "../LocalCaptureSession";

class FakeMediaStream {
	private tracks: MediaStreamTrack[];

	constructor(tracks: MediaStreamTrack[] = []) {
		this.tracks = [...tracks];
	}

	getTracks() {
		return [...this.tracks];
	}

	getAudioTracks() {
		return this.tracks.filter((track) => track.kind === "audio");
	}

	getVideoTracks() {
		return this.tracks.filter((track) => track.kind === "video");
	}

	addTrack(track: MediaStreamTrack) {
		this.tracks.push(track);
	}

	removeTrack(track: MediaStreamTrack) {
		this.tracks = this.tracks.filter((candidate) => candidate !== track);
	}
}

function track(id: string, kind: "audio" | "video") {
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	const value = Object.assign(Object.create(null), {
		id,
		kind,
		enabled: true,
		readyState: "live",
		stop: vi.fn(() => {
			value.readyState = "ended";
		}),
		addEventListener: vi.fn(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				const handlers = listeners.get(type) ?? new Set();
				handlers.add(listener);
				listeners.set(type, handlers);
			},
		),
		removeEventListener: vi.fn(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				listeners.get(type)?.delete(listener);
			},
		),
		dispatchEvent: vi.fn((event: Event) => {
			for (const listener of listeners.get(event.type) ?? []) {
				if (typeof listener === "function") listener.call(value, event);
				else listener.handleEvent(event);
			}
			return true;
		}),
	}) as MediaStreamTrack;
	return value;
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

function createHarness(overrides: Partial<LocalCaptureSessionOptions> = {}) {
	let localStream: MediaStream | null = null;
	let publicationOwner: object | null = {};
	const selections = { camera: "", microphone: "" };
	const capture = vi.fn<LocalCaptureSessionOptions["capture"]>();
	const reconcileCamera = vi.fn().mockResolvedValue(undefined);
	const reconcileMicrophone = vi.fn().mockResolvedValue(undefined);
	const publish = vi.fn<LocalCaptureSessionOptions["publication"]["publish"]>(
		async (_stream, publicationOptions) => ({
			...(publicationOptions.publishVideo
				? { video: { status: "published" as const } }
				: {}),
			...(publicationOptions.publishAudio
				? { audio: { status: "published" as const } }
				: {}),
		}),
	);
	const options: LocalCaptureSessionOptions = {
		capture,
		devices: {
			enumerateDevices: vi.fn().mockResolvedValue(undefined),
			isDeviceAvailable: vi.fn(() => true),
			getDefaultDevice: vi.fn(() => null),
			findDeviceById: vi.fn(() => undefined),
		},
		publication: {
			getOwner: () => publicationOwner,
			reconcileCamera,
			reconcileMicrophone,
			publish,
		},
		getLocalStream: () => localStream,
		setLocalStream: (stream) => {
			localStream = stream;
		},
		isCameraEnabled: () => true,
		isMicrophoneEnabled: () => true,
		setPermissionGranted: vi.fn(),
		applyCameraEffects: vi.fn().mockResolvedValue(undefined),
		cleanupCameraEffects: vi.fn(),
		prepareMicrophone: async (stream) => {
			const microphone = stream.getAudioTracks()[0];
			return microphone
				? { track: microphone, commit: vi.fn(), discard: vi.fn() }
				: null;
		},
		cleanupMicrophoneEffects: vi.fn(),
		getEffectiveCameraTrack: () =>
			localStream
				?.getVideoTracks()
				.find((item) => item.readyState === "live") ?? null,
		getEffectiveMicrophoneTrack: () =>
			localStream
				?.getAudioTracks()
				.find((item) => item.readyState === "live") ?? null,
		onCameraDisabled: vi.fn(),
		onMicrophoneDisabled: vi.fn(),
		getSelectedDeviceId: (type) => selections[type],
		setSelectedDeviceId: (type, deviceId) => {
			selections[type] = deviceId;
		},
		getCameraConstraints: () => ({ width: { ideal: 1280 } }),
		...overrides,
	};
	const session = new LocalCaptureSession(options);
	return {
		capture,
		options,
		publish,
		reconcileCamera,
		reconcileMicrophone,
		selections,
		session,
		setLocalStream: (stream: MediaStream | null) => {
			localStream = stream;
			session.observeLocalTracks();
		},
		replacePublicationOwner: () => {
			publicationOwner = {};
		},
	};
}

describe("LocalCaptureSession", () => {
	beforeEach(() => {
		vi.stubGlobal("MediaStream", FakeMediaStream);
	});

	it("stops a stale getUserMedia completion exactly once after disposal", async () => {
		const request = deferred<MediaStream>();
		const lateCamera = track("late-camera", "video");
		const harness = createHarness({ capture: vi.fn(() => request.promise) });

		const acquisition = harness.session.acquireUserMedia(true, false);
		await vi.waitFor(() =>
			expect(harness.options.capture).toHaveBeenCalledOnce(),
		);
		await harness.session.dispose(async () => {});
		await expect(acquisition).rejects.toMatchObject({ name: "AbortError" });
		request.resolve(new FakeMediaStream([lateCamera]) as never);

		await vi.waitFor(() => expect(lateCamera.stop).toHaveBeenCalledOnce());
		expect(harness.reconcileCamera).not.toHaveBeenCalled();
	});

	it("serializes rapid camera transitions while microphone work stays independent", async () => {
		const firstCamera = deferred<void>();
		const events: string[] = [];
		const harness = createHarness();
		const cameraOne = harness.session.runCameraTransition(async () => {
			events.push("camera-one-start");
			await firstCamera.promise;
			events.push("camera-one-end");
		});
		const cameraTwo = harness.session.runCameraTransition(async () => {
			events.push("camera-two");
		});
		const microphone = harness.session.runMicrophoneTransition(async () => {
			events.push("microphone");
		});

		await microphone;
		expect(events).toEqual(["camera-one-start", "microphone"]);
		firstCamera.resolve();
		await Promise.all([cameraOne, cameraTwo]);
		expect(events).toEqual([
			"camera-one-start",
			"microphone",
			"camera-one-end",
			"camera-two",
		]);
	});

	it("serializes rapid camera device acquisitions in requested order", async () => {
		const firstRequest = deferred<MediaStream>();
		const initialTrack = track("initial-camera", "video");
		const firstTrack = track("first-camera", "video");
		const secondTrack = track("second-camera", "video");
		const capture = vi
			.fn()
			.mockReturnValueOnce(firstRequest.promise)
			.mockResolvedValueOnce(new FakeMediaStream([secondTrack]));
		const harness = createHarness({ capture });
		harness.setLocalStream(new FakeMediaStream([initialTrack]) as never);

		const first = harness.session.switchCamera("camera-one");
		const second = harness.session.switchCamera("camera-two");
		await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
		firstRequest.resolve(new FakeMediaStream([firstTrack]) as never);
		await Promise.all([first, second]);

		expect(capture).toHaveBeenCalledTimes(2);
		expect(
			(capture.mock.calls[0][0].video as MediaTrackConstraints).deviceId,
		).toEqual({ exact: "camera-one" });
		expect(
			(capture.mock.calls[1][0].video as MediaTrackConstraints).deviceId,
		).toEqual({ exact: "camera-two" });
		expect(initialTrack.stop).toHaveBeenCalledOnce();
		expect(firstTrack.stop).toHaveBeenCalledOnce();
		expect(secondTrack.stop).not.toHaveBeenCalled();
		expect(harness.selections.camera).toBe("camera-two");
	});

	it("drops a camera switch when its publication manager is replaced", async () => {
		const request = deferred<MediaStream>();
		const initialTrack = track("initial-camera", "video");
		const staleTrack = track("stale-camera", "video");
		const harness = createHarness({ capture: vi.fn(() => request.promise) });
		harness.setLocalStream(new FakeMediaStream([initialTrack]) as never);

		const switching = harness.session.switchCamera("next-camera");
		await vi.waitFor(() =>
			expect(harness.options.capture).toHaveBeenCalledOnce(),
		);
		harness.replacePublicationOwner();
		request.resolve(new FakeMediaStream([staleTrack]) as never);
		await switching;

		expect(staleTrack.stop).toHaveBeenCalledOnce();
		expect(initialTrack.stop).not.toHaveBeenCalled();
		expect(harness.selections.camera).toBe("");
	});

	it("cancels camera effects work and cleans both tracks on disposal", async () => {
		const effects = deferred<void>();
		const initialTrack = track("initial-camera", "video");
		const candidateTrack = track("candidate-camera", "video");
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidateTrack])),
			applyCameraEffects: vi.fn(() => effects.promise),
		});
		harness.setLocalStream(new FakeMediaStream([initialTrack]) as never);

		const switching = harness.session.switchCamera("next-camera");
		await vi.waitFor(() =>
			expect(harness.options.applyCameraEffects).toHaveBeenCalledOnce(),
		);
		const disposal = harness.session.dispose(async () => {});
		effects.resolve();
		await Promise.all([switching, disposal]);

		expect(candidateTrack.stop).toHaveBeenCalledOnce();
		expect(initialTrack.stop).toHaveBeenCalledOnce();
		expect(harness.selections.camera).toBe("");
	});

	it("relinquishes adopted camera media when its publication manager changes during effects", async () => {
		const effects = deferred<void>();
		const initialTrack = track("initial-camera", "video");
		const candidateTrack = track("candidate-camera", "video");
		const oldOwner = {};
		const replacementOwner = {};
		let owner = oldOwner;
		const managerTracks = new Map<object, MediaStreamTrack | null>([
			[oldOwner, initialTrack],
			[replacementOwner, candidateTrack],
		]);
		const cleanupCameraEffects = vi.fn(() => managerTracks.set(owner, null));
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidateTrack])),
			applyCameraEffects: vi.fn(() => effects.promise),
			cleanupCameraEffects,
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(),
				reconcileMicrophone: vi.fn(),
				publish: vi.fn().mockResolvedValue({}),
			},
		});
		harness.setLocalStream(new FakeMediaStream([initialTrack]) as never);

		const switching = harness.session.switchCamera("next-camera");
		await vi.waitFor(() =>
			expect(harness.options.applyCameraEffects).toHaveBeenCalledOnce(),
		);
		owner = replacementOwner;
		harness.selections.camera = "replacement-camera";
		effects.resolve();
		await switching;

		expect(cleanupCameraEffects).not.toHaveBeenCalled();
		expect(harness.options.onCameraDisabled).not.toHaveBeenCalled();
		expect(managerTracks.get(replacementOwner)).toBe(candidateTrack);
		expect(candidateTrack.stop).not.toHaveBeenCalled();
		expect(initialTrack.stop).toHaveBeenCalledOnce();
		expect(harness.options.getLocalStream()?.getVideoTracks()).toEqual([
			candidateTrack,
		]);
		expect(harness.selections.camera).toBe("replacement-camera");
	});

	it("waits for queued microphone work before stopping local tracks", async () => {
		const releaseMicrophone = deferred<void>();
		const microphone = track("microphone", "audio");
		const harness = createHarness();
		harness.setLocalStream(new FakeMediaStream([microphone]) as never);
		const transition = harness.session.runMicrophoneTransition(
			() => releaseMicrophone.promise,
		);
		const beforeStoppingTracks = vi.fn();

		const disposal = harness.session.dispose(beforeStoppingTracks);
		await Promise.resolve();
		expect(beforeStoppingTracks).not.toHaveBeenCalled();
		expect(microphone.stop).not.toHaveBeenCalled();
		releaseMicrophone.resolve();
		await Promise.all([transition, disposal]);

		expect(beforeStoppingTracks).toHaveBeenCalledOnce();
		expect(microphone.stop).toHaveBeenCalledOnce();
	});

	it("drops camera media when camera intent changes during acquisition", async () => {
		const request = deferred<MediaStream>();
		const staleCamera = track("stale-camera", "video");
		let cameraEnabled = true;
		const harness = createHarness({ capture: vi.fn(() => request.promise) });
		const transition = harness.session.runCameraTransition(async () => {
			const operation = harness.session.createOperation();
			const { stream } = await harness.session.acquireUserMedia(
				true,
				false,
				{},
				operation,
			);
			harness.session.ownStream(operation, stream);
			if (!cameraEnabled) {
				harness.session.discardOwnedStreams(operation);
				return;
			}
			throw new Error("stale camera was adopted");
		});

		await vi.waitFor(() =>
			expect(harness.options.capture).toHaveBeenCalledOnce(),
		);
		cameraEnabled = false;
		request.resolve(new FakeMediaStream([staleCamera]) as never);
		await transition;

		expect(staleCamera.stop).toHaveBeenCalledOnce();
		expect(harness.publish).not.toHaveBeenCalled();
	});

	it("rejects a camera track that ends while replacement is pending", async () => {
		const replacement = deferred<void>();
		const candidate = track("candidate", "video");
		const owner = {};
		const harness = createHarness({
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(() => replacement.promise),
				reconcileMicrophone: vi.fn(),
				publish: vi.fn().mockResolvedValue({}),
			},
		});
		const operation = harness.session.createOperation();
		const reconciliation = harness.session.reconcileCamera(
			candidate,
			"device-switch",
			true,
			operation,
		);
		Reflect.set(candidate, "readyState", "ended");
		replacement.resolve();

		await expect(reconciliation).rejects.toThrow(
			"Camera track ended during reconciliation",
		);
	});

	it("cancels publication when its manager is replaced", async () => {
		const publication = deferred<unknown>();
		const camera = track("e2ee-camera", "video");
		let owner = {};
		const harness = createHarness({
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(),
				reconcileMicrophone: vi.fn(),
				publish: vi.fn(() => publication.promise),
			},
		});
		const operation = harness.session.createOperation();
		const publishing = harness.session.publish(
			new FakeMediaStream([camera]) as never,
			{ publishVideo: true, publishAudio: false },
			operation,
		);
		owner = {};
		publication.resolve({ video: { status: "published" } });

		await expect(publishing).rejects.toMatchObject({ name: "AbortError" });
	});

	it("relinquishes adopted E2EE media when its publication manager changes during publication", async () => {
		const publication = deferred<unknown>();
		const camera = track("replacement-camera", "video");
		const microphone = track("replacement-microphone", "audio");
		const oldOwner = {};
		const replacementOwner = {};
		let owner = oldOwner;
		const managerTracks = new Map<
			object,
			{ video: MediaStreamTrack | null; audio: MediaStreamTrack | null }
		>([
			[oldOwner, { video: null, audio: null }],
			[replacementOwner, { video: camera, audio: microphone }],
		]);
		const reconcileCamera = vi.fn(async (nextTrack: MediaStreamTrack | null) => {
			managerTracks.get(owner)!.video = nextTrack;
		});
		const reconcileMicrophone = vi.fn(
			async (nextTrack: MediaStreamTrack | null) => {
				managerTracks.get(owner)!.audio = nextTrack;
			},
		);
		const harness = createHarness({
			capture: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([camera, microphone])),
			publication: {
				getOwner: () => owner,
				reconcileCamera,
				reconcileMicrophone,
				publish: vi.fn(() => publication.promise),
			},
		});

		const publishing = harness.session.reacquireMediaAfterE2EE({
			needsCamera: true,
			needsMicrophone: true,
		});
		await vi.waitFor(() =>
			expect(harness.options.publication.publish).toHaveBeenCalledOnce(),
		);
		owner = replacementOwner;
		harness.selections.camera = "replacement-camera-device";
		harness.selections.microphone = "replacement-microphone-device";
		publication.resolve({
			video: { status: "published" },
			audio: { status: "published" },
		});

		await expect(publishing).resolves.toBeUndefined();
		expect(camera.stop).not.toHaveBeenCalled();
		expect(microphone.stop).not.toHaveBeenCalled();
		expect(harness.options.getLocalStream()?.getTracks()).toEqual([
			camera,
			microphone,
		]);
		expect(managerTracks.get(replacementOwner)).toEqual({
			video: camera,
			audio: microphone,
		});
		expect(reconcileCamera).not.toHaveBeenCalled();
		expect(reconcileMicrophone).not.toHaveBeenCalled();
		expect(harness.options.cleanupCameraEffects).not.toHaveBeenCalled();
		expect(harness.options.cleanupMicrophoneEffects).not.toHaveBeenCalled();
		expect(harness.options.onCameraDisabled).not.toHaveBeenCalled();
		expect(harness.options.onMicrophoneDisabled).not.toHaveBeenCalled();
		expect(harness.selections).toEqual({
			camera: "replacement-camera-device",
			microphone: "replacement-microphone-device",
		});
	});

	it("rejects E2EE publication when its reacquired track ends in flight", async () => {
		const publication = deferred<unknown>();
		const camera = track("reacquired-camera", "video");
		const owner = {};
		const publish = vi.fn(() => publication.promise);
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([camera])),
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(),
				reconcileMicrophone: vi.fn(),
				publish,
			},
		});
		const publishing = harness.session.reacquireMediaAfterE2EE({
			needsCamera: true,
		});
		await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
		Reflect.set(camera, "readyState", "ended");
		publication.resolve({});

		await expect(publishing).rejects.toThrow(
			"Local track ended during publication",
		);
		expect(camera.stop).toHaveBeenCalledOnce();
	});

	it.each([
		{ endedKind: "video" as const, survivingKind: "audio" as const },
		{ endedKind: "audio" as const, survivingKind: "video" as const },
	])(
		"preserves successful $survivingKind when combined E2EE $endedKind ends during publication",
		async ({ endedKind, survivingKind }) => {
			const publication = deferred<unknown>();
			const camera = track("reacquired-camera", "video");
			const microphone = track("reacquired-microphone", "audio");
			const owner = {};
			const publish = vi.fn(() => publication.promise);
			const harness = createHarness({
				capture: vi
					.fn()
					.mockResolvedValue(new FakeMediaStream([camera, microphone])),
				publication: {
					getOwner: () => owner,
					reconcileCamera: vi.fn().mockResolvedValue(undefined),
					reconcileMicrophone: vi.fn().mockResolvedValue(undefined),
					publish,
				},
			});

			const publishing = harness.session.reacquireMediaAfterE2EE({
				needsCamera: true,
				needsMicrophone: true,
			});
			await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
			const endedTrack = endedKind === "video" ? camera : microphone;
			const survivingTrack = survivingKind === "video" ? camera : microphone;
			Reflect.set(endedTrack, "readyState", "ended");
			publication.resolve({
				video: { status: "published" },
				audio: { status: "published" },
			});

			await expect(publishing).rejects.toThrow(
				"Local track ended during publication",
			);
			expect(endedTrack.stop).toHaveBeenCalledOnce();
			expect(survivingTrack.stop).not.toHaveBeenCalled();
			expect(
				harness.options
					.getLocalStream()
					?.getTracks()
					.filter((item) => item.readyState === "live"),
			).toEqual([survivingTrack]);
			if (endedKind === "video") {
				expect(harness.options.onCameraDisabled).toHaveBeenCalledOnce();
				expect(harness.options.onMicrophoneDisabled).not.toHaveBeenCalled();
			} else {
				expect(harness.options.onMicrophoneDisabled).toHaveBeenCalledOnce();
				expect(harness.options.onCameraDisabled).not.toHaveBeenCalled();
			}
		},
	);

	it.each([
		{ endedKind: "video" as const, survivingKind: "audio" as const },
		{ endedKind: "audio" as const, survivingKind: "video" as const },
	])(
		"rolls back adopted $endedKind that ends while camera effects are pending",
		async ({ endedKind, survivingKind }) => {
			const effects = deferred<void>();
			const camera = track("reacquired-camera", "video");
			const microphone = track("reacquired-microphone", "audio");
			const harness = createHarness({
				capture: vi
					.fn()
					.mockResolvedValue(new FakeMediaStream([camera, microphone])),
				applyCameraEffects: vi.fn(() => effects.promise),
			});

			const publishing = harness.session.reacquireMediaAfterE2EE({
				needsCamera: true,
				needsMicrophone: true,
			});
			await vi.waitFor(() =>
				expect(harness.options.applyCameraEffects).toHaveBeenCalledOnce(),
			);
			const endedTrack = endedKind === "video" ? camera : microphone;
			const survivingTrack = survivingKind === "video" ? camera : microphone;
			Reflect.set(endedTrack, "readyState", "ended");
			effects.resolve();

			await expect(publishing).rejects.toThrow(
				endedKind === "video"
					? "No live effective camera track is available for publication"
					: "No live effective microphone track is available for publication",
			);
			expect(harness.publish).toHaveBeenCalledOnce();
			expect(harness.publish).toHaveBeenCalledWith(
				expect.objectContaining({
					getTracks: expect.any(Function),
				}),
				endedKind === "video"
					? { publishVideo: false, publishAudio: true }
					: { publishVideo: true, publishAudio: false },
			);
			expect(endedTrack.stop).toHaveBeenCalledOnce();
			expect(survivingTrack.stop).not.toHaveBeenCalled();
			if (endedKind === "video") {
				expect(harness.options.onCameraDisabled).toHaveBeenCalledOnce();
				expect(harness.options.onMicrophoneDisabled).not.toHaveBeenCalled();
			} else {
				expect(harness.options.onMicrophoneDisabled).toHaveBeenCalledOnce();
				expect(harness.options.onCameraDisabled).not.toHaveBeenCalled();
			}
		},
	);

	it("observes replacement tracks and removes listeners on cleanup", async () => {
		const ended = vi.fn().mockResolvedValue(undefined);
		const first = track("first", "video");
		const second = track("second", "video");
		let localStream: MediaStream | null = new FakeMediaStream([first]) as never;
		const harness = createHarness({
			getLocalStream: () => localStream,
			onCameraTrackEnded: ended,
		});
		localStream = new FakeMediaStream([second]) as never;
		harness.session.observeLocalTracks();
		Reflect.set(first, "readyState", "ended");
		first.dispatchEvent(new Event("ended"));
		Reflect.set(second, "readyState", "ended");
		second.dispatchEvent(new Event("ended"));
		await vi.waitFor(() => expect(ended).toHaveBeenCalledWith(second));

		await harness.session.dispose(async () => {});
		expect(first.removeEventListener).toHaveBeenCalledOnce();
		expect(second.removeEventListener).toHaveBeenCalledOnce();
		expect(second.stop).toHaveBeenCalledOnce();
	});

	it("merges E2EE reacquisition without replacing newer or disabled media", () => {
		const currentAudio = track("current-audio", "audio");
		const restoredCamera = track("restored-camera", "video");
		const staleCamera = track("stale-camera", "video");
		const unrequestedAudio = track("unrequested-audio", "audio");
		const currentStream = new FakeMediaStream([currentAudio, restoredCamera]);

		const result = mergeReacquiredMedia({
			acquiredStream: new FakeMediaStream([
				staleCamera,
				unrequestedAudio,
			]) as never,
			currentStream: currentStream as never,
			requestedCamera: true,
			requestedMicrophone: false,
			cameraEnabled: true,
			microphoneEnabled: true,
			cameraTrackBeforeRequest: null,
			microphoneTrackBeforeRequest: currentAudio,
		});

		expect(result.adoptedCamera).toBe(false);
		expect(result.adoptedMicrophone).toBe(false);
		expect(staleCamera.stop).toHaveBeenCalledOnce();
		expect(unrequestedAudio.stop).toHaveBeenCalledOnce();
		expect(restoredCamera.stop).not.toHaveBeenCalled();
		expect(currentAudio.stop).not.toHaveBeenCalled();
	});

	it("stops local and detached tracks once even when cleanup overlaps", async () => {
		const camera = track("camera", "video");
		const microphone = track("microphone", "audio");
		const detached = track("detached", "video");
		let localStream: MediaStream | null = new FakeMediaStream([
			camera,
			microphone,
		]) as never;
		const harness = createHarness({ getLocalStream: () => localStream });
		harness.session.detachCameraTrack(detached);

		const first = harness.session.dispose(async () => {
			harness.session.stopTrack(camera);
		});
		const second = harness.session.dispose(async () => {});
		expect(second).toBe(first);
		await first;

		expect(camera.stop).toHaveBeenCalledOnce();
		expect(microphone.stop).toHaveBeenCalledOnce();
		expect(detached.stop).toHaveBeenCalledOnce();
		localStream = null;
	});

	it.each([
		{
			name: "audio-only",
			request: { needsMicrophone: true },
			kind: "audio" as const,
			error: new Error("audio failed"),
		},
		{
			name: "video-only",
			request: { needsCamera: true },
			kind: "video" as const,
			error: new Error("video failed"),
		},
	])(
		"rolls back an E2EE $name per-kind publication failure",
		async ({ request, kind, error }) => {
			const candidate = track(`failed-${kind}`, kind);
			const owner = {};
			const result = {
				[kind]: { status: "failed" as const, error },
			};
			const harness = createHarness({
				capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
				publication: {
					getOwner: () => owner,
					reconcileCamera: vi.fn().mockResolvedValue(undefined),
					reconcileMicrophone: vi.fn().mockResolvedValue(undefined),
					publish: vi.fn().mockResolvedValue(result),
				},
			});

			await expect(
				harness.session.reacquireMediaAfterE2EE(request),
			).rejects.toBe(error);

			expect(candidate.stop).toHaveBeenCalledOnce();
			expect(harness.options.getLocalStream()?.getTracks()).toEqual([]);
			if (kind === "video") {
				expect(harness.options.cleanupCameraEffects).toHaveBeenCalledOnce();
				expect(harness.options.onCameraDisabled).toHaveBeenCalledWith(error);
			} else {
				expect(harness.options.cleanupMicrophoneEffects).toHaveBeenCalledOnce();
				expect(harness.options.onMicrophoneDisabled).toHaveBeenCalledWith(error);
			}
		},
	);

	it("preserves successful audio when combined E2EE video publication fails", async () => {
		const camera = track("failed-camera", "video");
		const microphone = track("published-microphone", "audio");
		const videoError = new Error("video failed");
		const owner = {};
		const harness = createHarness({
			capture: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([camera, microphone])),
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn().mockResolvedValue(undefined),
				reconcileMicrophone: vi.fn().mockResolvedValue(undefined),
				publish: vi.fn().mockResolvedValue({
					video: { status: "failed", error: videoError },
					audio: { status: "published" },
				}),
			},
		});

		await expect(
			harness.session.reacquireMediaAfterE2EE({
				needsCamera: true,
				needsMicrophone: true,
			}),
		).rejects.toBe(videoError);

		expect(camera.stop).toHaveBeenCalledOnce();
		expect(microphone.stop).not.toHaveBeenCalled();
		expect(harness.options.getLocalStream()?.getVideoTracks()).toEqual([]);
		expect(harness.options.getLocalStream()?.getAudioTracks()).toEqual([
			microphone,
		]);
		expect(harness.options.onCameraDisabled).toHaveBeenCalledWith(videoError);
		expect(harness.options.onMicrophoneDisabled).not.toHaveBeenCalled();
	});

	it("rolls back both E2EE kinds when publication throws", async () => {
		const camera = track("thrown-camera", "video");
		const microphone = track("thrown-microphone", "audio");
		const failure = new Error("transport failed");
		const owner = {};
		const harness = createHarness({
			capture: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([camera, microphone])),
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn().mockResolvedValue(undefined),
				reconcileMicrophone: vi.fn().mockResolvedValue(undefined),
				publish: vi.fn().mockRejectedValue(failure),
			},
		});

		await expect(
			harness.session.reacquireMediaAfterE2EE({
				needsCamera: true,
				needsMicrophone: true,
			}),
		).rejects.toBe(failure);
		expect(camera.stop).toHaveBeenCalledOnce();
		expect(microphone.stop).toHaveBeenCalledOnce();
		expect(harness.options.getLocalStream()?.getTracks()).toEqual([]);
		expect(harness.options.onCameraDisabled).toHaveBeenCalledWith(failure);
		expect(harness.options.onMicrophoneDisabled).toHaveBeenCalledWith(failure);
	});

	it("keeps the old microphone when processing returns no track", async () => {
		const oldTrack = track("old-microphone", "audio");
		const candidate = track("candidate-microphone", "audio");
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
			prepareMicrophone: vi.fn().mockResolvedValue(null),
		});
		harness.setLocalStream(new FakeMediaStream([oldTrack]) as never);

		await expect(
			harness.session.switchMicrophone("next-microphone"),
		).rejects.toThrow("No live processed microphone track");

		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(oldTrack.stop).not.toHaveBeenCalled();
		expect(harness.options.getLocalStream()?.getAudioTracks()).toEqual([
			oldTrack,
		]);
	});

	it("discards microphone effects and restores publication after reconcile failure", async () => {
		const oldTrack = track("old-microphone", "audio");
		const candidate = track("candidate-microphone", "audio");
		const processed = track("processed-microphone", "audio");
		const discard = vi.fn(() => processed.stop());
		const owner = {};
		const reconcileMicrophone = vi
			.fn()
			.mockRejectedValueOnce(new Error("replace failed"))
			.mockResolvedValueOnce(undefined);
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
			prepareMicrophone: vi.fn().mockResolvedValue({
				track: processed,
				commit: vi.fn(),
				discard,
			}),
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(),
				reconcileMicrophone,
				publish: vi.fn().mockResolvedValue({}),
			},
		});
		harness.setLocalStream(new FakeMediaStream([oldTrack]) as never);

		await expect(
			harness.session.switchMicrophone("preferred-microphone"),
		).rejects.toThrow("replace failed");

		expect(harness.selections.microphone).toBe("preferred-microphone");
		expect(discard).toHaveBeenCalledOnce();
		expect(processed.stop).toHaveBeenCalledOnce();
		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(oldTrack.stop).not.toHaveBeenCalled();
		expect(reconcileMicrophone).toHaveBeenLastCalledWith(
			oldTrack,
			true,
			expect.anything(),
		);
		expect(harness.options.getLocalStream()?.getAudioTracks()).toEqual([
			oldTrack,
		]);
	});

	it("stops a candidate exactly once when effect discard already stops it", async () => {
		const oldTrack = track("old-microphone", "audio");
		const candidate = track("candidate-microphone", "audio");
		const failure = new Error("replace failed");
		const owner = {};
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
			prepareMicrophone: vi.fn().mockResolvedValue({
				track: candidate,
				commit: vi.fn(),
				discard: vi.fn(() => {
					candidate.stop();
					throw new Error("effect cleanup failed");
				}),
			}),
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(),
				reconcileMicrophone: vi
					.fn()
					.mockRejectedValueOnce(failure)
					.mockResolvedValueOnce(undefined),
				publish: vi.fn().mockResolvedValue({}),
			},
		});
		harness.setLocalStream(new FakeMediaStream([oldTrack]) as never);

		await expect(
			harness.session.switchMicrophone("next-microphone"),
		).rejects.toBe(failure);

		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(oldTrack.stop).not.toHaveBeenCalled();
	});

	it("does not disturb a replacement manager that already republished the current microphone", async () => {
		const oldTrack = track("old-microphone", "audio");
		const candidate = track("candidate-microphone", "audio");
		const processed = track("processed-microphone", "audio");
		const reconciliation = deferred<void>();
		const discard = vi.fn(() => processed.stop());
		const oldOwner = {};
		const replacementOwner = {};
		let owner = oldOwner;
		const producerTracks = new Map<object, MediaStreamTrack | null>([
			[oldOwner, oldTrack],
			[replacementOwner, oldTrack],
		]);
		const reconcileMicrophone = vi.fn(
			async (nextTrack: MediaStreamTrack | null) => {
				const calledOwner = owner;
				if (calledOwner === oldOwner && nextTrack === processed) {
					await reconciliation.promise;
				}
				producerTracks.set(calledOwner, nextTrack);
			},
		);
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
			prepareMicrophone: vi.fn().mockResolvedValue({
				track: processed,
				commit: vi.fn(),
				discard,
			}),
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(),
				reconcileMicrophone,
				publish: vi.fn().mockResolvedValue({}),
			},
		});
		harness.setLocalStream(new FakeMediaStream([oldTrack]) as never);

		const switching = harness.session.switchMicrophone("next-microphone");
		await vi.waitFor(() =>
			expect(reconcileMicrophone).toHaveBeenCalled(),
		);
		owner = replacementOwner;
		reconciliation.resolve();
		await switching;

		expect(discard).toHaveBeenCalledOnce();
		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(oldTrack.stop).not.toHaveBeenCalled();
		expect(harness.options.getLocalStream()?.getAudioTracks()).toEqual([
			oldTrack,
		]);
		expect(producerTracks.get(replacementOwner)).toBe(oldTrack);
		expect(reconcileMicrophone).toHaveBeenCalledOnce();
		expect(harness.options.onMicrophoneDisabled).not.toHaveBeenCalled();
	});

	it("restores the old microphone when a published candidate ends before commit", async () => {
		const oldTrack = track("old-microphone", "audio");
		const candidate = track("candidate-microphone", "audio");
		const commitGate = deferred<void>();
		let producerTrack: MediaStreamTrack | null = oldTrack;
		const owner = {};
		const reconcileMicrophone = vi.fn(async (nextTrack: MediaStreamTrack | null) => {
			producerTrack = nextTrack;
		});
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(),
				reconcileMicrophone,
				publish: vi.fn().mockResolvedValue({}),
			},
		});
		harness.setLocalStream(new FakeMediaStream([oldTrack]) as never);
		const commitSpy = vi.spyOn(harness.session, "runStreamCommit");
		const blocker = harness.session.runStreamCommit(
			harness.session.createOperation(),
			() => commitGate.promise,
		);

		const switching = harness.session.switchMicrophone("next-microphone");
		await vi.waitFor(() => expect(commitSpy).toHaveBeenCalledTimes(2));
		expect(producerTrack).toBe(candidate);
		Reflect.set(candidate, "readyState", "ended");
		commitGate.resolve();
		await Promise.all([blocker, switching]);

		expect(reconcileMicrophone).toHaveBeenLastCalledWith(
			oldTrack,
			true,
			expect.anything(),
		);
		expect(producerTrack).toBe(oldTrack);
		expect(harness.options.getLocalStream()?.getAudioTracks()).toEqual([
			oldTrack,
		]);
		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(oldTrack.stop).not.toHaveBeenCalled();
		expect(harness.options.onMicrophoneDisabled).not.toHaveBeenCalled();
	});

	it("truthfully keeps a first microphone enable disabled when publication fails", async () => {
		const candidate = track("candidate-microphone", "audio");
		const failure = new Error("publication failed");
		const reconcileMicrophone = vi
			.fn()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(undefined);
		const owner = {};
		const harness = createHarness({
			isMicrophoneEnabled: () => false,
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
			publication: {
				getOwner: () => owner,
				reconcileCamera: vi.fn(),
				reconcileMicrophone,
				publish: vi.fn().mockResolvedValue({}),
			},
		});

		await expect(harness.session.enableMicrophone()).rejects.toBe(failure);

		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(harness.options.getLocalStream()).toBeNull();
		expect(reconcileMicrophone).toHaveBeenLastCalledWith(
			null,
			false,
			expect.anything(),
		);
		expect(harness.options.onMicrophoneDisabled).toHaveBeenCalledWith(failure);
	});

	it("persists active microphone intent before a failed acquisition", async () => {
		const oldTrack = track("old-microphone", "audio");
		const failure = new Error("acquisition failed");
		let harness!: ReturnType<typeof createHarness>;
		const capture = vi.fn(() => {
			expect(harness.selections.microphone).toBe("preferred-microphone");
			return Promise.reject(failure);
		});
		harness = createHarness({ capture });
		harness.setLocalStream(new FakeMediaStream([oldTrack]) as never);

		await expect(
			harness.session.switchMicrophone("preferred-microphone"),
		).rejects.toBe(failure);

		expect(harness.selections.microphone).toBe("preferred-microphone");
		expect(oldTrack.stop).not.toHaveBeenCalled();
		expect(harness.options.getLocalStream()?.getAudioTracks()).toEqual([
			oldTrack,
		]);
	});

	it("coordinates combined E2EE work with both transition queues", async () => {
		const releaseCamera = deferred<void>();
		const releaseMicrophone = deferred<void>();
		const camera = track("e2ee-camera", "video");
		const microphone = track("e2ee-microphone", "audio");
		const harness = createHarness({
			capture: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([camera, microphone])),
		});
		const cameraWork = harness.session.runCameraTransition(
			() => releaseCamera.promise,
		);
		const microphoneWork = harness.session.runMicrophoneTransition(
			() => releaseMicrophone.promise,
		);
		const reacquisition = harness.session.reacquireMediaAfterE2EE({
			needsCamera: true,
			needsMicrophone: true,
		});

		releaseMicrophone.resolve();
		releaseCamera.resolve();
		await Promise.race([
			reacquisition,
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error("combined transition deadlocked")),
					100,
				),
			),
		]);
		await Promise.all([cameraWork, microphoneWork]);

		expect(harness.publish).toHaveBeenCalledOnce();
		expect(harness.options.getLocalStream()?.getVideoTracks()).toEqual([
			camera,
		]);
		expect(harness.options.getLocalStream()?.getAudioTracks()).toEqual([
			microphone,
		]);
	});

	it("observes and rejects a camera that ends during deferred effects startup", async () => {
		const effects = deferred<void>();
		const oldTrack = track("old-camera", "video");
		const candidate = track("candidate-camera", "video");
		const ended = vi.fn().mockResolvedValue(undefined);
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const harness = createHarness({
			capture: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
			applyCameraEffects: vi.fn(() => effects.promise),
			onCameraTrackEnded: ended,
		});
		harness.setLocalStream(new FakeMediaStream([oldTrack]) as never);

		const switching = harness.session.switchCamera("next-camera");
		await vi.waitFor(() =>
			expect(harness.options.applyCameraEffects).toHaveBeenCalled(),
		);
		Reflect.set(candidate, "readyState", "ended");
		candidate.dispatchEvent(new Event("ended"));
		effects.resolve();
		await switching;

		await vi.waitFor(() => expect(ended).toHaveBeenCalledWith(candidate));
		expect(harness.options.cleanupCameraEffects).toHaveBeenCalledOnce();
		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(oldTrack.stop).not.toHaveBeenCalled();
		expect(harness.options.getLocalStream()?.getVideoTracks()).toEqual([
			oldTrack,
		]);
		consoleWarn.mockRestore();
	});

	it("invokes microphone-ended recovery outside its transition queue", async () => {
		const microphone = track("ended-microphone", "audio");
		const nestedTransition = vi.fn();
		let session!: LocalCaptureSession;
		const harness = createHarness({
			onMicrophoneTrackEnded: async () => {
				await session.runMicrophoneTransition(async () => {
					nestedTransition();
				});
			},
		});
		session = harness.session;
		harness.setLocalStream(new FakeMediaStream([microphone]) as never);

		Reflect.set(microphone, "readyState", "ended");
		microphone.dispatchEvent(new Event("ended"));

		await vi.waitFor(() => expect(nestedTransition).toHaveBeenCalledOnce());
	});
});
