import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import { E2EEEpochSignalingController } from "../E2EEEpochSignalingController";
import { wipeActiveEpochState } from "../E2EEEpochStateStore";
import { E2EEHandshakeController } from "../E2EEHandshakeController";
import { E2EEMeeting } from "../E2EEMeeting";

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
			(controller as unknown as { sfuClient: { sendE2EEEpochEnvelope: ReturnType<typeof vi.fn> } }).sfuClient
				.sendE2EEEpochEnvelope,
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
			reconfigureForE2EE: vi.fn(async () => undefined),
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
		reconfigureForE2EE: vi.fn(async () => undefined),
		mediaHandler: {
			videoProducer: {} as never,
			audioProducer: {} as never,
		},
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
		await Promise.resolve();
		expect(sfuManager.value.reconfigureForE2EE).not.toHaveBeenCalled();

		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);
		await enablePromise;

		expect(sfuClient.setE2EERequired).toHaveBeenCalledWith(true);
		expect(sfuClient.refreshToken).toHaveBeenCalled();
		expect(sfuClient.joinRoom).toHaveBeenCalled();
		expect(sfuManager.value.reconfigureForE2EE).toHaveBeenCalled();
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
});
