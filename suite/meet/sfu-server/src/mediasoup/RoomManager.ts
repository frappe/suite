import type * as mediasoup from 'mediasoup';
import type { Room, RtpCodecCapability } from '../types';
import { loggers } from '../utils/logger';

const MAX_AUDIO_LEVEL_ENTRIES = 20;

export class RoomManager {
	private rooms = new Map<string, Room>();
	private routers = new Map<string, mediasoup.types.Router>();

	async createRoom(
		roomId: string,
		workerId: number,
		worker: mediasoup.types.Worker,
		webRtcServer: mediasoup.types.WebRtcServer,
		mediaCodecs: RtpCodecCapability[],
		onActiveSpeaker?: (roomId: string, participantIds: string[]) => void,
	): Promise<Room> {
		if (this.rooms.has(roomId)) {
			return this.rooms.get(roomId)!;
		}
		loggers.roomManager.info('Creating room: %s', roomId);

		const router = await worker.createRouter({
			mediaCodecs,
		});

		try {
			const audioLevelObserver = await router.createAudioLevelObserver({
				maxEntries: MAX_AUDIO_LEVEL_ENTRIES,
				threshold: -70,
				interval: 800,
			});

			if (onActiveSpeaker) {
				audioLevelObserver.on('volumes', (volumes) => {
					const activeSpeakerIds: string[] = [];

					for (const { producer, volume } of volumes) {
						if (volume > -70) {
							const peer = Array.from(room.peers.values()).find((p) =>
								Array.from(p.producers.values()).some(
									(prod) => prod.id === producer.id,
								),
							);
							if (peer && !activeSpeakerIds.includes(peer.id)) {
								activeSpeakerIds.push(peer.id);
							}
						}
					}

					onActiveSpeaker(roomId, activeSpeakerIds);
				});
			}

			const room: Room = {
				id: roomId,
				workerId,
				router,
				webRtcServer,
				audioLevelObserver,
				peers: new Map(),
				created: new Date(),
			};

			this.rooms.set(roomId, room);
			this.routers.set(roomId, router);

			loggers.roomManager.info('Room created: %s', roomId);
			return room;
		} catch (error) {
			router.close();
			throw error;
		}
	}

	async closeRoom(roomId: string): Promise<void> {
		const room = this.rooms.get(roomId);
		if (!room) return;

		loggers.roomManager.info('Closing room: %s', roomId);

		try {
			room.router.close();
			loggers.roomManager.info('Router closed for room: %s', roomId);
		} catch (error) {
			loggers.roomManager.warn(
				'Error closing router for room %s: %s',
				roomId,
				(error as Error).message,
			);
		}

		this.rooms.delete(roomId);
		this.routers.delete(roomId);

		loggers.roomManager.info('Room closed: %s', roomId);
	}

	getRoom(roomId: string): Room | undefined {
		return this.rooms.get(roomId);
	}

	getRouter(roomId: string): mediasoup.types.Router | undefined {
		return this.routers.get(roomId);
	}

	getRoomCount(): number {
		return this.rooms.size;
	}

	getPeerCount(): number {
		let count = 0;
		for (const room of this.rooms.values()) count += room.peers.size;
		return count;
	}

	getAllRooms(): Room[] {
		return Array.from(this.rooms.values());
	}

	getParticipantCount(): number {
		let count = 0;
		for (const room of this.rooms.values()) {
			for (const peerId of room.peers.keys()) {
				if (!peerId.startsWith('recorder:')) count++;
			}
		}
		return count;
	}

	async cleanup(): Promise<void> {
		loggers.roomManager.info('Closing %d rooms', this.rooms.size);
		for (const roomId of this.rooms.keys()) {
			await this.closeRoom(roomId);
		}
	}
}
