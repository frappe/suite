import { afterEach, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import { useScreenShareTiles } from "../../../composables/useScreenShareTiles";
import { ConsumerManager } from "../../media/ConsumerManager";
import { SFUMediaManager } from "../SFUMediaManager";

afterEach(() => vi.unstubAllGlobals());

it.each(["participant departure", "receive reset"])(
	"shows only the new guest screen after %s during camera attachment",
	async (interruption) => {
		vi.stubGlobal(
			"MediaStream",
			class {
				constructor(public tracks: unknown[]) {}
			},
		);
		let finishCameraAttachment!: () => void;
		const cameraAttachment = new Promise<void>((resolve) => {
			finishCameraAttachment = resolve;
		});
		const consumers = new ConsumerManager();
		const shares = ref<
			Array<{
				participantId: string;
				consumerId: string;
				source: "remote";
			}>
		>([]);
		const pinnedTiles = ref<
			Array<{ type: "screenshare" | "participant"; id: string }>
		>([]);
		const { screenShareTiles } = useScreenShareTiles({
			displayScreenShares: shares,
			pinnedTiles,
			currentUser: ref(null),
			getParticipantName: (id) => (id === "guest-new" ? "Jolen Rosario" : id),
			gridLayout: {
				pinnedTiles,
				displayScreenShares: shares,
				pinTile: (type, id) => pinnedTiles.value.push({ type, id }),
				unpinTile: (type, id) => {
					pinnedTiles.value = pinnedTiles.value.filter(
						(tile) => tile.type !== type || tile.id !== id,
					);
				},
				resetGridLayout: vi.fn(),
			},
		});
		const manager = new SFUMediaManager(
			{
				consumerManager: consumers,
				transportManager: {} as never,
				videoManager: { attachStream: () => cameraAttachment } as never,
				participantManager: { getParticipant: () => undefined } as never,
			},
			() => "observer",
		);
		manager.setEventHandlers({
			onScreenShareStarted: ({ participantId, consumer }) => {
				shares.value.push({
					participantId,
					consumerId: consumer!.id,
					source: "remote",
				});
			},
		});
		consumers.setEventHandlers({
			onConsumerRemoved: (id) => {
				shares.value = shares.value.filter((share) => share.consumerId !== id);
			},
		});
		const addConsumer = (
			id: string,
			participantId: string,
			isScreen: boolean,
		) => {
			const consumer = {
				id,
				producerId: `producer-${id}`,
				kind: "video",
				closed: false,
				track: { kind: "video", readyState: "live" },
				appData: { type: isScreen ? "screen" : "camera" },
				once: vi.fn(),
				close() {
					this.closed = true;
				},
				pause: vi.fn(),
				resume: vi.fn(),
			};
			consumers.addConsumer(consumer as never, participantId);
			return consumers.getConsumer(id)!;
		};
		addConsumer("observer-camera", "observer", false);
		const oldScreen = addConsumer("old-screen", "guest-old", true);
		const pendingShare = manager.handleScreenShareConsumer(oldScreen);

		// The old guest leaves while camera playback is still pending.
		if (interruption === "participant departure") {
			consumers.cleanupParticipantConsumers("guest-old");
		} else {
			consumers.clear();
		}
		expect(consumers.getScreenShareConsumers()).toEqual([]);
		finishCameraAttachment();
		await pendingShare;

		const sharesAfterDeparture = [...shares.value];
		const activeAfterDeparture = manager.isScreenShareActive;

		const newScreen = addConsumer("new-screen", "guest-new", true);
		await manager.handleScreenShareConsumer(newScreen);
		await nextTick();

		expect(
			screenShareTiles.value.map((tile) => tile.participant.user_name),
		).toEqual(["Jolen Rosario's screen"]);
		expect(sharesAfterDeparture).toEqual([]);
		expect(activeAfterDeparture).toBe(false);
		expect(pinnedTiles.value).toEqual([
			{ type: "screenshare", id: "guest-new" },
		]);
		consumers.cleanupParticipantConsumers("guest-new");
		await nextTick();
		expect(screenShareTiles.value).toEqual([]);
		expect(pinnedTiles.value).toEqual([]);
	},
);
