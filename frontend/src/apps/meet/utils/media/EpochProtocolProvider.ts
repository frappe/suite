import {
	type ClientState,
	type Credential,
	createCommit,
	createGroup,
	defaultCapabilities,
	defaultLifetime,
	emptyPskIndex,
	encodeGroupState,
	generateKeyPackage,
	getCiphersuiteFromName,
	getCiphersuiteImpl,
	joinGroup,
	type KeyPackage,
	type MLSMessage,
	mlsExporter,
	type PrivateKeyPackage,
	type Proposal,
	processPublicMessage,
	type RatchetTree,
	type Welcome,
	zeroOutUint8Array,
} from "ts-mls";
import { decodeKeyPackage, encodeKeyPackage } from "ts-mls/keyPackage.js";
import { encodeMlsMessage } from "ts-mls/message.js";
import { decodeWelcome, encodeWelcome } from "ts-mls/welcome.js";

const MEET_MLS_CIPHERSUITE = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
const MEET_MLS_MEETING_SECRET_LABEL = "meet-e2ee|meeting-secret|v1";

type EpochMemberInput = {
	groupId: string;
	userId: string;
	deviceId: string;
	senderId: number;
	signingPubKey: string;
};

type EpochStateResult = {
	epochNumber: number;
	state: ClientState;
	encodedState: Uint8Array;
	meetingSecret: Uint8Array<ArrayBuffer>;
};

type EpochKeyPackage = {
	publicPackage: KeyPackage;
	privatePackage: PrivateKeyPackage;
};

type AddMemberResult = EpochStateResult & {
	commit: MLSMessage;
	welcome: Welcome;
};

type AddMultipleMembersResult = {
	commit: MLSMessage;
	welcome: Welcome;
	epoch: EpochStateResult;
};

type RemoveMemberResult = {
	commit: MLSMessage;
	epoch: EpochStateResult;
};

type CreateGenesisWithMembersResult = EpochStateResult & {
	joiningMembers: EpochMemberInput[];
	welcome: Welcome;
};

export interface EpochProtocolProvider {
	createGenesisEpoch(input: EpochMemberInput): Promise<EpochStateResult>;
	createGenesisEpochWithMembers(
		creator: EpochMemberInput,
		joiningMembers: Array<{
			member: EpochMemberInput;
			keyPackage: EpochKeyPackage;
		}>,
	): Promise<CreateGenesisWithMembersResult>;
	generateKeyPackage(input: EpochMemberInput): Promise<EpochKeyPackage>;
	encodeKeyPackage(keyPackage: KeyPackage): Uint8Array;
	decodeKeyPackage(encoded: Uint8Array): KeyPackage;
	encodeCommit(commit: MLSMessage): Uint8Array;
	encodeWelcome(welcome: Welcome): Uint8Array;
	decodeWelcome(encoded: Uint8Array): Welcome;
	addMember(
		state: ClientState,
		joiningMember: KeyPackage,
	): Promise<AddMemberResult>;
	addMultipleMembers(
		state: ClientState,
		joiningMembers: KeyPackage[],
	): Promise<AddMultipleMembersResult>;
	removeMember(
		state: ClientState,
		removedLeafIndex: number,
	): Promise<RemoveMemberResult>;
	joinFromWelcome(
		welcome: Welcome,
		keyPackage: KeyPackage,
		privateKeyPackage: PrivateKeyPackage,
		ratchetTree?: RatchetTree,
	): Promise<EpochStateResult>;
	processCommit(
		state: ClientState,
		commit: MLSMessage,
	): Promise<EpochStateResult>;
	exportMeetingSecret(state: ClientState): Promise<Uint8Array<ArrayBuffer>>;
}

export class TsMlsEpochProtocolProvider implements EpochProtocolProvider {
	async createGenesisEpoch(input: EpochMemberInput): Promise<EpochStateResult> {
		const cipherSuite = await this.getCipherSuite();
		const keyPackage = await this.generateKeyPackage(input);
		const state = await createGroup(
			new TextEncoder().encode(input.groupId),
			keyPackage.publicPackage,
			keyPackage.privatePackage,
			[],
			cipherSuite,
		);
		return this.buildStateResult(state);
	}

	async createGenesisEpochWithMembers(
		creator: EpochMemberInput,
		joiningMembers: Array<{
			member: EpochMemberInput;
			keyPackage: EpochKeyPackage;
		}>,
	): Promise<CreateGenesisWithMembersResult> {
		if (joiningMembers.length === 0) {
			throw new Error(
				"createGenesisEpochWithMembers requires at least one joining member",
			);
		}
		const cipherSuite = await this.getCipherSuite();
		const creatorKeyPackage = await this.generateKeyPackage(creator);
		const addProposals: Proposal[] = joiningMembers.map((jm) => ({
			proposalType: "add",
			add: { keyPackage: jm.keyPackage.publicPackage },
		}));
		const state = await createGroup(
			new TextEncoder().encode(creator.groupId),
			creatorKeyPackage.publicPackage,
			creatorKeyPackage.privatePackage,
			[],
			cipherSuite,
		);
		const commit = await createCommit(
			{ state, cipherSuite },
			{
				extraProposals: addProposals,
				ratchetTreeExtension: true,
				wireAsPublicMessage: true,
			},
		);
		commit.consumed.forEach(zeroOutUint8Array);
		if (!commit.welcome) {
			throw new Error(
				"createGenesisEpochWithMembers did not produce a welcome",
			);
		}
		const nextEpoch = await this.buildStateResult(commit.newState);
		return {
			...nextEpoch,
			joiningMembers: joiningMembers.map((jm) => jm.member),
			welcome: commit.welcome,
		};
	}

