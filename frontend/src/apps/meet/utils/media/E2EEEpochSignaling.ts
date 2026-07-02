export type E2eeEpochEnvelope =
	| E2eeEpochKeyPackageRequest
	| E2eeEpochGenesisRequest
	| E2eeEpochKeyPackage
	| E2eeEpochCommitRequest
	| E2eeEpochCommit
	| E2eeEpochWelcome
	| E2eeEpochAck
	| E2eeEpochResyncRequest
	| E2eeEpochJoinStatus;

export type E2eeEpochKeyPackageRequest = {
	type: "key-package-request";
	epochNumber: number;
	reason: "enable" | "join" | "reconnect";
};

export type E2eeEpochGenesisRequest = {
	type: "genesis-request";
	epochNumber: 1;
	message: string;
};

export type E2eeEpochKeyPackage = {
	type: "key-package";
	fromParticipantId: string;
	fromSenderId: number;
	epochNumber: number;
	reason?: "enable" | "join" | "reconnect";
	keyPackage: string;
};

export type E2eeEpochCommitRequest = {
	type: "commit-request";
	epochNumber: number;
	nextEpochNumber: number;
	membershipDeltaId: string;
	membershipDeltaHash: string;
	rosterHash: string;
	committerSenderId: number;
	joiningSenderIds: number[];
	removedSenderIds?: number[];
};

export type E2eeEpochCommit = {
	type: "commit";
	fromParticipantId: string;
	fromSenderId: number;
	previousEpochNumber: number;
	epochNumber: number;
	membershipDeltaId: string;
	membershipDeltaHash: string;
	rosterHash: string;
	mlsCommit: string;
};

export type E2eeEpochWelcome = {
	type: "welcome";
	fromParticipantId: string;
	fromSenderId: number;
	toParticipantId: string;
	toSenderId: number;
	epochNumber: number;
	mlsWelcome: string;
};

export type E2eeEpochAck = {
	type: "ack";
	fromParticipantId: string;
	fromSenderId: number;
	epochNumber: number;
};

export type E2eeEpochResyncRequest = {
	type: "resync-request";
	fromParticipantId: string;
	fromSenderId: number;
	knownEpochNumber?: number;
};

export type E2eeEpochJoinStatus = {
	type: "join-status";
	status: "pending" | "failed";
	reason?: "waiting-for-admitter" | "waiting-for-host";
	epochNumber: number;
	message: string;
};
