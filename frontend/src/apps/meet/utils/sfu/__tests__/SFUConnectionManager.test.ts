import { describe, expect, it, vi } from "vitest";
import { ParticipantManager } from "../../media/ParticipantManager";
import { SFUConnectionManager } from "../SFUConnectionManager";

function createManager() {
	const participantManager = new ParticipantManager();
	const manager = new SFUConnectionManager({
		sfuClient: {} as never,
		videoManager: {} as never,
		participantManager,
		transportManager: {} as never,
		mediaManager: {} as never,
		recoveryManager: {} as never,
	});
	manager.currentUser = { value: { user_id: "me" } };
	return { manager, participantManager };
}

describe("SFUConnectionManager", () => {
	it("marks a remote participant unmuted when an audio producer exists", () => {
		const { manager, participantManager } = createManager();
		participantManager.addParticipant({
			participantId: "remote-1",
			userData: { name: "Remote", audio_enabled: false },
		});

		(
			manager as unknown as {
				updateParticipantMediaStateFromProducer: (event: {
					participantId: string;
					producerId: string;
					kind: string;
				}) => void;
			}
		).updateParticipantMediaStateFromProducer({
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "audio",
		});

		expect(participantManager.getParticipant("remote-1")?.audio_enabled).toBe(
			true,
		);
	});

	it("marks camera on for camera video producers but not screen share", () => {
		const { manager, participantManager } = createManager();
		participantManager.addParticipant({
			participantId: "remote-1",
			userData: { name: "Remote", video_enabled: false },
		});
		const update = (
			manager as unknown as {
				updateParticipantMediaStateFromProducer: (event: {
					participantId: string;
					producerId: string;
					kind: string;
					isScreen?: boolean;
				}) => void;
			}
		).updateParticipantMediaStateFromProducer.bind(manager);

		update({
			participantId: "remote-1",
			producerId: "screen-producer",
			kind: "video",
			isScreen: true,
		});
		expect(participantManager.getParticipant("remote-1")?.video_enabled).toBe(
			false,
		);

		update({
			participantId: "remote-1",
			producerId: "camera-producer",
			kind: "video",
		});
		expect(participantManager.getParticipant("remote-1")?.video_enabled).toBe(
			true,
		);
	});

	it("ignores producer events for the current user", () => {
		const { manager, participantManager } = createManager();
		const updateSpy = vi.spyOn(participantManager, "updateMediaState");

		(
			manager as unknown as {
				updateParticipantMediaStateFromProducer: (event: {
					participantId: string;
					producerId: string;
					kind: string;
				}) => void;
			}
		).updateParticipantMediaStateFromProducer({
			participantId: "me",
			producerId: "producer-1",
			kind: "audio",
		});

		expect(updateSpy).not.toHaveBeenCalled();
	});
});
