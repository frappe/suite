import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type {
	ActivePoll,
	ChatMessage,
	ClientToServerEvents,
	HandRaisedEvent,
	MediaControlAction,
	PinnedChatMessage,
	ProducerCloseDetails,
	ProducerCloseReason,
	ProducerCloseSource,
	ReactionMessage,
	ScreenShareStartedEvent,
	ScreenShareStoppedEvent,
	ServerToClientEvents,
	SocketData,
	UserData,
} from '../types';

type ServerSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;
type ServerEventName = keyof ServerToClientEvents;

const fullRoom = (roomId: string) => `${roomId}:full`;
const previewRoom = (roomId: string) => `${roomId}:preview`;
const recorderRoom = (roomId: string) => `${roomId}:recorders`;

export class RoomRegistry {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private raisedHands: Record<string, Record<string, string>> = {};
	private hostOnlyChat: Record<string, boolean> = {};
	private recentChatMessages: Record<string, ChatMessage[]> = {};
	private pinnedChatMessage: Record<string, PinnedChatMessage> = {};
	private participantConnections = new Map<
		string,
		Map<
			string,
			{
				socket: Socket;
				connectionId: string;
				ownershipId: string;
			}
		>
	>();
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
	private revokedParticipants = new Map<string, Set<string>>();

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

