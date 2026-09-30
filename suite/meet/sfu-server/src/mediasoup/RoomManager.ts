import type * as mediasoup from 'mediasoup';
import type {
	PipeRepresentation,
	Room,
	RoomRouter,
	RoomStats,
	RtpCodecCapability,
} from '../types';
import { loggers } from '../utils/logger';
import type { WorkerEntry } from './WorkerManager';

const MAX_AUDIO_LEVEL_ENTRIES = 20;

export interface PeerRouterAssignment {
	router: RoomRouter;
	activated: boolean;
	reserved: boolean;
}

export class RoomManager {
	private rooms = new Map<string, Room>();
	private creatingRooms = new Map<string, Promise<Room>>();
	private roomWorkers = new Map<string, WorkerEntry[]>();
	private assigningPeers = new Map<string, Promise<void>>();
	private creatingPipes = new Map<string, Promise<PipeRepresentation>>();
	private cleaningUp = false;

	async createRoom(
		roomId: string,
		workers: WorkerEntry[],
		mediaCodecs: RtpCodecCapability[],
		onActiveSpeaker?: (roomId: string, participantIds: string[]) => void,
	): Promise<Room> {
		if (this.cleaningUp) throw new Error('Room manager is shutting down');
		const existing = this.rooms.get(roomId);
		if (existing) return existing;
		const creating = this.creatingRooms.get(roomId);
		if (creating) return creating;

		const promise = this.createRoomInternal(
			roomId,
			workers,
			mediaCodecs,
			onActiveSpeaker,
		);
		this.creatingRooms.set(roomId, promise);
		try {
			return await promise;
		} finally {
			if (this.creatingRooms.get(roomId) === promise) {
				this.creatingRooms.delete(roomId);
			}
		}
	}

	private async createRoomInternal(
		roomId: string,
		workers: WorkerEntry[],
		mediaCodecs: RtpCodecCapability[],
		onActiveSpeaker?: (roomId: string, participantIds: string[]) => void,
	): Promise<Room> {
		if (workers.length === 0)
			throw new Error('A room requires at least one worker');

		loggers.roomManager.info('Creating room: %s', roomId);
		const primary = await this.createRouter(workers[0], mediaCodecs);
		let audioLevelObserver: mediasoup.types.AudioLevelObserver;
		try {
			audioLevelObserver = await primary.router.createAudioLevelObserver({
				maxEntries: MAX_AUDIO_LEVEL_ENTRIES,
				threshold: -70,
				interval: 800,
			});
		} catch (error) {
			primary.router.close();
			throw error;
		}

		const room: Room = {
			id: roomId,
			router: primary.router,
			webRtcServer: primary.webRtcServer,
			audioLevelObserver,
			routers: [primary],
			peerRouterIds: new Map(),
			pipeRepresentations: new Map(),
			peers: new Map(),
			created: new Date(),
		};

		if (onActiveSpeaker) {
			audioLevelObserver.on('volumes', (volumes) => {
				const activeSpeakerIds: string[] = [];
				for (const { producer, volume } of volumes) {
					if (volume <= -70) continue;
					const peer = Array.from(room.peers.values()).find((candidate) =>
						candidate.producers.has(producer.id),
					);
					if (peer && !activeSpeakerIds.includes(peer.id)) {
						activeSpeakerIds.push(peer.id);
					}
				}
				onActiveSpeaker(roomId, activeSpeakerIds);
			});
		}

		this.rooms.set(roomId, room);
		this.roomWorkers.set(roomId, workers);
		loggers.roomManager.info('Room created: %s with 1 router', roomId);
		return room;
	}

	private async createRouter(
		entry: WorkerEntry,
		mediaCodecs: RtpCodecCapability[],
	): Promise<RoomRouter> {
		const router = await entry.worker.createRouter({ mediaCodecs });
		return {
			id: router.id,
			workerId: entry.id,
			router,
			webRtcServer: entry.webRtcServer,
		};
	}

	async assignPeerRouter(
		roomId: string,
		peerId: string,
		peersPerRouter: number,
		mediaCodecs: RtpCodecCapability[],
	): Promise<PeerRouterAssignment> {
		const previous = this.assigningPeers.get(roomId) ?? Promise.resolve();
		const assignment = previous
			.catch(() => undefined)
			.then(() =>
				this.assignPeerRouterInternal(
					roomId,
					peerId,
					peersPerRouter,
					mediaCodecs,
				),
			);
		const tail = assignment.then(
			() => undefined,
			() => undefined,
		);
		this.assigningPeers.set(roomId, tail);
		try {
			return await assignment;
		} finally {
			if (this.assigningPeers.get(roomId) === tail) {
				this.assigningPeers.delete(roomId);
			}
		}
	}

