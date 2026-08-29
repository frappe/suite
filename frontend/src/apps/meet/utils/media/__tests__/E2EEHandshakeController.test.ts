import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import { E2EEEpochSignalingController } from "../E2EEEpochSignalingController";
import { wipeActiveEpochState } from "../E2EEEpochStateStore";
import { E2EEHandshakeController } from "../E2EEHandshakeController";
import { E2EEMeeting } from "../E2EEMeeting";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const track = (kind: "audio" | "video", readyState = "live") =>
	({ kind, readyState }) as MediaStreamTrack;

const stream = (tracks: MediaStreamTrack[]) =>
	({
		getAudioTracks: () =>
			tracks.filter((candidate) => candidate.kind === "audio"),
		getVideoTracks: () =>
			tracks.filter((candidate) => candidate.kind === "video"),
	}) as MediaStream;

function createMediaReconfigurationController({
	mediaState,
	joinRoom = vi.fn().mockResolvedValue(undefined),
	refreshToken = vi.fn().mockResolvedValue(undefined),
}: {
	mediaState: {
		isCameraOn: boolean;
		isMicOn: boolean;
		localStream: MediaStream | null;
		processedStream: MediaStream | null;
	};
	joinRoom?: ReturnType<typeof vi.fn>;
	refreshToken?: ReturnType<typeof vi.fn>;
}) {
	const reconfigureForE2EE = vi.fn(
		async (
			videoStream: MediaStream | null,
			audioStream: MediaStream | null,
			_signal?: AbortSignal,
		) => ({
			videoPublished: !!videoStream,
			audioPublished: !!audioStream,
		}),
	);
	const controller = new E2EEHandshakeController({
		meetingId: "meeting-1",
		sfuClient: {
			isConnected: vi.fn(() => true),
			setE2EERequired: vi.fn(),
			refreshToken,
			joinRoom,
		} as never,
		sfuManager: shallowRef({
			reconfigureForE2EE,
			rejoinParticipantConnection: joinRoom,
			hasLocalMediaPublications: vi.fn(() => true),
		} as never),
		currentUser: {
			currentUser: shallowRef({ user_id: "user-1", full_name: "User One" }),
		} as never,
		mediaState: mediaState as never,
		isCurrentTabHost: shallowRef(false),
		getDeviceIdentity: vi.fn(),
	});
	const reconfigure = () =>
		Reflect.get(controller, "reconfigureMediaForE2EE").call(
			controller,
		) as Promise<void>;
	return { controller, reconfigure, reconfigureForE2EE };
}

function createController() {
	return new E2EEHandshakeController({
		meetingId: "meeting-1",
		sfuClient: {
			getOwnSenderId: vi.fn(() => 7),
			setE2EERequired: vi.fn(),
			isConnected: vi.fn(() => false),
			sendE2EEEpochEnvelope: vi.fn(),
		} as never,
		sfuManager: shallowRef(null),
		currentUser: {
			currentUser: shallowRef({ user_id: "user-1" }),
		} as never,
		mediaState: {} as never,
		isCurrentTabHost: shallowRef(false),
		getDeviceIdentity: vi.fn(async () => ({
			deviceId: "device-1",
			signingPublicKey: "signing-public-key",
			signingKeyPair: { privateKey: {} as CryptoKey } as CryptoKeyPair,
		})),
		epochProtocolProvider: {
			createGenesisEpoch: vi.fn(async () => ({
				epochNumber: 1,
				state: {} as never,
				encodedState: new Uint8Array([1]),
				meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			})),
			createGenesisEpochWithMembers: vi.fn(),
			generateKeyPackage: vi.fn(),
			encodeKeyPackage: vi.fn(),
			decodeKeyPackage: vi.fn(),
			encodeCommit: vi.fn(),
			encodeWelcome: vi.fn(),
			decodeWelcome: vi.fn(),
			addMember: vi.fn(),
			addMultipleMembers: vi.fn(),
			removeMember: vi.fn(),
			joinFromWelcome: vi.fn(),
			processCommit: vi.fn(),
			exportMeetingSecret: vi.fn(),
		},
	});
}

