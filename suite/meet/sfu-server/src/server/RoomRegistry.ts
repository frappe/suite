import type { Server, Socket } from 'socket.io';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
	UserData,
} from '../types';

const fullRoom = (roomId: string) => `${roomId}:full`;
const previewRoom = (roomId: string) => `${roomId}:preview`;

export class RoomRegistry {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private raisedHands: Record<string, Record<string, string>> = {};
	private hostOnlyChat: Record<string, boolean> = {};
	private participantSockets: Record<string, Record<string, string>> = {};

	constructor(io: Server<ClientToServerEvents, ServerToClientEvents>) {
		this.io = io;
	}

	joinScope(
		socket: Socket,
		roomId: string,
		scope: 'full' | 'presence-preview',
	): void {
		socket.join(scope === 'full' ? fullRoom(roomId) : previewRoom(roomId));
	}

	claimParticipant(
		socket: Socket,
		roomId: string,
		participantId: string,
	): void {
		if (!this.participantSockets[roomId]) this.participantSockets[roomId] = {};
		this.participantSockets[roomId][participantId] = socket.id;
	}

	releaseParticipant(
		socket: Socket,
		roomId: string,
		participantId: string,
	): boolean {
		if (this.participantSockets[roomId]?.[participantId] !== socket.id) {
			return false;
		}

		delete this.participantSockets[roomId][participantId];
		return true;
	}

	setRaisedHand(roomId: string, peerId: string, isoTimestamp: string): void {
		if (!this.raisedHands[roomId]) this.raisedHands[roomId] = {};
		this.raisedHands[roomId][peerId] = isoTimestamp;
	}

	clearRaisedHand(roomId: string, peerId: string): void {
		delete this.raisedHands[roomId]?.[peerId];
	}

	getRaisedHands(roomId: string): Record<string, string> {
		return this.raisedHands[roomId] ?? {};
	}

	hasRaisedHand(roomId: string, peerId: string): boolean {
		return Boolean(this.raisedHands[roomId]?.[peerId]);
	}

	setHostOnlyChat(roomId: string, enabled: boolean): void {
		this.hostOnlyChat[roomId] = enabled;
	}

	isHostOnlyChat(roomId: string): boolean {
		return Boolean(this.hostOnlyChat[roomId]);
	}

	isEmpty(roomId: string): boolean {
		const adapter = this.io.sockets.adapter;
		const full = adapter.rooms.get(fullRoom(roomId))?.size ?? 0;
		const preview = adapter.rooms.get(previewRoom(roomId))?.size ?? 0;
		return full === 0 && preview === 0;
	}

	cleanupRoom(roomId: string): void {
		delete this.raisedHands[roomId];
		delete this.hostOnlyChat[roomId];
		delete this.participantSockets[roomId];
	}

	emitToScope(
		roomId: string,
		scope: 'full' | 'presence-preview',
		event: string,
		data: unknown,
	): void {
		const key = scope === 'full' ? fullRoom(roomId) : previewRoom(roomId);
		const ids = this.io.sockets.adapter.rooms.get(key);
		if (!ids) return;
		for (const id of ids) {
			const socket = this.io.sockets.sockets.get(id);
			if (socket) {
				// biome-ignore lint/suspicious/noExplicitAny: Internal utility for type-safe emission to dynamic event names
				(socket as any).emit(event, data);
			}
		}
	}

	emitToFullAccessParticipants(
		roomId: string,
		event: string,
		data: unknown,
	): void {
		this.emitToScope(roomId, 'full', event, data);
	}

	emitToPreviewParticipants(
		roomId: string,
		event: string,
		data: unknown,
	): void {
		this.emitToScope(roomId, 'presence-preview', event, data);
	}

	emitParticipantEvent(
		roomId: string,
		event: 'participant_joined' | 'participant_left',
		participantId: string,
		userData?: UserData,
	): void {
		if (event === 'participant_joined' && userData) {
			this.emitToFullAccessParticipants(roomId, event, {
				roomId,
				participantId,
				userData,
			});
		} else if (event === 'participant_left') {
			this.emitToFullAccessParticipants(roomId, event, {
				roomId,
				participantId,
			});
		}

		if (!participantId.startsWith('preview-')) {
			if (event === 'participant_joined' && userData) {
				this.emitToPreviewParticipants(roomId, event, {
					roomId,
					participantId,
					userData: {
						name: userData.name,
						avatar: userData.avatar,
					} as UserData,
				});
			} else if (event === 'participant_left') {
				this.emitToPreviewParticipants(roomId, event, {
					roomId,
					participantId,
				});
			}
		}
	}
}