	private async assignPeerRouterInternal(
		roomId: string,
		peerId: string,
		peersPerRouter: number,
		mediaCodecs: RtpCodecCapability[],
	): Promise<PeerRouterAssignment> {
		const room = this.rooms.get(roomId);
		if (!room) throw new Error(`Room ${roomId} not found`);
		const existingId = room.peerRouterIds.get(peerId);
		if (existingId) {
			return {
				router: room.routers.find(({ id }) => id === existingId)!,
				activated: false,
				reserved: false,
			};
		}

		let router = room.routers.at(-1)!;
		const assignedCount = Array.from(room.peerRouterIds.values()).filter(
			(routerId) => routerId === router.id,
		).length;
		let activated = false;
		const workers = this.roomWorkers.get(roomId)!;
		if (
			assignedCount >= peersPerRouter &&
			room.routers.length < workers.length
		) {
			router = await this.createRouter(
				workers[room.routers.length],
				mediaCodecs,
			);
			if (
				this.rooms.get(roomId) !== room ||
				this.roomWorkers.get(roomId) !== workers
			) {
				router.router.close();
				throw new Error(`Room ${roomId} closed while activating a router`);
			}
			room.routers.push(router);
			activated = true;
			loggers.roomManager.info(
				'Activated router %s on worker %d for room %s',
				router.id,
				router.workerId,
				roomId,
			);
		}
		room.peerRouterIds.set(peerId, router.id);
		return { router, activated, reserved: true };
	}

	async ensureProducerOnRouter(
		roomId: string,
		producerId: string,
		sourceRouterId: string,
		destinationRouterId: string,
		persistent = false,
	): Promise<PipeRepresentation | undefined> {
		if (sourceRouterId === destinationRouterId) return undefined;
		const room = this.rooms.get(roomId);
		if (!room) throw new Error(`Room ${roomId} not found`);
		const key = this.pipeKey(producerId, destinationRouterId);
		const existing = room.pipeRepresentations.get(key);
		if (existing) {
			if (persistent) existing.persistent = true;
			return existing;
		}

		const pendingKey = `${roomId}:${key}`;
		const pending = this.creatingPipes.get(pendingKey);
		if (pending) {
			const representation = await pending;
			if (persistent) representation.persistent = true;
			return representation;
		}

		const source = room.routers.find(({ id }) => id === sourceRouterId);
		const destination = room.routers.find(
			({ id }) => id === destinationRouterId,
		);
		if (!source || !destination) {
			throw new Error(`Router not found in room ${roomId}`);
		}

		const creation = source.router
			.pipeToRouter({
				producerId,
				router: destination.router,
				keepId: true,
			})
			.then(({ pipeConsumer, pipeProducer }) => {
				if (!pipeConsumer || !pipeProducer) {
					throw new Error(`Producer ${producerId} did not create a media pipe`);
				}
				if (this.rooms.get(roomId) !== room) {
					pipeProducer.close();
					pipeConsumer.close();
					throw new Error(`Room ${roomId} closed while creating a media pipe`);
				}
				const representation: PipeRepresentation = {
					producerId,
					sourceRouterId,
					destinationRouterId,
					pipeConsumer,
					pipeProducer,
					persistent,
					consumerCount: 0,
				};
				room.pipeRepresentations.set(key, representation);
				return representation;
			});
		this.creatingPipes.set(pendingKey, creation);
		try {
			return await creation;
		} finally {
			if (this.creatingPipes.get(pendingKey) === creation) {
				this.creatingPipes.delete(pendingKey);
			}
		}
	}

	async retainProducerOnRouter(
		roomId: string,
		producerId: string,
		sourceRouterId: string,
		destinationRouterId: string,
	): Promise<PipeRepresentation | undefined> {
		const pipe = await this.ensureProducerOnRouter(
			roomId,
			producerId,
			sourceRouterId,
			destinationRouterId,
		);
		if (pipe) pipe.consumerCount++;
		return pipe;
	}

