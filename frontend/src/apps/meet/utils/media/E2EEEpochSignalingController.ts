import { getGroupMembers } from "ts-mls/clientState.js";
import { decodeMlsMessage } from "ts-mls/message.js";
import { getCredentialFromLeafIndex } from "ts-mls/ratchetTree.js";
import type { Ref } from "vue";
import type { CurrentUser } from "../../composables/useCurrentUser";
import type { SFUClient } from "../SFUClient";
import type { E2eeEpochEnvelope } from "./E2EEEpochSignaling";
import {
	getActiveEpochState,
	installActiveEpochState,
} from "./E2EEEpochStateStore";
import { E2EEMeeting } from "./E2EEMeeting";
import {
	type EpochProtocolProvider,
	TsMlsEpochProtocolProvider,
} from "./EpochProtocolProvider";
import { bufferToBase64, bytesFromBase64 } from "./e2eePrimitives";

type DeviceIdentity = {
	deviceId: string;
	signingPublicKey: string;
	signingKeyPair: CryptoKeyPair;
};

type PendingKeyPackage = Awaited<
	ReturnType<EpochProtocolProvider["generateKeyPackage"]>
>;

interface E2EEEpochSignalingControllerDeps {
	meetingId: string;
	sfuClient: SFUClient;
	currentUser: CurrentUser;
	isCurrentTabHost: Ref<boolean>;
	getDeviceIdentity: () => Promise<DeviceIdentity>;
	epochProtocolProvider?: EpochProtocolProvider;
}

export class E2EEEpochSignalingController {
	private readonly deps: E2EEEpochSignalingControllerDeps;
	private readonly epochProtocolProvider: EpochProtocolProvider;
	private readonly pendingKeyPackagesByEpoch = new Map<
		number,
		PendingKeyPackage
	>();
	private readonly receivedKeyPackagesBySenderId = new Map<
		number,
		{ epochNumber: number; participantId: string; keyPackage: string }
	>();

	constructor(deps: E2EEEpochSignalingControllerDeps) {
		this.deps = deps;
		this.epochProtocolProvider =
			deps.epochProtocolProvider ?? new TsMlsEpochProtocolProvider();
	}

	async handleEpochEnvelope(data: unknown): Promise<void> {
		if (!this.isEpochEnvelope(data)) return;
		const ownSenderId = this.deps.sfuClient.getOwnSenderId();
		console.log("[DEBUG-e2ee] epoch envelope received", {
			type: data.type,
			ownSenderId,
			isHost: this.deps.isCurrentTabHost.value,
			envelope: data,
		});
		switch (data.type) {
			case "genesis-request":
				await this.createGenesisIfNeeded(data);
				return;
			case "join-status":
				this.dispatchJoinStatus(data);
				return;
			case "key-package-request":
				await this.publishKeyPackage(data.epochNumber);
				return;
			case "commit-request":
				if (!this.shouldAuthorCommit(data.committerSenderId)) {
					console.log("[DEBUG-e2ee] ignoring commit-request (not designated)", {
						committerSenderId: data.committerSenderId,
						ownSenderId,
						isHost: this.deps.isCurrentTabHost.value,
					});
					return;
				}
				if (data.removedSenderIds && data.removedSenderIds.length > 0) {
					await this.authorRemoveCommit(data);
				} else {
					await this.authorAddMemberCommit(data);
				}
				return;
			case "key-package":
				this.receivedKeyPackagesBySenderId.set(data.fromSenderId, {
					epochNumber: data.epochNumber,
					participantId: data.fromParticipantId,
					keyPackage: data.keyPackage,
				});
				console.log("[DEBUG-e2ee] cached key-package", {
					fromSenderId: data.fromSenderId,
					fromParticipantId: data.fromParticipantId,
					epochNumber: data.epochNumber,
					cacheSize: this.receivedKeyPackagesBySenderId.size,
				});
				return;
			case "commit":
				this.clearJoinStatus();
				await this.processCommit(data);
				return;
			case "ack":
			case "resync-request":
				return;
			case "welcome":
				this.clearJoinStatus();
				await this.processWelcome(data);
				return;
		}
	}