describe("E2EEHandshakeController", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		wipeActiveEpochState();
		E2EEMeeting.instance.wipeMeetingContext();
	});

	it("installs the genesis epoch meeting secret when the host enables E2EE", async () => {
		const controller = createController();
		let installedSecret: Uint8Array<ArrayBuffer> | null = null;
		controller.onHandshakeComplete = (detail) => {
			installedSecret = detail.meetingSecret;
		};

		await controller.handleHostE2EEKeySet({
			keyVersion: "v1-test",
		});

		expect(controller.keyVersion).toBe(1);
		expect(installedSecret?.byteLength).toBe(32);
		expect(
			Reflect.get(
				Reflect.get(controller, "sfuClient"),
				"sendE2EEEpochEnvelope",
			),
		).toHaveBeenCalledWith({
			type: "ack",
			fromParticipantId: "user-1",
			fromSenderId: 7,
			epochNumber: 1,
		});
	});

	it("broadcasts a key-package-request and authors a multi-joiner add commit when E2EE is enabled mid-meeting", async () => {
		const sendE2EEEpochEnvelope = vi.fn();
		const getRoomParticipants = vi.fn(async () => [
			{ user_id: "user-1", sender_id: 7, is_host: true },
			{ user_id: "user-2", sender_id: 9, is_host: false },
			{ user_id: "user-3", sender_id: 11, is_host: false },
		]);
		const sfuClient = {
			getOwnSenderId: vi.fn(() => 7),
			setE2EERequired: vi.fn(),
			isConnected: vi.fn(() => false),
			sendE2EEEpochEnvelope,
			getRoomParticipants,
		} as never;
		const epochProtocolProvider = {
			createGenesisEpoch: vi.fn(async () => ({
				epochNumber: 1,
				state: { id: "epoch-1-state" } as never,
				encodedState: new Uint8Array([1]),
				meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			})),
			createGenesisEpochWithMembers: vi.fn(),
			generateKeyPackage: vi.fn(),
			encodeKeyPackage: vi.fn(),
			decodeKeyPackage: vi.fn((encoded: Uint8Array) => ({
				encoded: Array.from(encoded),
			})),
			encodeCommit: vi.fn(() => new Uint8Array([4, 5, 6])),
			encodeWelcome: vi.fn(() => new Uint8Array([7, 8, 9])),
			decodeWelcome: vi.fn(),
			addMember: vi.fn(),
			addMultipleMembers: vi.fn(async (state: unknown) => ({
				commit: { id: "commit" } as never,
				welcome: { id: "welcome" } as never,
				epoch: {
					epochNumber: 2,
					state: state as never,
					encodedState: new Uint8Array([8]),
					meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
				},
			})),
			joinFromWelcome: vi.fn(),
			processCommit: vi.fn(),
			exportMeetingSecret: vi.fn(),
		};
		const sfuManager = shallowRef({
			reconfigureForE2EE: vi.fn(async () => ({
				videoPublished: true,
				audioPublished: true,
			})),
		} as never);
		const signalingController = new E2EEEpochSignalingController({
			meetingId: "meeting-1",
			sfuClient,
			currentUser: {
				currentUser: shallowRef({ user_id: "user-1" }),
			} as never,
			isCurrentTabHost: shallowRef(true),
			getDeviceIdentity: vi.fn(async () => ({
				deviceId: "device-1",
				signingPublicKey: "signing-public-key",
				signingKeyPair: { privateKey: {} as CryptoKey } as CryptoKeyPair,
			})),
			epochProtocolProvider: epochProtocolProvider as never,
		});
		const controller = new E2EEHandshakeController({
			meetingId: "meeting-1",
			sfuClient,
			sfuManager,
			currentUser: {
				currentUser: shallowRef({ user_id: "user-1" }),
			} as never,
			mediaState: {} as never,
			isCurrentTabHost: shallowRef(true),
			getDeviceIdentity: vi.fn(async () => ({
				deviceId: "device-1",
				signingPublicKey: "signing-public-key",
				signingKeyPair: { privateKey: {} as CryptoKey } as CryptoKeyPair,
			})),
			epochSignalingController: signalingController,
			epochProtocolProvider: epochProtocolProvider as never,
			enableCollectionTimeoutMs: 50,
		});

		const handlePromise = controller.handleHostE2EEKeySet({
			keyVersion: "v1-test",
		});

		await new Promise((resolve) => setTimeout(resolve, 5));
		signalingController.handleEpochEnvelope({
			type: "key-package",
			fromParticipantId: "user-2",
			fromSenderId: 9,
			epochNumber: 1,
			keyPackage: "AAAA",
		});
		signalingController.handleEpochEnvelope({
			type: "key-package",
			fromParticipantId: "user-3",
			fromSenderId: 11,
			epochNumber: 1,
			keyPackage: "BBBB",
		});

		await handlePromise;

		expect(getRoomParticipants).toHaveBeenCalled();
		expect(
			sendE2EEEpochEnvelope.mock.calls.some(
				(call) =>
					Array.isArray(call) &&
					call[0] &&
					typeof call[0] === "object" &&
					call[0].type === "key-package-request" &&
					call[0].reason === "enable",
			),
		).toBe(true);
		expect(epochProtocolProvider.addMultipleMembers).toHaveBeenCalled();
		expect(
			sendE2EEEpochEnvelope.mock.calls.some(
				(call) =>
					Array.isArray(call) &&
					call[0] &&
					typeof call[0] === "object" &&
					call[0].type === "commit" &&
					call[0].epochNumber === 2,
			),
		).toBe(true);
		const welcomeCalls = sendE2EEEpochEnvelope.mock.calls.filter(
			(call) =>
				Array.isArray(call) &&
				call[0] &&
				typeof call[0] === "object" &&
				call[0].type === "welcome",
		);
		expect(welcomeCalls).toHaveLength(2);
		expect(
			welcomeCalls.some(
				(call) =>
					Array.isArray(call) &&
					call[0] &&
					typeof call[0] === "object" &&
					call[0].toSenderId === 9,
			),
		).toBe(true);
		expect(
			welcomeCalls.some(
				(call) =>
					Array.isArray(call) &&
					call[0] &&
					typeof call[0] === "object" &&
					call[0].toSenderId === 11,
			),
		).toBe(true);
		expect(controller.keyVersion).toBe(2);
	});

	it("cancels host key-package collection on teardown without installing an epoch", async () => {
		const requestSent = deferred<void>();
		const createGenesisEpoch = vi.fn();
		const sendE2EEEpochEnvelope = vi.fn((envelope: { type?: string }) => {
			if (envelope.type === "key-package-request") requestSent.resolve();
		});
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
		const controller = new E2EEHandshakeController({
			meetingId: "meeting-1",
			sfuClient: {
				getOwnSenderId: vi.fn(() => 7),
				setE2EERequired: vi.fn(),
				isConnected: vi.fn(() => false),
				sendE2EEEpochEnvelope,
				getRoomParticipants: vi.fn(async () => [
					{ user_id: "user-1", sender_id: 7, is_host: true },
					{ user_id: "user-2", sender_id: 9, is_host: false },
				]),
			} as never,
			sfuManager: shallowRef(null),
			currentUser: {
				currentUser: shallowRef({ user_id: "user-1" }),
			} as never,
			mediaState: {} as never,
			isCurrentTabHost: shallowRef(true),
			getDeviceIdentity: vi.fn(),
			epochSignalingController: {
				getReceivedKeyPackagesBySenderId: vi.fn(() => new Map()),
			} as never,
			epochProtocolProvider: {
				createGenesisEpoch,
			} as never,
			enableCollectionTimeoutMs: 60_000,
		});
		const onHandshakeComplete = vi.fn();
		controller.onHandshakeComplete = onHandshakeComplete;

		const handling = controller.handleHostE2EEKeySet({ keyVersion: "v1-test" });
		await requestSent.promise;
		const collectionTimer = setTimeoutSpy.mock.results.find(
			(_, index) => setTimeoutSpy.mock.calls[index][1] === 250,
		)?.value;
		expect(collectionTimer).toBeDefined();

		controller.teardownForDisconnect();
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const settledPromptly = await Promise.race([
			handling.then(() => true),
			new Promise<boolean>((resolve) => {
				deadline = setTimeout(() => resolve(false), 50);
			}),
		]);
		if (deadline) clearTimeout(deadline);

		expect(settledPromptly).toBe(true);
		expect(clearTimeoutSpy).toHaveBeenCalledWith(collectionTimer);
		expect(createGenesisEpoch).not.toHaveBeenCalled();
		expect(onHandshakeComplete).not.toHaveBeenCalled();
		expect(controller.keyVersion).toBeNull();
	});

	it("transient reconnect sends a resync-request without wiping runtime state", async () => {
		const sendE2EEEpochEnvelope = vi.fn();
		const sfuClient = {
			getOwnSenderId: vi.fn(() => 7),
			setE2EERequired: vi.fn(),
			isConnected: vi.fn(() => true),
			sendE2EEEpochEnvelope,
		} as never;
		const controller = new E2EEHandshakeController({
			meetingId: "meeting-1",
			sfuClient,
			sfuManager: shallowRef(null),
			currentUser: {
				currentUser: shallowRef({ user_id: "user-1" }),
			} as never,
			mediaState: {} as never,
			isCurrentTabHost: shallowRef(false),
			getDeviceIdentity: vi.fn(async () => ({
				deviceId: "device-1",
				signingPublicKey: "signing-public-key",
				signingKeyPair: { privateKey: {} as CryptoKey } as CryptoKeyPair,
			})),
			epochProtocolProvider: {
				createGenesisEpoch: vi.fn(),
				createGenesisEpochWithMembers: vi.fn(),
				generateKeyPackage: vi.fn(),
				encodeKeyPackage: vi.fn(),
				decodeKeyPackage: vi.fn(),
				encodeCommit: vi.fn(),
				encodeWelcome: vi.fn(),
				decodeWelcome: vi.fn(),
				addMember: vi.fn(),
				addMultipleMembers: vi.fn(),
				removeMember: vi.fn(),
				joinFromWelcome: vi.fn(),
				processCommit: vi.fn(),
				exportMeetingSecret: vi.fn(),
			} as never,
		});
		controller.keyVersion = 3;

		controller.handleTransientReconnect();

		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "resync-request",
				knownEpochNumber: 3,
			}),
		);
		expect(controller.keyVersion).toBe(3);
	});

	it("non-host E2EE enablement waits for context before reconfiguring media", async () => {
		const sfuClient = {
			getOwnSenderId: vi.fn(() => 9),
			setE2EERequired: vi.fn(),
			isConnected: vi.fn(() => true),
			refreshToken: vi.fn(async () => undefined),
			joinRoom: vi.fn(async () => undefined),
			sendE2EEEpochEnvelope: vi.fn(),
		} as never;
		const sfuManager = shallowRef({
			rejoinParticipantConnection: vi.fn(async () => true),
			reconfigureForE2EE: vi.fn(async () => ({
				videoPublished: true,
				audioPublished: true,
			})),
			hasLocalMediaPublications: vi.fn(() => true),
		} as never);
		const controller = new E2EEHandshakeController({
			meetingId: "meeting-1",
			sfuClient,
			sfuManager,
			currentUser: {
				currentUser: shallowRef({ user_id: "user-2", full_name: "User Two" }),
			} as never,
			mediaState: {
				isCameraOn: true,
				isMicOn: true,
				localStream: {} as MediaStream,
				processedStream: null,
			} as never,
			isCurrentTabHost: shallowRef(false),
			getDeviceIdentity: vi.fn(),
			epochProtocolProvider: {
				createGenesisEpoch: vi.fn(),
				createGenesisEpochWithMembers: vi.fn(),
				generateKeyPackage: vi.fn(),
				encodeKeyPackage: vi.fn(),
				decodeKeyPackage: vi.fn(),
				encodeCommit: vi.fn(),
				encodeWelcome: vi.fn(),
				decodeWelcome: vi.fn(),
				addMember: vi.fn(),
				addMultipleMembers: vi.fn(),
				removeMember: vi.fn(),
				joinFromWelcome: vi.fn(),
				processCommit: vi.fn(),
				exportMeetingSecret: vi.fn(),
			} as never,
		});

		const enablePromise = controller.handleMeetingE2EEEnabled({
			meeting_id: "meeting-1",
		});
		expect(sfuManager.value.reconfigureForE2EE).not.toHaveBeenCalled();

		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);
		await enablePromise;

		expect(sfuClient.setE2EERequired).toHaveBeenCalledWith(true);
		expect(sfuClient.refreshToken).toHaveBeenCalled();
		expect(sfuClient.joinRoom).not.toHaveBeenCalled();
		expect(sfuManager.value.rejoinParticipantConnection).toHaveBeenCalled();
		expect(sfuManager.value.reconfigureForE2EE).toHaveBeenCalled();
	});

	it("silences participant reconfiguration AbortError during disconnect", async () => {
		const abortError = new DOMException(
			"Participant disconnected",
			"AbortError",
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const reconfigurationEntered = deferred<void>();
		const releaseReconfiguration = deferred<{
			videoPublished: boolean;
			audioPublished: boolean;
		}>();
		const { controller, reconfigureForE2EE } =
			createMediaReconfigurationController({
				mediaState: {
					isCameraOn: true,
					isMicOn: false,
					localStream: stream([track("video")]),
					processedStream: null,
				},
			});
		reconfigureForE2EE.mockImplementation(() => {
			reconfigurationEntered.resolve();
			return releaseReconfiguration.promise;
		});
		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);

		const handling = controller.handleMeetingE2EEEnabled({
			meeting_id: "meeting-1",
		});
		await reconfigurationEntered.promise;
		controller.teardownForDisconnect();
		releaseReconfiguration.reject(abortError);
		await handling;

		expect(consoleError).not.toHaveBeenCalled();
		const signal = reconfigureForE2EE.mock.calls[0][2] as AbortSignal;
		expect(signal.aborted).toBe(true);
	});

	it("logs participant AbortError while the E2EE lifecycle is active", async () => {
		const abortError = new DOMException("Unrelated interruption", "AbortError");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const { controller, reconfigureForE2EE } =
			createMediaReconfigurationController({
				mediaState: {
					isCameraOn: true,
					isMicOn: false,
					localStream: stream([track("video")]),
					processedStream: null,
				},
			});
		reconfigureForE2EE.mockRejectedValue(abortError);
		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);

		await controller.handleMeetingE2EEEnabled({ meeting_id: "meeting-1" });

		expect(consoleError).toHaveBeenCalledWith(
			"Failed to reconfigure participant for E2EE:",
			abortError,
		);
		const signal = reconfigureForE2EE.mock.calls[0][2] as AbortSignal;
		expect(signal.aborted).toBe(false);
	});

	it("logs a real participant reconfiguration failure", async () => {
		const failure = new Error("reconfiguration failed");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const { controller, reconfigureForE2EE } =
			createMediaReconfigurationController({
				mediaState: {
					isCameraOn: true,
					isMicOn: false,
					localStream: stream([track("video")]),
					processedStream: null,
				},
			});
		reconfigureForE2EE.mockRejectedValue(failure);
		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);

		await controller.handleMeetingE2EEEnabled({ meeting_id: "meeting-1" });

		expect(consoleError).toHaveBeenCalledWith(
			"Failed to reconfigure participant for E2EE:",
			failure,
		);
	});

	it("hard reconnect (legacy) wipes runtime state before sending a resync-request", async () => {
		const sendE2EEEpochEnvelope = vi.fn();
		const sfuClient = {
			getOwnSenderId: vi.fn(() => 7),
			setE2EERequired: vi.fn(),
			isConnected: vi.fn(() => true),
			sendE2EEEpochEnvelope,
		} as never;
		const controller = new E2EEHandshakeController({
			meetingId: "meeting-1",
			sfuClient,
			sfuManager: shallowRef(null),
			currentUser: {
				currentUser: shallowRef({ user_id: "user-1" }),
			} as never,
			mediaState: {} as never,
			isCurrentTabHost: shallowRef(false),
			getDeviceIdentity: vi.fn(async () => ({
				deviceId: "device-1",
				signingPublicKey: "signing-public-key",
				signingKeyPair: { privateKey: {} as CryptoKey } as CryptoKeyPair,
			})),
			epochProtocolProvider: {
				createGenesisEpoch: vi.fn(),
				createGenesisEpochWithMembers: vi.fn(),
				generateKeyPackage: vi.fn(),
				encodeKeyPackage: vi.fn(),
				decodeKeyPackage: vi.fn(),
				encodeCommit: vi.fn(),
				encodeWelcome: vi.fn(),
				decodeWelcome: vi.fn(),
				addMember: vi.fn(),
				addMultipleMembers: vi.fn(),
				removeMember: vi.fn(),
				joinFromWelcome: vi.fn(),
				processCommit: vi.fn(),
				exportMeetingSecret: vi.fn(),
			} as never,
		});
		controller.keyVersion = 3;
		controller.meetingSecret = new Uint8Array(32) as Uint8Array<ArrayBuffer>;

		controller.handleSFUReconnect();

		expect(controller.keyVersion).toBeNull();
		expect(controller.meetingSecret).toBeNull();
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith(
			expect.objectContaining({ type: "resync-request" }),
		);
	});

	it("re-reads live processed video after asynchronous room join", async () => {
		const oldTrack = track("video");
		const nextTrack = track("video");
		const oldProcessed = stream([oldTrack]);
		const nextProcessed = stream([nextTrack]);
		const join = deferred<void>();
		const joinEntered = deferred<void>();
		const mediaState = {
			isCameraOn: true,
			isMicOn: false,
			localStream: stream([]),
			processedStream: oldProcessed,
		};
		const { reconfigure, reconfigureForE2EE } =
			createMediaReconfigurationController({
				mediaState,
				joinRoom: vi.fn(() => {
					joinEntered.resolve();
					return join.promise;
				}),
			});

		const reconfiguration = reconfigure();
		await joinEntered.promise;
		oldTrack.readyState = "ended";
		mediaState.processedStream = nextProcessed;
		join.resolve();
		await reconfiguration;

		expect(reconfigureForE2EE).toHaveBeenCalledWith(
			nextProcessed,
			null,
			expect.any(AbortSignal),
		);
	});

	it("falls back to live raw video when processed output has ended", async () => {
		const rawStream = stream([track("video")]);
		const endedProcessed = stream([track("video", "ended")]);
		const { reconfigure, reconfigureForE2EE } =
			createMediaReconfigurationController({
				mediaState: {
					isCameraOn: true,
					isMicOn: false,
					localStream: rawStream,
					processedStream: endedProcessed,
				},
			});

		await reconfigure();

		expect(reconfigureForE2EE).toHaveBeenCalledWith(
			rawStream,
			null,
			expect.any(AbortSignal),
		);
	});

	it("requests reacquisition only for enabled kinds without live tracks", async () => {
		const audioStream = stream([track("video", "ended"), track("audio")]);
		const processedStream = stream([track("video", "ended")]);
		const { reconfigure, reconfigureForE2EE } =
			createMediaReconfigurationController({
				mediaState: {
					isCameraOn: true,
					isMicOn: true,
					localStream: audioStream,
					processedStream,
				},
			});
		const eventHandler = vi.fn();
		document.addEventListener("meet:e2ee-needs-media-republish", eventHandler);

		await reconfigure();

		expect(reconfigureForE2EE).toHaveBeenCalledWith(
			null,
			audioStream,
			expect.any(AbortSignal),
		);
		expect(eventHandler).toHaveBeenCalledOnce();
		expect((eventHandler.mock.calls[0][0] as CustomEvent).detail).toEqual({
			needsCamera: true,
			needsMicrophone: false,
		});
		document.removeEventListener(
			"meet:e2ee-needs-media-republish",
			eventHandler,
		);
	});

	it("uses enabled intent changed while token refresh is pending", async () => {
		const refreshEntered = deferred<void>();
		const releaseRefresh = deferred<void>();
		const mediaState = {
			isCameraOn: true,
			isMicOn: false,
			localStream: stream([]),
			processedStream: null,
		};
		const { reconfigure, reconfigureForE2EE } =
			createMediaReconfigurationController({
				mediaState,
				refreshToken: vi.fn(() => {
					refreshEntered.resolve();
					return releaseRefresh.promise;
				}),
			});
		const eventHandler = vi.fn();
		document.addEventListener("meet:e2ee-needs-media-republish", eventHandler);

		const reconfiguration = reconfigure();
		await refreshEntered.promise;
		mediaState.isCameraOn = false;
		mediaState.isMicOn = true;
		releaseRefresh.resolve();
		await reconfiguration;

		expect(reconfigureForE2EE).toHaveBeenCalledWith(
			null,
			null,
			expect.any(AbortSignal),
		);
		expect((eventHandler.mock.calls[0][0] as CustomEvent).detail).toEqual({
			needsCamera: false,
			needsMicrophone: true,
		});
		document.removeEventListener(
			"meet:e2ee-needs-media-republish",
			eventHandler,
		);
	});

	it("uses enabled intent changed while manager reconfiguration is pending", async () => {
		const localStream = stream([track("video"), track("audio")]);
		const mediaState = {
			isCameraOn: true,
			isMicOn: true,
			localStream,
			processedStream: null,
		};
		const { reconfigure, reconfigureForE2EE } =
			createMediaReconfigurationController({ mediaState });
		const managerCallEntered = deferred<void>();
		const releaseManagerCall = deferred<{
			videoPublished: boolean;
			audioPublished: boolean;
		}>();
		reconfigureForE2EE.mockImplementation(() => {
			managerCallEntered.resolve();
			return releaseManagerCall.promise;
		});
		const eventHandler = vi.fn();
		document.addEventListener("meet:e2ee-needs-media-republish", eventHandler);

		const reconfiguration = reconfigure();
		await managerCallEntered.promise;
		mediaState.isCameraOn = false;
		releaseManagerCall.resolve({
			videoPublished: false,
			audioPublished: false,
		});
		await reconfiguration;

		expect(eventHandler).toHaveBeenCalledOnce();
		expect((eventHandler.mock.calls[0][0] as CustomEvent).detail).toEqual({
			needsCamera: false,
			needsMicrophone: true,
		});
		document.removeEventListener(
			"meet:e2ee-needs-media-republish",
			eventHandler,
		);
	});

	it("uses execution-time publication results for queued track loss", async () => {
		const videoTrack = track("video");
		const audioTrack = track("audio");
		const localStream = stream([videoTrack, audioTrack]);
		const { reconfigure, reconfigureForE2EE } =
			createMediaReconfigurationController({
				mediaState: {
					isCameraOn: true,
					isMicOn: true,
					localStream,
					processedStream: null,
				},
			});
		const managerCallEntered = deferred<void>();
		const releaseManagerCall = deferred<{
			videoPublished: boolean;
			audioPublished: boolean;
		}>();
		reconfigureForE2EE.mockImplementation(() => {
			managerCallEntered.resolve();
			return releaseManagerCall.promise;
		});
		const eventHandler = vi.fn();
		document.addEventListener("meet:e2ee-needs-media-republish", eventHandler);

		const reconfiguration = reconfigure();
		await managerCallEntered.promise;
		Reflect.set(videoTrack, "readyState", "ended");
		releaseManagerCall.resolve({
			videoPublished: false,
			audioPublished: true,
		});
		await reconfiguration;

		expect(reconfigureForE2EE).toHaveBeenCalledWith(
			localStream,
			localStream,
			expect.any(AbortSignal),
		);
		expect(eventHandler).toHaveBeenCalledOnce();
		expect((eventHandler.mock.calls[0][0] as CustomEvent).detail).toEqual({
			needsCamera: true,
			needsMicrophone: false,
		});
		document.removeEventListener(
			"meet:e2ee-needs-media-republish",
			eventHandler,
		);
	});
});
