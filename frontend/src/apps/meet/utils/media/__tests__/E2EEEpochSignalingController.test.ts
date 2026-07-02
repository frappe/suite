import { describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import { E2EEEpochSignalingController } from "../E2EEEpochSignalingController";
import {
	getActiveEpochState,
	installActiveEpochState,
	wipeActiveEpochState,
} from "../E2EEEpochStateStore";

function createController(options: { isHost?: boolean } = {}) {
	const sendE2EEEpochEnvelope = vi.fn();
	const generateKeyPackage = vi.fn(async () => ({
		publicPackage: { id: "public-package" } as never,
		privatePackage: { id: "private-package" } as never,
	}));
	const addMember = vi.fn(async () => ({
		epochNumber: 2,
		state: { id: "epoch-2-state" } as never,
		encodedState: new Uint8Array([8]),
		meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
		commit: { id: "commit" } as never,
		welcome: { id: "welcome" } as never,
	}));
	const addMultipleMembers = vi.fn(
		async (state: unknown, joiningMembers: unknown[]) => {
			expect(Array.isArray(joiningMembers)).toBe(true);
			return {
				commit: { id: "commit" } as never,
				welcome: { id: "welcome" } as never,
				epoch: {
					epochNumber: 2,
					state: state as never,
					encodedState: new Uint8Array([8]),
					meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
				},
			};
		},
	);
	const encodeKeyPackage = vi.fn(
		(_keyPackage: unknown) => new Uint8Array([1, 2, 3]),
	);
	const decodeKeyPackage = vi.fn(
		(_encoded: Uint8Array) =>
			({
				id: "decoded-key-package",
			}) as never,
	);
	const encodeCommit = vi.fn((_commit: unknown) => new Uint8Array([4, 5, 6]));
	const encodeWelcome = vi.fn((_welcome: unknown) => new Uint8Array([7, 8, 9]));
	const decodeWelcome = vi.fn(
		(_encoded: Uint8Array) =>
			({
				id: "decoded-welcome",
			}) as never,
	);
	const joinFromWelcome = vi.fn(async () => ({
		epochNumber: 2,
		state: { id: "joined-epoch-2-state" } as never,
		encodedState: new Uint8Array([10]),
		meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
	}));
	const processCommit = vi.fn();
	const removeMember = vi.fn(async (state: unknown, leafIndex: number) => ({
		commit: { id: "commit" } as never,
		epoch: {
			epochNumber: 3,
			state: state as never,
			encodedState: new Uint8Array([11]),
			meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			_removedLeaf: leafIndex,
		},
	}));
	const createGenesisEpoch = vi.fn(async () => ({
		epochNumber: 1,
		state: { id: "genesis-state" } as never,
		encodedState: new Uint8Array([12]),
		meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
	}));
	const controller = new E2EEEpochSignalingController({
		meetingId: "meeting-1",
		sfuClient: {
			getOwnSenderId: vi.fn(() => 7),
			sendE2EEEpochEnvelope,
		} as never,
		currentUser: {
			currentUser: shallowRef({ user_id: "user-1" }),
		} as never,
		isCurrentTabHost: shallowRef(Boolean(options.isHost)),
		getDeviceIdentity: vi.fn(async () => ({
			deviceId: "device-1",
			signingPublicKey: "signing-public-key",
			signingKeyPair: { privateKey: {} as CryptoKey } as CryptoKeyPair,
		})),
		epochProtocolProvider: {
			createGenesisEpoch,
			createGenesisEpochWithMembers: vi.fn(),
			generateKeyPackage,
			encodeKeyPackage,
			decodeKeyPackage,
			encodeCommit,
			encodeWelcome,
			decodeWelcome,
			addMember,
			addMultipleMembers,
			removeMember,
			joinFromWelcome,
			processCommit,
			exportMeetingSecret: vi.fn(),
		},
	});
	return {
		controller,
		sendE2EEEpochEnvelope,
		generateKeyPackage,
		addMember,
		addMultipleMembers,
		removeMember,
		joinFromWelcome,
		processCommit,
		createGenesisEpoch,
	};
}

describe("E2EEEpochSignalingController", () => {
	it("rejects malformed epoch envelopes before processing", async () => {
		const { controller, generateKeyPackage } = createController();

		await controller.handleEpochEnvelope({
			type: "key-package-request",
			epochNumber: "1",
			reason: "join",
		});

		expect(generateKeyPackage).not.toHaveBeenCalled();
	});

	it("logs only redacted epoch envelope metadata", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const { controller } = createController();

		await controller.handleEpochEnvelope({
			type: "key-package-request",
			epochNumber: 1,
			reason: "join",
		});

		expect(log).toHaveBeenCalledWith(
			"[DEBUG-e2ee] epoch envelope received",
			expect.not.objectContaining({ envelope: expect.anything() }),
		);
		log.mockRestore();
	});

	it("publishes an MLS key package when the SFU requests one", async () => {
		const { controller, sendE2EEEpochEnvelope, generateKeyPackage } =
			createController();

		await controller.handleEpochEnvelope({
			type: "key-package-request",
			epochNumber: 1,
			reason: "enable",
		});

		expect(generateKeyPackage).toHaveBeenCalledWith({
			groupId: "meeting-1",
			userId: "user-1",
			deviceId: "device-1",
			senderId: 7,
			signingPubKey: "signing-public-key",
		});
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith({
			type: "key-package",
			fromParticipantId: "user-1",
			fromSenderId: 7,
			epochNumber: 1,
			reason: "enable",
			keyPackage: "AQID",
		});
		expect(controller.getPendingKeyPackage(1)).not.toBeNull();
	});

	it("creates a fresh genesis epoch and acknowledges it when the SFU requests one", async () => {
		wipeActiveEpochState();
		const { controller, createGenesisEpoch, sendE2EEEpochEnvelope } =
			createController();

		await controller.handleEpochEnvelope({
			type: "genesis-request",
			epochNumber: 1,
			message: "Starting encryption for this meeting.",
		});

		expect(createGenesisEpoch).toHaveBeenCalledWith({
			groupId: "meeting-1",
			userId: "user-1",
			deviceId: "device-1",
			senderId: 7,
			signingPubKey: "signing-public-key",
		});
		expect(getActiveEpochState()?.epochNumber).toBe(1);
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith({
			type: "ack",
			fromParticipantId: "user-1",
			fromSenderId: 7,
			epochNumber: 1,
		});
		wipeActiveEpochState();
	});

	it("dispatches a pending join status event", async () => {
		const { controller } = createController();
		const listener = vi.fn();
		document.addEventListener("meet:e2ee-join-status", listener);

		await controller.handleEpochEnvelope({
			type: "join-status",
			status: "pending",
			reason: "waiting-for-host",
			epochNumber: 1,
			message: "This encrypted meeting needs the host to join before others can enter.",
		});

		expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
			status: "pending",
			reason: "waiting-for-host",
			epochNumber: 1,
			message: "This encrypted meeting needs the host to join before others can enter.",
		});
		document.removeEventListener("meet:e2ee-join-status", listener);
	});

	it("authors an add-member commit when this host is the designated committer", async () => {
		installActiveEpochState({
			epochNumber: 1,
			state: { id: "epoch-1-state" } as never,
			meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
		});
		const { controller, sendE2EEEpochEnvelope, addMultipleMembers } =
			createController({
				isHost: true,
			});

		await controller.handleEpochEnvelope({
			type: "key-package",
			fromParticipantId: "joiner-1",
			fromSenderId: 9,
			epochNumber: 1,
			keyPackage: "AQID",
		});
		await controller.handleEpochEnvelope({
			type: "commit-request",
			epochNumber: 1,
			nextEpochNumber: 2,
			membershipDeltaId: "delta-1",
			membershipDeltaHash: "ZGVsdGE=",
			rosterHash: "cm9zdGVy",
			committerSenderId: 7,
			joiningSenderIds: [9],
		});

		expect(addMultipleMembers).toHaveBeenCalled();
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "commit",
				previousEpochNumber: 1,
				epochNumber: 2,
				mlsCommit: "BAUG",
			}),
		);
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "welcome",
				toParticipantId: "joiner-1",
				toSenderId: 9,
				epochNumber: 2,
				mlsWelcome: "BwgJ",
			}),
		);
		wipeActiveEpochState();
	});

	it("joins from a targeted welcome and acknowledges the installed epoch", async () => {
		const { controller, sendE2EEEpochEnvelope, joinFromWelcome } =
			createController();

		await controller.handleEpochEnvelope({
			type: "key-package-request",
			epochNumber: 1,
			reason: "join",
		});
		await controller.handleEpochEnvelope({
			type: "welcome",
			fromParticipantId: "host-1",
			fromSenderId: 7,
			toParticipantId: "user-1",
			toSenderId: 7,
			epochNumber: 2,
			mlsWelcome: "BwgJ",
		});

		expect(joinFromWelcome).toHaveBeenCalled();
		expect(controller.getPendingKeyPackage(1)).toBeNull();
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith({
			type: "ack",
			fromParticipantId: "user-1",
			fromSenderId: 7,
			epochNumber: 2,
		});
		wipeActiveEpochState();
	});

	it("quietly ignores reflected self-authored commits after local epoch advance", async () => {
		installActiveEpochState({
			epochNumber: 2,
			state: { id: "epoch-2-state" } as never,
			meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { controller, processCommit } = createController();

		await controller.handleEpochEnvelope({
			type: "commit",
			fromParticipantId: "user-1",
			fromSenderId: 7,
			previousEpochNumber: 1,
			epochNumber: 2,
			membershipDeltaId: "delta-1",
			membershipDeltaHash: "ZGVsdGE=",
			rosterHash: "cm9zdGVy",
			mlsCommit: "BAUG",
		});

		expect(processCommit).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalledWith(
			"[DEBUG-e2ee] processCommit: epoch mismatch, abort",
		);
		warn.mockRestore();
		wipeActiveEpochState();
	});

	it("authors an add-member commit when a non-host tab is the designated committer", async () => {
		installActiveEpochState({
			epochNumber: 1,
			state: { id: "epoch-1-state" } as never,
			meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
		});
		// Same senderId 7, but isCurrentTabHost is now false — a non-host
		// current member tab is the designated committer.
		const { controller, sendE2EEEpochEnvelope, addMultipleMembers } =
			createController({
				isHost: false,
			});

		await controller.handleEpochEnvelope({
			type: "key-package",
			fromParticipantId: "joiner-1",
			fromSenderId: 9,
			epochNumber: 1,
			keyPackage: "AQID",
		});
		await controller.handleEpochEnvelope({
			type: "commit-request",
			epochNumber: 1,
			nextEpochNumber: 2,
			membershipDeltaId: "delta-1",
			membershipDeltaHash: "ZGVsdGE=",
			rosterHash: "cm9zdGVy",
			committerSenderId: 7,
			joiningSenderIds: [9],
		});

		expect(addMultipleMembers).toHaveBeenCalled();
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "commit",
				previousEpochNumber: 1,
				epochNumber: 2,
			}),
		);
		wipeActiveEpochState();
	});

	it("authors a remove commit when a remove-only commit-request arrives", async () => {
		// Mock the ratchet tree: only the committer (senderId 7) is a member.
		// The other leaf (senderId 9) is the to-be-removed participant.
		const mockTree: unknown[] = [
			{
				nodeType: "leaf",
				leaf: {
					credential: {
						credentialType: "basic",
						identity: new TextEncoder().encode(
							JSON.stringify({ senderId: 7, userId: "user-1" }),
						),
					},
				},
			},
			undefined,
			{
				nodeType: "leaf",
				leaf: {
					credential: {
						credentialType: "basic",
						identity: new TextEncoder().encode(
							JSON.stringify({ senderId: 9, userId: "user-2" }),
						),
					},
				},
			},
			undefined,
		];
		installActiveEpochState({
			epochNumber: 2,
			state: { ratchetTree: mockTree } as never,
			meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
		});
		const { controller, sendE2EEEpochEnvelope, removeMember } =
			createController({
				isHost: true,
			});

		await controller.handleEpochEnvelope({
			type: "commit-request",
			epochNumber: 2,
			nextEpochNumber: 3,
			membershipDeltaId: "remove-9-to-3",
			membershipDeltaHash: "cmVtb3Zl",
			rosterHash: "cm9zdGVy",
			committerSenderId: 7,
			joiningSenderIds: [],
			removedSenderIds: [9],
		});

		expect(removeMember).toHaveBeenCalled();
		expect(
			sendE2EEEpochEnvelope.mock.calls.some(
				(call) =>
					Array.isArray(call) &&
					call[0] &&
					typeof call[0] === "object" &&
					call[0].type === "commit" &&
					call[0].epochNumber === 3,
			),
		).toBe(true);
		expect(
			sendE2EEEpochEnvelope.mock.calls.some(
				(call) =>
					Array.isArray(call) &&
					call[0] &&
					typeof call[0] === "object" &&
					call[0].type === "welcome",
			),
		).toBe(false);
		wipeActiveEpochState();
	});
});