	releaseProducerOnRouter(
		roomId: string,
		producerId: string,
		destinationRouterId: string,
	): void {
		const room = this.rooms.get(roomId);
		const key = this.pipeKey(producerId, destinationRouterId);
		const pipe = room?.pipeRepresentations.get(key);
		if (!room || !pipe || pipe.persistent) return;
		pipe.consumerCount = Math.max(0, pipe.consumerCount - 1);
		if (pipe.consumerCount > 0) return;
		this.closePipe(pipe);
		room.pipeRepresentations.delete(key);
	}

	closeProducerPipes(roomId: string, producerId: string): void {
		const room = this.rooms.get(roomId);
		if (!room) return;
		for (const [key, pipe] of room.pipeRepresentations) {
			if (pipe.producerId !== producerId) continue;
			this.closePipe(pipe);
			room.pipeRepresentations.delete(key);
		}
	}

	getPipeRepresentation(
		roomId: string,
		producerId: string,
		destinationRouterId: string,
	): PipeRepresentation | undefined {
		return this.rooms
			.get(roomId)
			?.pipeRepresentations.get(this.pipeKey(producerId, destinationRouterId));
	}

	async closeRoom(roomId: string): Promise<void> {
		const creating = this.creatingRooms.get(roomId);
		if (creating) {
			try {
				await creating;
			} catch {
				return;
			}
		}
		const room = this.rooms.get(roomId);
		if (!room) return;
		loggers.roomManager.info('Closing room: %s', roomId);

		for (const pipe of room.pipeRepresentations.values()) this.closePipe(pipe);
		room.pipeRepresentations.clear();
		for (const { router } of room.routers) {
			try {
				router.close();
			} catch (error) {
				loggers.roomManager.warn(
					'Error closing router for room %s: %s',
					roomId,
					(error as Error).message,
				);
			}
		}
		this.rooms.delete(roomId);
		this.roomWorkers.delete(roomId);
		this.assigningPeers.delete(roomId);
		loggers.roomManager.info('Room closed: %s', roomId);
	}

	getRoom(roomId: string): Room | undefined {
		return this.rooms.get(roomId);
	}

	getAllRooms(): Room[] {
		return Array.from(this.rooms.values());
	}

	getRouter(roomId: string): mediasoup.types.Router | undefined {
		return this.rooms.get(roomId)?.router;
	}

	getPeerRouter(roomId: string, peerId: string): RoomRouter | undefined {
		const room = this.rooms.get(roomId);
		const routerId = room?.peerRouterIds.get(peerId);
		return routerId
			? room?.routers.find(({ id }) => id === routerId)
			: undefined;
	}

	removePeerRouter(roomId: string, peerId: string): void {
		this.rooms.get(roomId)?.peerRouterIds.delete(peerId);
	}

	private pipeKey(producerId: string, destinationRouterId: string): string {
		return `${producerId}:${destinationRouterId}`;
	}

	private closePipe(pipe: PipeRepresentation): void {
		try {
			if (!pipe.pipeProducer.closed) pipe.pipeProducer.close();
		} catch (error) {
			loggers.roomManager.warn(
				'Error closing pipe producer %s: %s',
				pipe.producerId,
				(error as Error).message,
			);
		}
		try {
			if (!pipe.pipeConsumer.closed) pipe.pipeConsumer.close();
		} catch (error) {
			loggers.roomManager.warn(
				'Error closing pipe consumer %s: %s',
				pipe.producerId,
				(error as Error).message,
			);
		}
	}

	getRoomStats(roomId: string): RoomStats | null {
		const room = this.rooms.get(roomId);
		if (!room) return null;
		return {
			id: roomId,
			created: room.created,
			peerCount: room.peers.size,
			participantCount: Array.from(room.peers.keys()).filter(
				(peerId) => !peerId.startsWith('recorder:'),
			).length,
			peers: Array.from(room.peers.keys()),
			producerCount: Array.from(room.peers.values()).reduce(
				(count, peer) => count + peer.producers.size,
				0,
			),
			consumerCount: Array.from(room.peers.values()).reduce(
				(count, peer) => count + peer.consumers.size,
				0,
			),
		};
	}

	getRoomCount(): number {
		return this.rooms.size;
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
		this.cleaningUp = true;
		const roomIds = new Set([
			...this.rooms.keys(),
			...this.creatingRooms.keys(),
		]);
		loggers.roomManager.info('Closing %d rooms', roomIds.size);
		for (const roomId of roomIds) await this.closeRoom(roomId);
	}
}