	private async createGenesisIfNeeded(
		_request: Extract<E2eeEpochEnvelope, { type: "genesis-request" }>,
	): Promise<void> {
		if (getActiveEpochState()) return;
		const senderId = this.deps.sfuClient.getOwnSenderId();
		if (senderId === null) return;
		const identity = await this.deps.getDeviceIdentity();
		const userId = this.deps.currentUser.currentUser.value?.user_id;
		if (!userId) return;

		const genesis = await this.epochProtocolProvider.createGenesisEpoch({
			groupId: this.deps.meetingId,
			userId,
			deviceId: identity.deviceId,
			senderId,
			signingPubKey: identity.signingPublicKey,
		});
		installActiveEpochState({
			epochNumber: genesis.epochNumber,
			state: genesis.state,
			meetingSecret: genesis.meetingSecret,
		});
		E2EEMeeting.instance.setMeetingContext(
			genesis.meetingSecret,
			genesis.epochNumber,
			identity.signingKeyPair.privateKey,
		);
		this.clearJoinStatus();
	}

	private dispatchJoinStatus(
		data: Extract<E2eeEpochEnvelope, { type: "join-status" }>,
	): void {
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-join-status", {
				detail: {
					status: data.status,
					epochNumber: data.epochNumber,
					message: data.message,
				},
			}),
		);
	}

	private clearJoinStatus(): void {
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-join-status", {
				detail: { status: "clear" },
			}),
		);
	}

	getPendingKeyPackage(epochNumber: number): PendingKeyPackage | null {
		return this.pendingKeyPackagesByEpoch.get(epochNumber) ?? null;
	}

	clearPendingKeyPackages(): void {
		this.pendingKeyPackagesByEpoch.clear();
		this.receivedKeyPackagesBySenderId.clear();
	}

	getReceivedKeyPackagesBySenderId(): ReadonlyMap<
		number,
		{ epochNumber: number; participantId: string; keyPackage: string }
	> {
		return this.receivedKeyPackagesBySenderId;
	}

	private async publishKeyPackage(epochNumber: number): Promise<void> {
		const senderId = this.deps.sfuClient.getOwnSenderId();
		if (senderId === null) {
			console.warn(
				"[DEBUG-e2ee] publishKeyPackage aborted: ownSenderId is null",
				{
					epochNumber,
				},
			);
			return;
		}

		const identity = await this.deps.getDeviceIdentity();
		const userId = this.deps.currentUser.currentUser.value?.user_id;
		if (!userId) return;

		const keyPackage = await this.epochProtocolProvider.generateKeyPackage({
			groupId: this.deps.meetingId,
			userId,
			deviceId: identity.deviceId,
			senderId,
			signingPubKey: identity.signingPublicKey,
		});
		this.pendingKeyPackagesByEpoch.set(epochNumber, keyPackage);

		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "key-package",
			fromParticipantId: userId,
			fromSenderId: senderId,
			epochNumber,
			keyPackage: bufferToBase64(
				this.epochProtocolProvider.encodeKeyPackage(keyPackage.publicPackage),
			),
		});
	}

	private shouldAuthorCommit(committerSenderId: number): boolean {
		// The SFU roster picks the committer: prefer host, fall back to oldest
		// current member. Any current member tab can author a commit; the SFU
		// validates the committer against the roster in slice 3.
		return this.deps.sfuClient.getOwnSenderId() === committerSenderId;
	}

	private async authorAddMemberCommit(
		request: Extract<E2eeEpochEnvelope, { type: "commit-request" }>,
	): Promise<void> {
		const activeEpoch = getActiveEpochState();
		console.log("[DEBUG-e2ee] authorAddMemberCommit: enter", {
			requestEpochNumber: request.epochNumber,
			activeEpochNumber: activeEpoch?.epochNumber ?? null,
			receivedCacheSize: this.receivedKeyPackagesBySenderId.size,
		});
		if (!activeEpoch || activeEpoch.epochNumber !== request.epochNumber) {
			console.warn(
				"[DEBUG-e2ee] authorAddMemberCommit: epoch mismatch, abort",
				{
					activeEpochNumber: activeEpoch?.epochNumber ?? null,
					requestEpochNumber: request.epochNumber,
				},
			);
			return;
		}

		const joiningPackages = this.collectJoiningKeyPackages(
			request.joiningSenderIds,
			request.epochNumber,
		);
		if (
			joiningPackages.length !== request.joiningSenderIds.length ||
			joiningPackages.length === 0
		) {
			console.warn(
				"[DEBUG-e2ee] authorAddMemberCommit: missing key packages for named joiners",
				{
					requested: request.joiningSenderIds,
					missing: request.joiningSenderIds.filter(
						(id) => !this.receivedKeyPackagesBySenderId.has(id),
					),
				},
			);
			return;
		}

		const decodedKeyPackages = joiningPackages.map((p) =>
			this.epochProtocolProvider.decodeKeyPackage(
				bytesFromBase64(p.keyPackage),
			),
		);
		const result = await this.epochProtocolProvider.addMultipleMembers(
			activeEpoch.state,
			decodedKeyPackages,
		);
		const identity = await this.deps.getDeviceIdentity();

		installActiveEpochState({
			epochNumber: result.epoch.epochNumber,
			state: result.epoch.state,
			meetingSecret: result.epoch.meetingSecret,
		});
		E2EEMeeting.instance.setMeetingContext(
			result.epoch.meetingSecret,
			result.epoch.epochNumber,
			identity.signingKeyPair.privateKey,
		);
		await this.syncSenderSigningPubs(result.epoch.state);

		const fromSenderId = this.deps.sfuClient.getOwnSenderId();
		const fromParticipantId = this.deps.currentUser.currentUser.value?.user_id;
		if (fromSenderId === null || !fromParticipantId) return;

		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "commit",
			fromParticipantId,
			fromSenderId,
			previousEpochNumber: request.epochNumber,
			epochNumber: result.epoch.epochNumber,
			membershipDeltaId: request.membershipDeltaId,
			membershipDeltaHash: request.membershipDeltaHash,
			rosterHash: request.rosterHash,
			mlsCommit: bufferToBase64(
				this.epochProtocolProvider.encodeCommit(result.commit),
			),
		});
		for (const joiner of joiningPackages) {
			this.deps.sfuClient.sendE2EEEpochEnvelope({
				type: "welcome",
				fromParticipantId,
				fromSenderId,
				toParticipantId: joiner.participantId,
				toSenderId: joiner.senderId,
				epochNumber: result.epoch.epochNumber,
				mlsWelcome: bufferToBase64(
					this.epochProtocolProvider.encodeWelcome(result.welcome),
				),
			});
		}
	}

	private async authorRemoveCommit(
		request: Extract<E2eeEpochEnvelope, { type: "commit-request" }>,
	): Promise<void> {
		const removedIds = request.removedSenderIds ?? [];
		if (removedIds.length === 0) {
			console.warn("[DEBUG-e2ee] authorRemoveCommit: no removedSenderIds");
			return;
		}
		const activeEpoch = getActiveEpochState();
		console.log("[DEBUG-e2ee] authorRemoveCommit: enter", {
			removedIds,
			activeEpochNumber: activeEpoch?.epochNumber ?? null,
		});
		if (!activeEpoch || activeEpoch.epochNumber !== request.epochNumber) {
			console.warn("[DEBUG-e2ee] authorRemoveCommit: epoch mismatch, abort", {
				activeEpochNumber: activeEpoch?.epochNumber ?? null,
				requestEpochNumber: request.epochNumber,
			});
			return;
		}

		// Resolve each removed senderId to a leaf index in the ratchet
		// Walk the ratchet tree's leaves. ts-mls stores leaf nodes at
		// even node indices; we use getCredentialFromLeafIndex to keep the
		// leaf-index math out of the committer code.
		const tree = activeEpoch.state.ratchetTree;
		const senderIdByLeafIndex = new Map<number, number>();
		for (let leafIndex = 0; leafIndex * 2 + 1 < tree.length; leafIndex += 1) {
			const node = tree[leafIndex * 2];
			if (!node) continue;
			const credential = getCredentialFromLeafIndex(
				tree as never,
				leafIndex as never,
			);
			if (credential.credentialType !== "basic") continue;
			const identity = JSON.parse(
				new TextDecoder().decode(credential.identity),
			);
			if (typeof identity.senderId === "number") {
				senderIdByLeafIndex.set(identity.senderId, leafIndex);
			}
		}

		// Run one remove per leaf. ts-mls commits one remove at a time;
		// for the common case (host kicks one participant) this is
		// sufficient. Multiple removes would need separate commits.
		for (const removedId of removedIds) {
			const leafIndex = senderIdByLeafIndex.get(removedId);
			if (leafIndex === undefined) {
				console.warn(
					"[DEBUG-e2ee] authorRemoveCommit: removed senderId not found in ratchet tree",
					{ removedId },
				);
				return;
			}
			const result = await this.epochProtocolProvider.removeMember(
				activeEpoch.state,
				leafIndex,
			);
			const identity = await this.deps.getDeviceIdentity();
			installActiveEpochState({
				epochNumber: result.epoch.epochNumber,
				state: result.epoch.state,
				meetingSecret: result.epoch.meetingSecret,
			});
			E2EEMeeting.instance.setMeetingContext(
				result.epoch.meetingSecret,
				result.epoch.epochNumber,
				identity.signingKeyPair.privateKey,
			);
			await this.syncSenderSigningPubs(result.epoch.state);

			const fromSenderId = this.deps.sfuClient.getOwnSenderId();
			const fromParticipantId =
				this.deps.currentUser.currentUser.value?.user_id;
			if (fromSenderId === null || !fromParticipantId) return;
			this.deps.sfuClient.sendE2EEEpochEnvelope({
				type: "commit",
				fromParticipantId,
				fromSenderId,
				previousEpochNumber: request.epochNumber,
				epochNumber: result.epoch.epochNumber,
				membershipDeltaId: request.membershipDeltaId,
				membershipDeltaHash: request.membershipDeltaHash,
				rosterHash: request.rosterHash,
				mlsCommit: bufferToBase64(
					this.epochProtocolProvider.encodeCommit(result.commit),
				),
			});
		}
	}

	private async processCommit(
		commitEnvelope: Extract<E2eeEpochEnvelope, { type: "commit" }>,
	): Promise<void> {
		const activeEpoch = getActiveEpochState();
		console.log("[DEBUG-e2ee] processCommit: enter", {
			activeEpochNumber: activeEpoch?.epochNumber ?? null,
			previousEpochNumber: commitEnvelope.previousEpochNumber,
			commitEpochNumber: commitEnvelope.epochNumber,
			fromSenderId: commitEnvelope.fromSenderId,
		});
		if (
			!activeEpoch ||
			activeEpoch.epochNumber !== commitEnvelope.previousEpochNumber
		) {
			console.warn("[DEBUG-e2ee] processCommit: epoch mismatch, abort");
			return;
		}

		const [decodedCommit] = decodeMlsMessage(
			bytesFromBase64(commitEnvelope.mlsCommit),
			0,
		);
		const nextEpoch = await this.epochProtocolProvider.processCommit(
			activeEpoch.state,
			decodedCommit,
		);
		if (nextEpoch.epochNumber !== commitEnvelope.epochNumber) return;

		const identity = await this.deps.getDeviceIdentity();
		installActiveEpochState({
			epochNumber: nextEpoch.epochNumber,
			state: nextEpoch.state,
			meetingSecret: nextEpoch.meetingSecret,
		});
		E2EEMeeting.instance.setMeetingContext(
			nextEpoch.meetingSecret,
			nextEpoch.epochNumber,
			identity.signingKeyPair.privateKey,
		);
		await this.syncSenderSigningPubs(nextEpoch.state);

		const fromParticipantId = this.deps.currentUser.currentUser.value?.user_id;
		const fromSenderId = this.deps.sfuClient.getOwnSenderId();
		if (!fromParticipantId || fromSenderId === null) return;
		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "ack",
			fromParticipantId,
			fromSenderId,
			epochNumber: nextEpoch.epochNumber,
		});
	}

	private async processWelcome(
		welcomeEnvelope: Extract<E2eeEpochEnvelope, { type: "welcome" }>,
	): Promise<void> {
		const ownSenderId = this.deps.sfuClient.getOwnSenderId();
		console.log("[DEBUG-e2ee] processWelcome: enter", {
			ownSenderId,
			toSenderId: welcomeEnvelope.toSenderId,
			welcomeEpochNumber: welcomeEnvelope.epochNumber,
			pendingKeyPackagesByEpoch: Array.from(
				this.pendingKeyPackagesByEpoch.keys(),
			),
		});
		if (ownSenderId === null || welcomeEnvelope.toSenderId !== ownSenderId) {
			console.warn("[DEBUG-e2ee] processWelcome: not addressed to us");
			return;
		}

		const pendingKeyPackage = this.pendingKeyPackagesByEpoch.get(
			welcomeEnvelope.epochNumber - 1,
		);
		if (!pendingKeyPackage) {
			console.warn("[DEBUG-e2ee] processWelcome: no pending key package", {
				welcomeEpochNumber: welcomeEnvelope.epochNumber,
				haveKeysFor: Array.from(this.pendingKeyPackagesByEpoch.keys()),
			});
			return;
		}

		const welcome = this.epochProtocolProvider.decodeWelcome(
			bytesFromBase64(welcomeEnvelope.mlsWelcome),
		);
		const nextEpoch = await this.epochProtocolProvider.joinFromWelcome(
			welcome,
			pendingKeyPackage.publicPackage,
			pendingKeyPackage.privatePackage,
		);
		if (nextEpoch.epochNumber !== welcomeEnvelope.epochNumber) return;

		const identity = await this.deps.getDeviceIdentity();
		installActiveEpochState({
			epochNumber: nextEpoch.epochNumber,
			state: nextEpoch.state,
			meetingSecret: nextEpoch.meetingSecret,
		});
		E2EEMeeting.instance.setMeetingContext(
			nextEpoch.meetingSecret,
			nextEpoch.epochNumber,
			identity.signingKeyPair.privateKey,
		);
		await this.syncSenderSigningPubs(nextEpoch.state);
		this.pendingKeyPackagesByEpoch.delete(welcomeEnvelope.epochNumber - 1);

		const fromParticipantId = this.deps.currentUser.currentUser.value?.user_id;
		if (!fromParticipantId) return;
		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "ack",
			fromParticipantId,
			fromSenderId: ownSenderId,
			epochNumber: nextEpoch.epochNumber,
		});
	}

	private async syncSenderSigningPubs(
		state: import("ts-mls").ClientState,
	): Promise<void> {
		let members: import("ts-mls").LeafNode[];
		try {
			members = getGroupMembers(state);
		} catch {
			return;
		}
		for (const leaf of members) {
			if (leaf.credential.credentialType !== "basic") continue;
			const identity = JSON.parse(
				new TextDecoder().decode(leaf.credential.identity),
			);
			if (
				typeof identity.senderId !== "number" ||
				typeof identity.signingPubKey !== "string"
			)
				continue;
			if (E2EEMeeting.instance.hasSenderSigningPub(identity.senderId)) continue;
			const rawKey = bytesFromBase64(identity.signingPubKey);
			const cryptoKey = await crypto.subtle.importKey(
				"raw",
				rawKey as BufferSource,
				"Ed25519",
				true,
				["verify"],
			);
			E2EEMeeting.instance.setSenderSigningPub(identity.senderId, cryptoKey);
		}
	}

	private collectJoiningKeyPackages(
		joiningSenderIds: number[],
		epochNumber: number,
	): Array<{ senderId: number; participantId: string; keyPackage: string }> {
		const ownSenderId = this.deps.sfuClient.getOwnSenderId();
		const out: Array<{
			senderId: number;
			participantId: string;
			keyPackage: string;
		}> = [];
		for (const senderId of joiningSenderIds) {
			if (senderId === ownSenderId) continue;
			const entry = this.receivedKeyPackagesBySenderId.get(senderId);
			if (!entry || entry.epochNumber !== epochNumber) continue;
			out.push({
				senderId,
				participantId: entry.participantId,
				keyPackage: entry.keyPackage,
			});
		}
		return out;
	}

	private isEpochEnvelope(value: unknown): value is E2eeEpochEnvelope {
		return (
			typeof value === "object" &&
			value !== null &&
			"type" in value &&
			typeof value.type === "string"
		);
	}
}
