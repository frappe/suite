import type { Ref } from "vue";
import type { CurrentUser } from "../../composables/useCurrentUser";
import type { MediaState } from "../../composables/useMediaState";
import type { SFUClient } from "../SFUClient";
import { waitForE2EEContextReady } from "./E2EEContextReady";
import type { SFUMeetingManager } from "../SFUMeetingManager";
import type { E2EEEpochSignalingController } from "./E2EEEpochSignalingController";
import {
	getActiveEpochState,
	installActiveEpochState,
	wipeActiveEpochState,
} from "./E2EEEpochStateStore";
import { E2EEMeeting } from "./E2EEMeeting";
import {
	type EpochProtocolProvider,
	TsMlsEpochProtocolProvider,
} from "./EpochProtocolProvider";
import { bufferToBase64, bytesFromBase64 } from "./e2eePrimitives";

interface E2EEHandshakeControllerDeps {
	meetingId: string;
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	currentUser: CurrentUser;
	mediaState: MediaState;
	isCurrentTabHost: Ref<boolean>;
	getDeviceIdentity: () => Promise<{
		deviceId: string;
		signingPublicKey: string;
		signingKeyPair: CryptoKeyPair;
	}>;
	epochSignalingController?: E2EEEpochSignalingController;
	enableCollectionTimeoutMs?: number;
	epochProtocolProvider?: EpochProtocolProvider;
}

export class E2EEHandshakeController {
	private readonly deps: E2EEHandshakeControllerDeps;
	private readonly epochProtocolProvider: EpochProtocolProvider;
	meetingSecret: Uint8Array<ArrayBuffer> | null = null;
	keyVersion: number | null = null;
	isReconfiguringForE2EE = false;

	onHandshakeComplete:
		| ((detail: {
				meetingId: string;
				meetingSecret: Uint8Array<ArrayBuffer>;
				keyVersion: number;
				signingPrivateKey: CryptoKey;
		  }) => void)
		| null = null;

	constructor(deps: E2EEHandshakeControllerDeps) {
		this.deps = deps;
		this.epochProtocolProvider =
			deps.epochProtocolProvider ?? new TsMlsEpochProtocolProvider();
	}

	private get meetingId(): string {
		return this.deps.meetingId;
	}

	private get sfuClient(): SFUClient {
		return this.deps.sfuClient;
	}

	private get sfuManager(): Ref<SFUMeetingManager | null> {
		return this.deps.sfuManager;
	}

	private get currentUser(): CurrentUser {
		return this.deps.currentUser;
	}

	private get mediaState(): MediaState {
		return this.deps.mediaState;
	}

	private get getDeviceIdentity(): E2EEHandshakeControllerDeps["getDeviceIdentity"] {
		return this.deps.getDeviceIdentity;
	}

	private ownParticipantId(): string {
		return this.currentUser.currentUser.value?.user_id ?? "";
	}

	wipeRuntimeState(): void {
		this.meetingSecret?.fill(0);
		this.meetingSecret = null;
		this.keyVersion = null;
		wipeActiveEpochState();
		E2EEMeeting.instance.wipeMeetingContext();
	}

	teardownForDisconnect(): void {
		this.wipeRuntimeState();
	}

	async handleHostE2EEKeySet(_detail: { keyVersion?: string }): Promise<void> {
		console.log("[DEBUG-e2ee] handleHostE2EEKeySet: enter", {
			detail: _detail,
		});
		const hasMembers = await this.collectMembersAndCreateGenesisEpoch();
		if (!hasMembers) {
			await this.generateHostMeetingSecret();
		}
		console.log("[DEBUG-e2ee] handleHostE2EEKeySet: genesis complete", {
			epochNumber: this.keyVersion,
			hadMembers: hasMembers,
		});
		if (this.isReconfiguringForE2EE) return;
		this.isReconfiguringForE2EE = true;
		try {
			this.sfuClient.setE2EERequired(true);
			await this.reconfigureMediaForE2EE();
		} catch (error) {
			console.error("Failed to reconfigure host for E2EE:", error);
		} finally {
			this.isReconfiguringForE2EE = false;
		}
	}

