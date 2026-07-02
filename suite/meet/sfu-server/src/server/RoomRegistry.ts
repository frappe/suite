import type { Server, Socket } from 'socket.io';
import type {
	ActivePoll,
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
	private activePolls: Record<string, Map<string, ActivePoll>> = {};
	private fullAccessSockets: Map<string, Set<string>> = new Map();
	private previewSockets: Map<string, Set<string>> = new Map();
	private nextSenderIdByRoom: Map<string, number> = new Map();
	private participantToSender: Map<string, Map<string, number>> = new Map();

	constructor(io: Server<ClientToServerEvents, ServerToClientEvents>) {
		this.io = io;
	}

	joinScope(
		socket: Socket,
		roomId: string,
		scope: 'full' | 'presence-preview',
	): void {
		socket.join(scope === 'full' ? fullRoom(roomId) : previewRoom(roomId));
		const sockets =
			scope === 'full' ? this.fullAccessSockets : this.previewSockets;
		if (!sockets.has(roomId)) sockets.set(roomId, new Set());
		sockets.get(roomId)?.add(socket.id);
	}

	leaveScope(
		socket: Socket,
		roomId: string,
		scope: 'full' | 'presence-preview',
	): void {
		const sockets =
			scope === 'full' ? this.fullAccessSockets : this.previewSockets;
		sockets.get(roomId)?.delete(socket.id);
		socket.leave(scope === 'full' ? fullRoom(roomId) : previewRoom(roomId));
	}

	getFullAccessSockets(): Map<string, Set<string>> {
		return this.fullAccessSockets;
	}

	getParticipantToSender(): Map<string, Map<string, number>> {
		return this.participantToSender;
	}

	assignSenderId(roomId: string, participantId: string): number {
		const map = this.participantToSender.get(roomId) || new Map();
		const existing = map.get(participantId);
		if (existing !== undefined) return existing;

		const next = this.nextSenderIdByRoom.get(roomId) || 1;
		this.nextSenderIdByRoom.set(roomId, next + 1);
		map.set(participantId, next);
		this.participantToSender.set(roomId, map);
		return next;
	}

	removeSender(roomId: string, participantId: string): void {
		this.participantToSender.get(roomId)?.delete(participantId);
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

	getActivePolls(roomId: string): Map<string, ActivePoll> | undefined {
		return this.activePolls[roomId];
	}

	setActivePolls(roomId: string, polls: Map<string, ActivePoll>): void {
		this.activePolls[roomId] = polls;
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
		delete this.activePolls[roomId];
		this.fullAccessSockets.delete(roomId);
		this.previewSockets.delete(roomId);
		this.nextSenderIdByRoom.delete(roomId);
		this.participantToSender.delete(roomId);
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