	async generateKeyPackage(input: EpochMemberInput): Promise<EpochKeyPackage> {
		const cipherSuite = await this.getCipherSuite();
		return generateKeyPackage(
			this.buildCredential(input),
			defaultCapabilities(),
			defaultLifetime,
			[],
			cipherSuite,
		);
	}

	encodeKeyPackage(keyPackage: KeyPackage): Uint8Array {
		return encodeKeyPackage(keyPackage);
	}

	decodeKeyPackage(encoded: Uint8Array): KeyPackage {
		const decoded = decodeKeyPackage(encoded, 0);
		if (!decoded) {
			throw new Error("Invalid MLS key package");
		}
		return decoded[0];
	}

	encodeCommit(commit: MLSMessage): Uint8Array {
		return encodeMlsMessage(commit);
	}

	encodeWelcome(welcome: Welcome): Uint8Array {
		return encodeWelcome(welcome);
	}

	decodeWelcome(encoded: Uint8Array): Welcome {
		const decoded = decodeWelcome(encoded, 0);
		if (!decoded) {
			throw new Error("Invalid MLS welcome");
		}
		return decoded[0];
	}

	async addMember(
		state: ClientState,
		joiningMember: KeyPackage,
	): Promise<AddMemberResult> {
		const result = await this.addMultipleMembers(state, [joiningMember]);
		return {
			...result.epoch,
			commit: result.commit,
			welcome: result.welcome,
		};
	}

	async addMultipleMembers(
		state: ClientState,
		joiningMembers: KeyPackage[],
	): Promise<AddMultipleMembersResult> {
		if (joiningMembers.length === 0) {
			throw new Error(
				"addMultipleMembers requires at least one joining member",
			);
		}
		const cipherSuite = await this.getCipherSuite();
		const addProposals: Proposal[] = joiningMembers.map((kp) => ({
			proposalType: "add",
			add: { keyPackage: kp },
		}));
		const commit = await createCommit(
			{ state, cipherSuite },
			{
				extraProposals: addProposals,
				ratchetTreeExtension: true,
				wireAsPublicMessage: true,
			},
		);
		commit.consumed.forEach(zeroOutUint8Array);
		if (!commit.welcome) {
			throw new Error("Add-multiple-members commit did not produce a welcome");
		}
		return {
			commit: commit.commit,
			welcome: commit.welcome,
			epoch: await this.buildStateResult(commit.newState),
		};
	}

	async removeMember(
		state: ClientState,
		removedLeafIndex: number,
	): Promise<RemoveMemberResult> {
		if (!Number.isInteger(removedLeafIndex) || removedLeafIndex < 0) {
			throw new Error("removedLeafIndex must be a non-negative integer");
		}
		const cipherSuite = await this.getCipherSuite();
		const removeProposal: Proposal = {
			proposalType: "remove",
			remove: { removed: removedLeafIndex },
		};
		const commit = await createCommit(
			{ state, cipherSuite },
			{
				extraProposals: [removeProposal],
				ratchetTreeExtension: true,
				wireAsPublicMessage: true,
			},
		);
		commit.consumed.forEach(zeroOutUint8Array);
		return {
			commit: commit.commit,
			epoch: await this.buildStateResult(commit.newState),
		};
	}

	async joinFromWelcome(
		welcome: Welcome,
		keyPackage: KeyPackage,
		privateKeyPackage: PrivateKeyPackage,
		ratchetTree?: RatchetTree,
	): Promise<EpochStateResult> {
		const cipherSuite = await this.getCipherSuite();
		const state = await joinGroup(
			welcome,
			keyPackage,
			privateKeyPackage,
			emptyPskIndex,
			cipherSuite,
			ratchetTree,
		);
		return this.buildStateResult(state);
	}

	async processCommit(
		state: ClientState,
		commit: MLSMessage,
	): Promise<EpochStateResult> {
		if (commit.wireformat !== "mls_public_message") {
			throw new Error("Expected mls_public_message for commit processing");
		}
		const cipherSuite = await this.getCipherSuite();
		const result = await processPublicMessage(
			state,
			commit.publicMessage,
			emptyPskIndex,
			cipherSuite,
		);
		result.consumed.forEach(zeroOutUint8Array);
		return this.buildStateResult(result.newState);
	}

	async exportMeetingSecret(
		state: ClientState,
	): Promise<Uint8Array<ArrayBuffer>> {
		const cipherSuite = await this.getCipherSuite();
		const secret = await mlsExporter(
			state.keySchedule.exporterSecret,
			MEET_MLS_MEETING_SECRET_LABEL,
			new TextEncoder().encode(String(this.getMeetEpochNumber(state))),
			32,
			cipherSuite,
		);
		return secret as Uint8Array<ArrayBuffer>;
	}

	private async buildStateResult(
		state: ClientState,
	): Promise<EpochStateResult> {
		return {
			epochNumber: this.getMeetEpochNumber(state),
			state,
			encodedState: encodeGroupState(state),
			meetingSecret: await this.exportMeetingSecret(state),
		};
	}

	private getMeetEpochNumber(state: ClientState): number {
		return Number(state.groupContext.epoch) + 1;
	}

	private async getCipherSuite() {
		return getCiphersuiteImpl(getCiphersuiteFromName(MEET_MLS_CIPHERSUITE));
	}

	private buildCredential(input: EpochMemberInput): Credential {
		return {
			credentialType: "basic",
			identity: new TextEncoder().encode(
				JSON.stringify({
					userId: input.userId,
					deviceId: input.deviceId,
					senderId: input.senderId,
					signingPubKey: input.signingPubKey,
				}),
			),
		};
	}
}
