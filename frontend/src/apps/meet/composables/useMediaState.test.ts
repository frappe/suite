import { describe, expect, it } from "vitest";
import {
	findActiveScreenShare,
	replaceActiveScreenShare,
	type RemoteScreenShare,
} from "./useMediaState";

const current: RemoteScreenShare = {
	source: "remote",
	participantId: "participant-1",
	consumerId: "consumer-current",
	producerId: "producer-current",
	startedAt: 1,
};

describe("findActiveScreenShare", () => {
	it("returns the current share when participant and producer identities match", () => {
		expect(
			findActiveScreenShare([current], "participant-1", "producer-current"),
		).toBe(current);
	});

	it("does not resolve a stale producer stop to the participant's current share", () => {
		expect(
			findActiveScreenShare([current], "participant-1", "producer-old"),
		).toBeNull();
	});

	it("evicts an old consumer attachment when the producer is resubscribed", () => {
		const replacement: RemoteScreenShare = {
			...current,
			consumerId: "consumer-replacement",
		};

		expect(replaceActiveScreenShare([current], replacement)).toEqual({
			shares: [replacement],
			replaced: [current],
		});
	});

	it("does not resolve an old consumer removal to its same-producer replacement", () => {
		const replacement: RemoteScreenShare = {
			...current,
			consumerId: "consumer-replacement",
		};

		expect(
			findActiveScreenShare(
				[replacement],
				"participant-1",
				"producer-current",
				"consumer-current",
			),
		).toBeNull();
	});
});