	deactivateRecorder(socket: Socket): void {
		const recordingId = socket.recordingClaims?.recording_id;
		if (
			recordingId &&
			this.activeRecordings.get(recordingId)?.socket.id === socket.id
		) {
			this.activeRecordings.delete(recordingId);
		}
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
		this.deactivateRecorder(socket);
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

	/**
	 * Claims the participant's active connection. A matching connectionId reconnects;
	 * a different connection requires the incumbent generation as conflictId.
	 */
	acquireParticipant(
		socket: Socket,
		roomId: string,
		participantId: string,
		connectionId: string,
		conflictId?: string,
	):
		| {
				status: 'acquired' | 'idempotent' | 'reconnect' | 'takeover';
				ownershipId: string;
				replacedSocket?: Socket;
		  }
		| { status: 'conflict'; conflictId: string } {
		let participants = this.participantConnections.get(roomId);
		if (!participants) {
			participants = new Map();
			this.participantConnections.set(roomId, participants);
		}
		const incumbent = participants.get(participantId);
		if (!incumbent) {
			const ownershipId = randomUUID();
			participants.set(participantId, { socket, connectionId, ownershipId });
			socket.participantConnectionId = connectionId;
			socket.participantOwnershipId = ownershipId;
			return { status: 'acquired', ownershipId };
		}

		if (
			incumbent.socket.id === socket.id &&
			incumbent.connectionId === connectionId
		) {
			socket.participantConnectionId = connectionId;
			socket.participantOwnershipId = incumbent.ownershipId;
			return { status: 'idempotent', ownershipId: incumbent.ownershipId };
		}

		const reconnect = incumbent.connectionId === connectionId;
		if (!reconnect && conflictId !== incumbent.ownershipId) {
			return { status: 'conflict', conflictId: incumbent.ownershipId };
		}

		const ownershipId = randomUUID();
		participants.set(participantId, { socket, connectionId, ownershipId });
		socket.participantConnectionId = connectionId;
		socket.participantOwnershipId = ownershipId;
		return {
			status: reconnect ? 'reconnect' : 'takeover',
			ownershipId,
			replacedSocket: incumbent.socket,
		};
	}

	/** Releases ownership only when the socket still holds the current generation. */
	releaseParticipant(
		socket: Socket,
		roomId: string,
		participantId: string,
		ownershipId = socket.participantOwnershipId,
	): boolean {
		const participants = this.participantConnections.get(roomId);
		const owner = participants?.get(participantId);
		if (
			!owner ||
			owner.socket.id !== socket.id ||
			!ownershipId ||
			owner.ownershipId !== ownershipId
		)
			return false;
		participants?.delete(participantId);
		if (participants?.size === 0) this.participantConnections.delete(roomId);
		return true;
	}

	/** Returns the single active participant socket, if ownership is currently held. */
	getParticipantSocketIds(roomId: string, participantId: string): string[] {
		const owner = this.participantConnections.get(roomId)?.get(participantId);
		return owner ? [owner.socket.id] : [];
	}

	/** Checks both socket identity and ownership generation to reject stale sockets. */
	isParticipantOwner(
		socket: Socket,
		roomId: string,
		participantId: string,
	): boolean {
		const owner = this.participantConnections.get(roomId)?.get(participantId);
		return (
			owner?.socket.id === socket.id &&
			owner.ownershipId === socket.participantOwnershipId
		);
	}

	hasHumanParticipants(roomId: string): boolean {
		return (this.participantConnections.get(roomId)?.size ?? 0) > 0;
	}

	revokeParticipant(roomId: string, participantId: string): void {
		let revoked = this.revokedParticipants.get(roomId);
		if (!revoked) {
			revoked = new Set();
			this.revokedParticipants.set(roomId, revoked);
		}
		revoked.add(participantId);
	}

	isParticipantRevoked(roomId: string, participantId: string): boolean {
		return this.revokedParticipants.get(roomId)?.has(participantId) ?? false;
	}

	getRecorderSockets(roomId: string): Socket[] {
		return [...(this.recorderSockets.get(roomId) ?? [])]
			.map((socketId) => this.io.sockets.sockets.get(socketId))
			.filter((socket): socket is Socket => Boolean(socket));
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

	/** Keep the bounded message window used to resolve pin requests. */
	recordChatMessage(roomId: string, message: ChatMessage): void {
		const buffer = this.recentChatMessages[roomId] ?? [];
		buffer.push(message);
		if (buffer.length > 200) buffer.shift();
		this.recentChatMessages[roomId] = buffer;
	}

	/** Resolve a message that is still eligible for pinning. */
	getRecentChatMessage(
		roomId: string,
		messageId: string,
	): ChatMessage | undefined {
		return this.recentChatMessages[roomId]?.find(
			(message) => message.messageId === messageId,
		);
	}

	/** Set or clear the room-wide pin; room cleanup removes this ephemeral state. */
	setPinnedChatMessage(roomId: string, pinned: PinnedChatMessage | null): void {
		if (pinned === null) delete this.pinnedChatMessage[roomId];
		else this.pinnedChatMessage[roomId] = pinned;
	}

	/** Return the current room-wide pin, if one exists. */
	getPinnedChatMessage(roomId: string): PinnedChatMessage | null {
		return this.pinnedChatMessage[roomId] ?? null;
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
		this.cleanupMediaRoom(roomId);
		this.previewSockets.delete(roomId);
	}

	cleanupMediaRoom(roomId: string): void {
		const recorderSocketIds = this.recorderSockets.get(roomId) ?? new Set();
		for (const [recordingId, active] of this.activeRecordings) {
			if (recorderSocketIds.has(active.socket.id))
				this.activeRecordings.delete(recordingId);
		}
		delete this.raisedHands[roomId];
		delete this.hostOnlyChat[roomId];
		delete this.recentChatMessages[roomId];
		delete this.pinnedChatMessage[roomId];
		this.participantConnections.delete(roomId);
		delete this.activePolls[roomId];
		this.fullAccessSockets.delete(roomId);
		this.recorderSockets.delete(roomId);
		this.recorderPeerIds.delete(roomId);
		this.recorderPeerSockets.delete(roomId);
		this.nextSenderIdByRoom.delete(roomId);
		this.participantToSender.delete(roomId);
		this.revokedParticipants.delete(roomId);
	}

	emitToScope<Event extends ServerEventName>(
		roomId: string,
		scope: 'full' | 'presence-preview',
		event: Event,
		...args: Parameters<ServerToClientEvents[Event]>
	): void {
		const key = scope === 'full' ? fullRoom(roomId) : previewRoom(roomId);
		const ids = this.io.sockets.adapter.rooms.get(key);
		if (!ids) return;
		for (const id of ids) {
			const socket: ServerSocket | undefined = this.io.sockets.sockets.get(id);
			if (socket) {
				socket.emit(event, ...args);
			}
		}
	}

	emitToFullAccessParticipants<Event extends ServerEventName>(
		roomId: string,
		event: Event,
		...args: Parameters<ServerToClientEvents[Event]>
	): void {
		this.emitToScope(roomId, 'full', event, ...args);
	}

	emitToPreviewParticipants<Event extends ServerEventName>(
		roomId: string,
		event: Event,
		...args: Parameters<ServerToClientEvents[Event]>
	): void {
		this.emitToScope(roomId, 'presence-preview', event, ...args);
	}

	private emitToRecorders<Event extends ServerEventName>(
		roomId: string,
		event: Event,
		...args: Parameters<ServerToClientEvents[Event]>
	): void {
		const ids = this.io.sockets.adapter.rooms.get(recorderRoom(roomId));
		if (!ids) return;
		for (const id of ids) {
			const socket: ServerSocket | undefined = this.io.sockets.sockets.get(id);
			if (socket) {
				socket.emit(event, ...args);
			}
		}
	}

	emitProducerCreated(
		roomId: string,
		data: {
			participantId: string;
			producerId: string;
			kind: 'audio' | 'video';
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
			reason?: ProducerCloseReason;
			source?: ProducerCloseSource;
			details?: ProducerCloseDetails;
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
		event: 'screen_share_started',
		data: ScreenShareStartedEvent,
	): void;
	emitScreenShare(
		roomId: string,
		event: 'screen_share_stopped',
		data: ScreenShareStoppedEvent,
	): void;
	emitScreenShare(
		roomId: string,
		event: 'screen_share_started' | 'screen_share_stopped',
		data: ScreenShareStartedEvent | ScreenShareStoppedEvent,
	): void {
		if (event === 'screen_share_started' && 'shareData' in data) {
			this.emitToFullAccessParticipants(roomId, event, data);
			const producerId =
				typeof data.shareData.producerId === 'string'
					? data.shareData.producerId
					: undefined;
			this.emitToRecorders(roomId, event, {
				participantId: data.participantId,
				shareData: producerId ? { producerId } : {},
				timestamp: data.timestamp,
			});
			return;
		}
		if (event === 'screen_share_stopped' && 'producerId' in data) {
			this.emitToFullAccessParticipants(roomId, event, data);
			this.emitToRecorders(roomId, event, {
				participantId: data.participantId,
				producerId: data.producerId,
				timestamp: data.timestamp,
			});
		}
	}

	emitReaction(roomId: string, data: ReactionMessage): void {
		this.emitToFullAccessParticipants(roomId, 'reaction:message', data);
		this.emitToRecorders(roomId, 'reaction:message', data);
	}

	emitRaisedHand(roomId: string, data: HandRaisedEvent): void {
		this.emitToFullAccessParticipants(roomId, 'hand_raised', data);
		this.emitToRecorders(roomId, 'hand_raised', data);
	}

	emitPublicChat(roomId: string, data: ChatMessage): void {
		this.emitToFullAccessParticipants(roomId, 'chat:message', data);
		this.emitToRecorders(roomId, 'chat:message', {
			roomId: data.roomId,
			messageId: data.messageId,
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
					},
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