	private async collectMembersAndCreateGenesisEpoch(): Promise<boolean> {
		if (!this.deps.epochSignalingController) {
			console.log(
				"[DEBUG-e2ee] collectMembersAndCreateGenesisEpoch: no signaling controller, skipping collection",
			);
			return false;
		}
		const expectedSenderIds = await this.listCurrentNonHostSenderIds();
		if (expectedSenderIds.length === 0) {
			console.log(
				"[DEBUG-e2ee] collectMembersAndCreateGenesisEpoch: no existing members to collect",
			);
			return false;
		}
		console.log(
			"[DEBUG-e2ee] collectMembersAndCreateGenesisEpoch: broadcasting key-package-request",
			{ expectedSenderIds },
		);
		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "key-package-request",
			epochNumber: 1,
			reason: "enable",
		});

		const collected = await this.waitForKeyPackages(
			expectedSenderIds,
			this.deps.enableCollectionTimeoutMs ?? 15000,
		);
		console.log("[DEBUG-e2ee] collectMembersAndCreateGenesisEpoch: collected", {
			collected: Array.from(collected.keys()),
			missing: expectedSenderIds.filter((id) => !collected.has(id)),
		});
		if (collected.size === 0) {
			console.warn(
				"[DEBUG-e2ee] collectMembersAndCreateGenesisEpoch: no key packages received, falling back to host-only genesis",
			);
			return false;
		}

		const identity = await this.getDeviceIdentity();
		const userId = this.ownParticipantId();
		const hostSenderId = this.sfuClient.getOwnSenderId?.() ?? 0;
		await this.generateHostMeetingSecret();
		const collectedSenderIds = Array.from(collected.keys()).sort(
			(a, b) => a - b,
		);
		const decodedKeyPackages = collectedSenderIds.map((senderId) => {
			const cached = collected.get(senderId);
			return this.epochProtocolProvider.decodeKeyPackage(
				bytesFromBase64(cached?.keyPackage ?? ""),
			);
		});
		const activeEpoch = getActiveEpochState();
		if (!activeEpoch) {
			console.warn(
				"[DEBUG-e2ee] collectMembersAndCreateGenesisEpoch: no active epoch after genesis",
			);
			return false;
		}
		const result = await this.epochProtocolProvider.addMultipleMembers(
			activeEpoch.state,
			decodedKeyPackages,
		);
		installActiveEpochState({
			epochNumber: result.epoch.epochNumber,
			state: result.epoch.state,
			meetingSecret: result.epoch.meetingSecret,
		});
		this.keyVersion = result.epoch.epochNumber;
		this.meetingSecret = result.epoch.meetingSecret;
		this.onHandshakeComplete?.({
			meetingId: this.meetingId,
			meetingSecret: result.epoch.meetingSecret,
			keyVersion: result.epoch.epochNumber,
			signingPrivateKey: identity.signingKeyPair.privateKey,
		});
		await this.deps.epochSignalingController?.syncSenderSigningPubs(
			result.epoch.state,
		);
		const fromParticipantId = userId;
		const previousEpochNumber = activeEpoch.epochNumber;
		const epochNumber = result.epoch.epochNumber;
		const membershipDeltaId = `add-${collectedSenderIds.join("-")}-to-${epochNumber}`;
		const membershipDeltaHash = bufferToBase64(
			new TextEncoder().encode(
				JSON.stringify({
					type: "add",
					senderIds: collectedSenderIds,
					nextEpochNumber: epochNumber,
				}),
			),
		);
		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "commit",
			fromParticipantId,
			fromSenderId: hostSenderId,
			previousEpochNumber,
			epochNumber,
			membershipDeltaId,
			membershipDeltaHash,
			rosterHash: membershipDeltaHash,
			mlsCommit: bufferToBase64(
				this.epochProtocolProvider.encodeCommit(result.commit),
			),
		});
		for (const senderId of collectedSenderIds) {
			const cached = collected.get(senderId);
			if (!cached) continue;
			this.deps.sfuClient.sendE2EEEpochEnvelope({
				type: "welcome",
				fromParticipantId,
				fromSenderId: hostSenderId,
				toParticipantId: cached.participantId,
				toSenderId: cached.senderId,
				epochNumber,
				mlsWelcome: bufferToBase64(
					this.epochProtocolProvider.encodeWelcome(result.welcome),
				),
			});
		}
		return true;
	}

	private async listCurrentNonHostSenderIds(): Promise<number[]> {
		try {
			const participants = (await this.deps.sfuClient.getRoomParticipants()) as
				| Array<{
						user_id?: string;
						sender_id?: number;
						senderId?: number;
						is_host?: boolean;
						isHost?: boolean;
					}>
				| undefined;
			if (!Array.isArray(participants)) return [];
			const hostParticipantId = this.ownParticipantId();
			return participants
				.filter((p) => {
					const senderId = p.sender_id ?? p.senderId;
					return (
						typeof senderId === "number" &&
						p.is_host !== true &&
						p.isHost !== true &&
						p.user_id !== hostParticipantId
					);
				})
				.map((p) => (p.sender_id ?? p.senderId) as number);
		} catch (error) {
			console.warn(
				"[DEBUG-e2ee] listCurrentNonHostSenderIds: getRoomParticipants failed",
				error,
			);
			return [];
		}
	}

	private async waitForKeyPackages(
		expectedSenderIds: number[],
		timeoutMs: number,
	): Promise<
		Map<
			number,
			{
				senderId: number;
				participantId: string;
				keyPackage: string;
				epochNumber: number;
			}
		>
	> {
		const out = new Map<
			number,
			{
				senderId: number;
				participantId: string;
				keyPackage: string;
				epochNumber: number;
			}
		>();
		const expected = new Set(expectedSenderIds);
		const signaling = this.deps.epochSignalingController;
		if (!signaling) return out;
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const cache = signaling.getReceivedKeyPackagesBySenderId();
			for (const senderId of expected) {
				if (out.has(senderId)) continue;
				const entry = cache.get(senderId);
				if (!entry) continue;
				out.set(senderId, { senderId, ...entry });
			}
			if (out.size === expected.size) break;
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(250, timeoutMs / 6)),
			);
		}
		return out;
	}

	async generateHostMeetingSecret(): Promise<void> {
		const identity = await this.getDeviceIdentity();
		const genesis = await this.epochProtocolProvider.createGenesisEpoch({
			groupId: this.meetingId,
			userId: this.ownParticipantId(),
			deviceId: identity.deviceId,
			senderId: this.sfuClient.getOwnSenderId?.() ?? 0,
			signingPubKey: identity.signingPublicKey,
		});
		this.keyVersion = genesis.epochNumber;
		this.meetingSecret = genesis.meetingSecret;
		installActiveEpochState({
			epochNumber: genesis.epochNumber,
			state: genesis.state,
			meetingSecret: genesis.meetingSecret,
		});
		this.onHandshakeComplete?.({
			meetingId: this.meetingId,
			meetingSecret: genesis.meetingSecret,
			keyVersion: genesis.epochNumber,
			signingPrivateKey: identity.signingKeyPair.privateKey,
		});
		this.acknowledgeEpoch(genesis.epochNumber);
	}

	private acknowledgeEpoch(epochNumber: number): void {
		const fromParticipantId = this.ownParticipantId();
		const fromSenderId = this.sfuClient.getOwnSenderId?.();
		if (!fromParticipantId || fromSenderId === null || fromSenderId === undefined) {
			return;
		}
		this.sfuClient.sendE2EEEpochEnvelope({
			type: "ack",
			fromParticipantId,
			fromSenderId,
			epochNumber,
		});
	}

	setMeetingContext(
		meetingSecret: Uint8Array<ArrayBuffer>,
		keyVersion: number,
		signingPrivateKey: CryptoKey,
	): void {
		this.meetingSecret = meetingSecret;
		this.keyVersion = keyVersion;
		E2EEMeeting.instance.setMeetingContext(
			meetingSecret,
			keyVersion,
			signingPrivateKey,
		);
	}

	handleSFUReconnect(): void {
		if (this.deps.isCurrentTabHost.value) return;
		this.wipeRuntimeState();
		this.sfuClient.sendE2EEEpochEnvelope({
			type: "resync-request",
			fromParticipantId: this.ownParticipantId(),
			fromSenderId: this.sfuClient.getOwnSenderId?.() ?? 0,
			knownEpochNumber: this.keyVersion ?? undefined,
		});
	}

	/**
	 * Transient socket reconnect: the SFU socket reconnected to the same
	 * meeting. Do NOT wipe the in-memory meeting secret or pending key
	 * packages — the relay can replay retained commits/welcomes and the
	 * client can re-join via processCommit / processWelcome.
	 */
	handleTransientReconnect(): void {
		if (this.deps.isCurrentTabHost.value) return;
		console.log("[DEBUG-e2ee] handleTransientReconnect: requesting resync", {
			knownEpochNumber: this.keyVersion ?? null,
		});
		this.sfuClient.sendE2EEEpochEnvelope({
			type: "resync-request",
			fromParticipantId: this.ownParticipantId(),
			fromSenderId: this.sfuClient.getOwnSenderId?.() ?? 0,
			knownEpochNumber: this.keyVersion ?? undefined,
		});
	}

	async handleMeetingE2EEEnabled(data: { meeting_id?: string }): Promise<void> {
		if (data.meeting_id !== this.meetingId) return;
		if (this.deps.isCurrentTabHost.value) return;
		this.sfuClient.setE2EERequired(true);
		if (this.isReconfiguringForE2EE) return;
		const manager = this.sfuManager.value;
		if (
			manager &&
			!manager.mediaHandler?.videoProducer &&
			!manager.mediaHandler?.audioProducer
		) {
			console.log(
				"[DEBUG-e2ee] handleMeetingE2EEEnabled: skipping reconfiguration, initial setup will create E2EE producers natively",
			);
			return;
		}
		this.isReconfiguringForE2EE = true;
		try {
			await waitForE2EEContextReady();
			await this.reconfigureMediaForE2EE();
		} catch (error) {
			console.error("Failed to reconfigure participant for E2EE:", error);
		} finally {
			this.isReconfiguringForE2EE = false;
		}
	}

	private async reconfigureMediaForE2EE(): Promise<void> {
		if (!this.sfuClient?.isConnected?.()) return;

		const hadCamera = this.mediaState.isCameraOn;
		const hadMic = this.mediaState.isMicOn;
		const videoStreamForRepublish =
			this.mediaState.processedStream || this.mediaState.localStream;
		const audioStreamForRepublish = this.mediaState.localStream;

		try {
			await this.sfuClient.refreshToken();
		} catch (error) {
			console.warn(
				"[DEBUG-e2ee] reconfigureMediaForE2EE: token refresh failed, proceeding with existing token",
				error,
			);
		}
		await this.sfuClient.joinRoom(
			this.meetingId,
			{
				userId: this.currentUser.currentUser.value?.user_id || "",
				name:
					this.currentUser.currentUser.value?.full_name ||
					this.currentUser.currentUser.value?.name ||
					"",
				avatar: this.currentUser.currentUser.value?.avatar || null,
				is_guest: this.currentUser.currentUser.value?.is_guest || false,
			},
			{
				audio_enabled: this.mediaState.isMicOn,
				video_enabled: this.mediaState.isCameraOn,
			},
		);

		if (this.sfuManager.value) {
			await this.sfuManager.value.reconfigureForE2EE(
				videoStreamForRepublish,
				audioStreamForRepublish,
			);
		}

		if (!videoStreamForRepublish || !audioStreamForRepublish) {
			document.dispatchEvent(
				new CustomEvent("meet:e2ee-needs-media-republish", {
					detail: { hadCamera, hadMic },
				}),
			);
		}
	}
}
