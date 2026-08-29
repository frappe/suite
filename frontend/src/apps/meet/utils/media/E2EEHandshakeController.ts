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

const isAbortError = (error: unknown) =>
	(error as { name?: unknown } | null)?.name === "AbortError";

const abortReason = (signal: AbortSignal) =>
	signal.reason ?? new DOMException("E2EE lifecycle ended", "AbortError");

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw abortReason(signal);
}

function waitWithSignal(timeoutMs: number, signal: AbortSignal): Promise<void> {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortReason(signal));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, timeoutMs);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function raceWithSignal<T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(abortReason(signal));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}

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
	private lifecycleController = new AbortController();
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
		this.lifecycleController.abort(
			new DOMException("E2EE lifecycle ended", "AbortError"),
		);
		this.wipeRuntimeState();
	}

	private startLifecycle(): AbortSignal {
		if (this.lifecycleController.signal.aborted) {
			this.lifecycleController = new AbortController();
			this.isReconfiguringForE2EE = false;
		}
		return this.lifecycleController.signal;
	}

	async handleHostE2EEKeySet(_detail: { keyVersion?: string }): Promise<void> {
		const signal = this.startLifecycle();
		console.log("[DEBUG-e2ee] handleHostE2EEKeySet: enter", {
			detail: _detail,
		});
		let hasMembers: boolean;
		try {
			hasMembers = await this.collectMembersAndCreateGenesisEpoch(signal);
			if (!hasMembers) {
				await this.generateHostMeetingSecret(signal);
			}
		} catch (error) {
			if (signal.aborted && isAbortError(error)) return;
			throw error;
		}
		console.log("[DEBUG-e2ee] handleHostE2EEKeySet: genesis complete", {
			epochNumber: this.keyVersion,
			hadMembers: hasMembers,
		});
		if (this.isReconfiguringForE2EE) return;
		this.isReconfiguringForE2EE = true;
		try {
			throwIfAborted(signal);
			this.sfuClient.setE2EERequired(true);
			await this.reconfigureMediaForE2EE(signal);
		} catch (error) {
			if (!(signal.aborted && isAbortError(error))) {
				console.error("Failed to reconfigure host for E2EE:", error);
			}
		} finally {
			if (this.lifecycleController.signal === signal) {
				this.isReconfiguringForE2EE = false;
			}
		}
	}

	private async collectMembersAndCreateGenesisEpoch(
		signal: AbortSignal,
	): Promise<boolean> {
		if (!this.deps.epochSignalingController) {
			console.log(
				"[DEBUG-e2ee] collectMembersAndCreateGenesisEpoch: no signaling controller, skipping collection",
			);
			return false;
		}
		const expectedSenderIds = await this.listCurrentNonHostSenderIds(signal);
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
			signal,
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
		throwIfAborted(signal);
		const userId = this.ownParticipantId();
		const hostSenderId = this.sfuClient.getOwnSenderId?.() ?? 0;
		await this.generateHostMeetingSecret(signal);
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
		throwIfAborted(signal);
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
		throwIfAborted(signal);
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

	private async listCurrentNonHostSenderIds(
		signal: AbortSignal,
	): Promise<number[]> {
		try {
			const participants = await this.deps.sfuClient.getRoomParticipants();
			throwIfAborted(signal);
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
				.flatMap((p) => {
					const senderId = p.sender_id ?? p.senderId;
					return typeof senderId === "number" ? [senderId] : [];
				});
		} catch (error) {
			if (signal.aborted && isAbortError(error)) throw error;
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
		signal: AbortSignal,
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
			throwIfAborted(signal);
			const cache = signaling.getReceivedKeyPackagesBySenderId();
			for (const senderId of expected) {
				if (out.has(senderId)) continue;
				const entry = cache.get(senderId);
				if (!entry) continue;
				out.set(senderId, { senderId, ...entry });
			}
			if (out.size === expected.size) break;
			await waitWithSignal(Math.min(250, timeoutMs / 6), signal);
		}
		return out;
	}

	async generateHostMeetingSecret(signal?: AbortSignal): Promise<void> {
		const identity = await this.getDeviceIdentity();
		if (signal) throwIfAborted(signal);
		const genesis = await this.epochProtocolProvider.createGenesisEpoch({
			groupId: this.meetingId,
			userId: this.ownParticipantId(),
			deviceId: identity.deviceId,
			senderId: this.sfuClient.getOwnSenderId?.() ?? 0,
			signingPubKey: identity.signingPublicKey,
		});
		if (signal) throwIfAborted(signal);
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
		if (
			!fromParticipantId ||
			fromSenderId === null ||
			fromSenderId === undefined
		) {
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
		const signal = this.startLifecycle();
		this.sfuClient.setE2EERequired(true);
		if (this.isReconfiguringForE2EE) return;
		const manager = this.sfuManager.value;
		if (manager && !manager.hasLocalMediaPublications()) {
			console.log(
				"[DEBUG-e2ee] handleMeetingE2EEEnabled: skipping reconfiguration, initial setup will create E2EE producers natively",
			);
			return;
		}
		this.isReconfiguringForE2EE = true;
		try {
			await raceWithSignal(waitForE2EEContextReady(), signal);
			await this.reconfigureMediaForE2EE(signal);
		} catch (error) {
			if (!(signal.aborted && isAbortError(error))) {
				console.error("Failed to reconfigure participant for E2EE:", error);
			}
		} finally {
			if (this.lifecycleController.signal === signal) {
				this.isReconfiguringForE2EE = false;
			}
		}
	}

	private async reconfigureMediaForE2EE(
		signal: AbortSignal = this.startLifecycle(),
	): Promise<void> {
		throwIfAborted(signal);
		if (!this.sfuClient?.isConnected?.()) return;

		try {
			await this.sfuClient.refreshToken();
			throwIfAborted(signal);
		} catch (error) {
			if (signal.aborted || isAbortError(error)) throw error;
			console.warn(
				"[DEBUG-e2ee] reconfigureMediaForE2EE: token refresh failed, proceeding with existing token",
				error,
			);
		}
		await this.sfuManager.value?.rejoinParticipantConnection(
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
		throwIfAborted(signal);
		const needsCameraMedia = this.mediaState.isCameraOn;
		const needsMicrophoneMedia = this.mediaState.isMicOn;
		const processedStream = this.mediaState.processedStream;
		const localStream = this.mediaState.localStream;
		const hasLiveProcessedVideo =
			typeof processedStream?.getVideoTracks === "function" &&
			processedStream
				.getVideoTracks()
				.some((track) => track.readyState === "live");
		const hasLiveRawVideo =
			typeof localStream?.getVideoTracks === "function" &&
			localStream.getVideoTracks().some((track) => track.readyState === "live");
		const hasLiveAudio =
			typeof localStream?.getAudioTracks === "function" &&
			localStream.getAudioTracks().some((track) => track.readyState === "live");
		const videoStreamForRepublish = needsCameraMedia
			? hasLiveProcessedVideo
				? processedStream
				: hasLiveRawVideo
					? localStream
					: null
			: null;
		const audioStreamForRepublish =
			needsMicrophoneMedia && hasLiveAudio ? localStream : null;

		let publicationResult = {
			videoPublished: false,
			audioPublished: false,
		};
		if (this.sfuManager.value) {
			publicationResult = await this.sfuManager.value.reconfigureForE2EE(
				videoStreamForRepublish,
				audioStreamForRepublish,
				signal,
			);
		}
		throwIfAborted(signal);

		const needsCamera =
			this.mediaState.isCameraOn && !publicationResult.videoPublished;
		const needsMicrophone =
			this.mediaState.isMicOn && !publicationResult.audioPublished;
		if (needsCamera || needsMicrophone) {
			document.dispatchEvent(
				new CustomEvent("meet:e2ee-needs-media-republish", {
					detail: { needsCamera, needsMicrophone },
				}),
			);
		}
	}
}
