import type { Server, Socket } from 'socket.io';
import type {
	ActivePoll,
	ChatMessage,
	ClientToServerEvents,
	MediaControlAction,
	ReactionMessage,
	ServerToClientEvents,
	UserData,
} from '../types';

const fullRoom = (roomId: string) => `${roomId}:full`;
const previewRoom = (roomId: string) => `${roomId}:preview`;
const recorderRoom = (roomId: string) => `${roomId}:recorders`;

export class RoomRegistry {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private raisedHands: Record<string, Record<string, string>> = {};
	private hostOnlyChat: Record<string, boolean> = {};
	private participantSockets: Record<string, Record<string, string>> = {};
	private activePolls: Record<string, Map<string, ActivePoll>> = {};
	private fullAccessSockets: Map<string, Set<string>> = new Map();
	private previewSockets: Map<string, Set<string>> = new Map();
	private recorderSockets: Map<string, Set<string>> = new Map();
	private recorderPeerIds: Map<string, Set<string>> = new Map();
	private recorderPeerSockets: Map<string, Map<string, string>> = new Map();
	private activeRecordings = new Map<
		string,
		{ jobId: string; socket: Socket }
	>();
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

	activateRecorder(socket: Socket, recordingId: string, jobId: string): void {
		const current = this.activeRecordings.get(recordingId);
		if (current && current.jobId !== jobId) {
			throw new Error('Recording session is already connected');
		}
		this.activeRecordings.set(recordingId, { jobId, socket });
		if (current && current.socket.id !== socket.id)
			current.socket.disconnect(true);
	}

	joinRecorder(socket: Socket, roomId: string, peerId: string): void {
		socket.join(recorderRoom(roomId));
		if (!this.recorderSockets.has(roomId))
			this.recorderSockets.set(roomId, new Set());
		this.recorderSockets.get(roomId)?.add(socket.id);
		if (!this.recorderPeerIds.has(roomId))
			this.recorderPeerIds.set(roomId, new Set());
		this.recorderPeerIds.get(roomId)?.add(peerId);
		if (!this.recorderPeerSockets.has(roomId))
			this.recorderPeerSockets.set(roomId, new Map());
		this.recorderPeerSockets.get(roomId)?.set(peerId, socket.id);
	}

	leaveRecorder(socket: Socket, roomId: string, peerId: string): boolean {
		this.recorderSockets.get(roomId)?.delete(socket.id);
		socket.leave(recorderRoom(roomId));
		const ownsPeer =
			this.recorderPeerSockets.get(roomId)?.get(peerId) === socket.id;
		if (ownsPeer) {
			this.recorderPeerIds.get(roomId)?.delete(peerId);
			this.recorderPeerSockets.get(roomId)?.delete(peerId);
		}
		const claims = socket.recordingClaims;
		if (
			claims &&
			this.activeRecordings.get(claims.recording_id)?.socket.id === socket.id
		) {
			this.activeRecordings.delete(claims.recording_id);
		}
		return ownsPeer;
	}

	isRecorderPeer(roomId: string, peerId: string): boolean {
		return this.recorderPeerIds.get(roomId)?.has(peerId) ?? false;
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
		const recorders = adapter.rooms.get(recorderRoom(roomId))?.size ?? 0;
		return full === 0 && preview === 0 && recorders === 0;
	}

	cleanupRoom(roomId: string): void {
		delete this.raisedHands[roomId];
		delete this.hostOnlyChat[roomId];
		delete this.participantSockets[roomId];
		delete this.activePolls[roomId];
		this.fullAccessSockets.delete(roomId);
		this.previewSockets.delete(roomId);
		this.recorderSockets.delete(roomId);
		this.recorderPeerIds.delete(roomId);
		this.recorderPeerSockets.delete(roomId);
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

	private emitToRecorders(roomId: string, event: string, data: unknown): void {
		const ids = this.io.sockets.adapter.rooms.get(recorderRoom(roomId));
		if (!ids) return;
		for (const id of ids) {
			const socket = this.io.sockets.sockets.get(id);
			if (socket) {
				// biome-ignore lint/suspicious/noExplicitAny: Internal utility used only by the explicit recorder allowlist below
				(socket as any).emit(event, data);
			}
		}
	}

	emitProducerCreated(
		roomId: string,
		data: {
			participantId: string;
			producerId: string;
			kind: string;
			paused: boolean;
			isScreen: boolean;
		},
	): void {
		const payload = { roomId, ...data };
		this.emitToFullAccessParticipants(roomId, 'producer_created', payload);
		this.emitToRecorders(roomId, 'producer_created', payload);
	}

	emitProducerClosed(
		roomId: string,
		data: {
			participantId: string;
			producerId: string;
			isScreen: boolean;
			reason?: string;
			source?: string;
			details?: Record<string, unknown>;
		},
	): void {
		this.emitToFullAccessParticipants(roomId, 'producer_closed', {
			roomId,
			...data,
		});
		this.emitToRecorders(roomId, 'producer_closed', {
			roomId,
			participantId: data.participantId,
			producerId: data.producerId,
			isScreen: data.isScreen,
		});
	}

	emitActiveSpeaker(roomId: string, participantIds: string[]): void {
		const payload = { participantIds };
		this.emitToFullAccessParticipants(roomId, 'active_speaker', payload);
		this.emitToRecorders(roomId, 'active_speaker', payload);
	}

	emitScreenShare(
		roomId: string,
		event: 'screen_share_started' | 'screen_share_stopped',
		data: Record<string, unknown>,
	): void {
		this.emitToFullAccessParticipants(roomId, event, data);
		const shareData = data.shareData as Record<string, unknown> | undefined;
		this.emitToRecorders(roomId, event, {
			participantId: data.participantId,
			...(event === 'screen_share_started' && shareData?.producerId
				? { shareData: { producerId: shareData.producerId } }
				: {}),
			timestamp: data.timestamp,
		});
	}

	emitReaction(roomId: string, data: ReactionMessage): void {
		this.emitToFullAccessParticipants(roomId, 'reaction:message', data);
		this.emitToRecorders(roomId, 'reaction:message', data);
	}

	emitRaisedHand(roomId: string, data: Record<string, unknown>): void {
		this.emitToFullAccessParticipants(roomId, 'hand_raised', data);
		this.emitToRecorders(roomId, 'hand_raised', data);
	}

	emitPublicChat(roomId: string, data: ChatMessage): void {
		this.emitToFullAccessParticipants(roomId, 'chat:message', data);
		this.emitToRecorders(roomId, 'chat:message', {
			roomId: data.roomId,
			message: data.message,
			fromUser: data.fromUser,
			fromName: data.fromName,
			timestamp: data.timestamp,
		});
	}

	emitMediaControlUpdate(
		roomId: string,
		data: {
			participantId: string;
			action: MediaControlAction;
			timestamp: string;
		},
	): void {
		this.emitToFullAccessParticipants(roomId, 'media_control_update', data);
		this.emitToRecorders(roomId, 'media_control_update', data);
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

		if (event === 'participant_joined' && userData) {
			this.emitToRecorders(roomId, event, {
				roomId,
				participantId,
				userData: {
					name: userData.name,
					avatar: userData.avatar,
					audio_enabled: userData.audio_enabled,
					video_enabled: userData.video_enabled,
				},
			});
		} else if (event === 'participant_left') {
			this.emitToRecorders(roomId, event, { roomId, participantId });
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
