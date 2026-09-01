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
	RecorderStageParticipant,
	RecorderStageProducer,
	RecorderStageProjectionPayload,
	RecorderStageSnapshot,
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

interface RecorderProjectionState {
	participants: Map<string, RecorderStageParticipant>;
	producers: Map<string, RecorderStageProducer>;
	activeSpeakerIds: string[];
	cursor: number;
	lastObservedAt?: string;
}

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
	private recorderProjection = new Map<string, RecorderProjectionState>();

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
		const ownsPeer = this.leaveRecorderRoom(socket, roomId, peerId);
		this.deactivateRecorder(socket);
		return ownsPeer;
	}

	leaveRecorderRoom(socket: Socket, roomId: string, peerId: string): boolean {
		this.recorderSockets.get(roomId)?.delete(socket.id);
		const ownsPeer =
			this.recorderPeerSockets.get(roomId)?.get(peerId) === socket.id;
		try {
			socket.leave(recorderRoom(roomId));
		} finally {
			if (ownsPeer) {
				this.recorderPeerIds.get(roomId)?.delete(peerId);
				this.recorderPeerSockets.get(roomId)?.delete(peerId);
			}
		}
		return ownsPeer;
	}

	isRecorderPeer(roomId: string, peerId: string): boolean {
		return this.recorderPeerIds.get(roomId)?.has(peerId) ?? false;
	}

	isJoinedActiveRecorder(socket: Socket, roomId: string): boolean {
		const recordingId = socket.recordingClaims?.recording_id;
		const peerId = socket.participantId ?? socket.userId;
		return Boolean(
			recordingId &&
				socket.scope === 'recording' &&
				socket.roomId === roomId &&
				this.recorderSockets.get(roomId)?.has(socket.id) &&
				this.recorderPeerSockets.get(roomId)?.get(peerId) === socket.id &&
				this.activeRecordings.get(recordingId)?.socket.id === socket.id,
		);
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

	getRecorderStageSnapshot(roomId: string): RecorderStageSnapshot {
		const state = this.getRecorderProjectionState(roomId);
		const observedAt = this.observeProjectionAt(state);
		return {
			protocol_version: 1,
			room_id: roomId,
			cursor: state.cursor,
			observed_at: observedAt,
			participants: [...state.participants.values()].map((participant) => ({
				...participant,
			})),
			producers: [...state.producers.values()].map((producer) => ({
				...producer,
			})),
			raised_hands: { ...this.getRaisedHands(roomId) },
			active_speaker_ids: [...state.activeSpeakerIds],
		};
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
		this.recorderProjection.delete(roomId);
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
		for (const id of this.recorderSockets.get(roomId) ?? []) {
			const socket: ServerSocket | undefined = this.io.sockets.sockets.get(id);
			if (socket && this.isJoinedActiveRecorder(socket, roomId)) {
				socket.emit(event, ...args);
			}
		}
	}

	private getRecorderProjectionState(roomId: string): RecorderProjectionState {
		let state = this.recorderProjection.get(roomId);
		if (!state) {
			state = {
				participants: new Map(),
				producers: new Map(),
				activeSpeakerIds: [],
				cursor: 0,
			};
			this.recorderProjection.set(roomId, state);
		}
		return state;
	}

	private observeProjectionAt(
		state: RecorderProjectionState,
		candidate?: string,
	): string {
		const parsed = candidate ? new Date(candidate) : new Date();
		const observedAt = Number.isNaN(parsed.getTime())
			? new Date().toISOString()
			: parsed.toISOString();
		state.lastObservedAt =
			state.lastObservedAt && state.lastObservedAt > observedAt
				? state.lastObservedAt
				: observedAt;
		return state.lastObservedAt;
	}

	private emitProjection(
		roomId: string,
		state: RecorderProjectionState,
		observedAt: string,
		payload: RecorderStageProjectionPayload,
	): void {
		state.cursor += 1;
		this.emitToRecorders(roomId, 'recording:projection', {
			protocol_version: 1,
			room_id: roomId,
			cursor: state.cursor,
			observed_at: observedAt,
			payload,
		});
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
		const state = this.getRecorderProjectionState(roomId);
		if (!state.participants.has(data.participantId)) return;
		const observedAt = this.observeProjectionAt(state);
		const producer: RecorderStageProducer = {
			producer_id: data.producerId,
			participant_id: data.participantId,
			kind: data.kind,
			paused: data.paused,
			is_screen: data.isScreen,
			observed_at: observedAt,
		};
		state.producers.set(data.producerId, producer);
		this.emitProjection(roomId, state, observedAt, {
			type: 'producer_created',
			producer,
		});
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
		const state = this.getRecorderProjectionState(roomId);
		const retained = state.producers.get(data.producerId);
		if (
			!retained ||
			retained.participant_id !== data.participantId ||
			retained.is_screen !== data.isScreen
		)
			return;
		const observedAt = this.observeProjectionAt(state);
		state.producers.delete(data.producerId);
		this.emitProjection(roomId, state, observedAt, {
			type: 'producer_closed',
			producer_id: data.producerId,
			participant_id: data.participantId,
			is_screen: data.isScreen,
		});
	}

	emitProducerPaused(
		roomId: string,
		data: { participantId: string; producerId: string; paused: boolean },
	): void {
		const state = this.getRecorderProjectionState(roomId);
		const retained = state.producers.get(data.producerId);
		if (!retained || retained.participant_id !== data.participantId) return;
		const observedAt = this.observeProjectionAt(state);
		state.producers.set(data.producerId, {
			...retained,
			paused: data.paused,
			observed_at: observedAt,
		});
		this.emitProjection(roomId, state, observedAt, {
			type: 'producer_updated',
			producer_id: data.producerId,
			paused: data.paused,
		});
	}

	emitActiveSpeaker(roomId: string, participantIds: string[]): void {
		const payload = { participantIds };
		this.emitToFullAccessParticipants(roomId, 'active_speaker', payload);
		this.emitToRecorders(roomId, 'active_speaker', payload);
		const state = this.getRecorderProjectionState(roomId);
		const observedAt = this.observeProjectionAt(state);
		const retainedIds = participantIds.filter((id) =>
			state.participants.has(id),
		);
		state.activeSpeakerIds = retainedIds;
		this.emitProjection(roomId, state, observedAt, {
			type: 'active_speaker',
			participant_ids: retainedIds,
		});
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
		const state = this.getRecorderProjectionState(roomId);
		const observedAt = this.observeProjectionAt(state, data.timestamp);
		this.emitProjection(roomId, state, observedAt, {
			type: 'reaction',
			from_user: data.fromUser,
			reaction: data.reaction,
		});
	}

	emitRaisedHand(roomId: string, data: HandRaisedEvent): void {
		this.emitToFullAccessParticipants(roomId, 'hand_raised', data);
		this.emitToRecorders(roomId, 'hand_raised', data);
		const state = this.getRecorderProjectionState(roomId);
		if (!state.participants.has(data.participantId)) return;
		const observedAt = this.observeProjectionAt(state, data.timestamp);
		if (data.raised) this.setRaisedHand(roomId, data.participantId, observedAt);
		else this.clearRaisedHand(roomId, data.participantId);
		this.emitProjection(roomId, state, observedAt, {
			type: 'hand_raised',
			participant_id: data.participantId,
			raised: data.raised,
		});
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
		const state = this.getRecorderProjectionState(roomId);
		const observedAt = this.observeProjectionAt(state, data.timestamp);
		this.emitProjection(roomId, state, observedAt, {
			type: 'chat_message',
			message_id: data.messageId,
			message: data.message,
			from_user: data.fromUser,
			from_name: data.fromName,
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
		const state = this.getRecorderProjectionState(roomId);
		if (!state.participants.has(data.participantId)) return;
		const observedAt = this.observeProjectionAt(state, data.timestamp);
		const participant = state.participants.get(data.participantId);
		if (participant) {
			state.participants.set(data.participantId, {
				...participant,
				audio_enabled:
					data.action === 'mute'
						? false
						: data.action === 'unmute'
							? true
							: participant.audio_enabled,
				video_enabled:
					data.action === 'video_off'
						? false
						: data.action === 'video_on'
							? true
							: participant.video_enabled,
			});
		}
		this.emitProjection(roomId, state, observedAt, {
			type: 'media_control',
			participant_id: data.participantId,
			action: data.action,
		});
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
			const avatar = userData.avatar || undefined;
			this.emitToRecorders(roomId, event, {
				roomId,
				participantId,
				userData: {
					name: userData.name,
					...(avatar ? { avatar } : {}),
					audio_enabled: userData.audio_enabled,
					video_enabled: userData.video_enabled,
				},
			});
		} else if (event === 'participant_left') {
			this.emitToRecorders(roomId, event, { roomId, participantId });
		}

		const state = this.getRecorderProjectionState(roomId);
		const observedAt = this.observeProjectionAt(state);
		if (event === 'participant_joined' && userData) {
			const participant: RecorderStageParticipant = {
				participant_id: participantId,
				name: userData.name,
				...(userData.avatar ? { avatar: userData.avatar } : {}),
				audio_enabled: userData.audio_enabled,
				video_enabled: userData.video_enabled,
			};
			state.participants.set(participantId, participant);
			this.emitProjection(roomId, state, observedAt, {
				type: 'participant_joined',
				participant,
			});
		} else if (
			event === 'participant_left' &&
			state.participants.has(participantId)
		) {
			state.participants.delete(participantId);
			this.clearRaisedHand(roomId, participantId);
			state.activeSpeakerIds = state.activeSpeakerIds.filter(
				(id) => id !== participantId,
			);
			for (const [producerId, producer] of state.producers) {
				if (producer.participant_id === participantId)
					state.producers.delete(producerId);
			}
			this.emitProjection(roomId, state, observedAt, {
				type: 'participant_left',
				participant_id: participantId,
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

	emitParticipantUpdated(
		roomId: string,
		participantId: string,
		userData: UserData,
	): void {
		const state = this.getRecorderProjectionState(roomId);
		if (!state.participants.has(participantId)) return;
		const observedAt = this.observeProjectionAt(state);
		const participant: RecorderStageParticipant = {
			participant_id: participantId,
			name: userData.name,
			...(userData.avatar ? { avatar: userData.avatar } : {}),
			audio_enabled: userData.audio_enabled,
			video_enabled: userData.video_enabled,
		};
		state.participants.set(participantId, participant);
		this.emitProjection(roomId, state, observedAt, {
			type: 'participant_updated',
			participant,
		});
	}
}
