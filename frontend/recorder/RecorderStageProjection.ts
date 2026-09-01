import type {
	RecorderStageParticipant,
	RecorderStageProducer,
	RecorderStageProjectionEvent,
	RecorderStageSnapshot,
} from "../../suite/meet/types";

export class RecorderStageProjection {
	readonly participants = new Map<string, RecorderStageParticipant>();
	readonly producers = new Map<string, RecorderStageProducer>();
	readonly raisedHands = new Map<string, string>();
	activeSpeakerIds: string[] = [];
	roomId?: string;
	cursor?: number;
	private observedAt?: string;
	private latestEvent?: RecorderStageProjectionEvent;
	private bufferedEvents: RecorderStageProjectionEvent[] = [];
	private reconciling = true;

	constructor(private readonly meetingId?: string) {}

	applyEvent(event: RecorderStageProjectionEvent): RecorderStageProjectionEvent[] {
		if (this.reconciling || this.cursor === undefined) {
			this.bufferedEvents.push(event);
			return [];
		}
		return this.applyInitializedEvent(event);
	}

	beginReconciliation(): void {
		if (this.reconciling) return;
		this.reconciling = true;
		this.bufferedEvents = [];
	}

	initialize(snapshot: RecorderStageSnapshot): RecorderStageProjectionEvent[] {
		if (this.cursor !== undefined) throw new Error("Projection already initialized");
		return this.reconcile(snapshot);
	}

	reconcile(snapshot: RecorderStageSnapshot): RecorderStageProjectionEvent[] {
		if (!this.reconciling) throw new Error("Projection is not reconciling");
		if (this.roomId === undefined && this.meetingId !== undefined) {
			const separator = snapshot.room_id.lastIndexOf("::");
			const snapshotMeetingId =
				separator === -1 ? snapshot.room_id : snapshot.room_id.slice(separator + 2);
			if (snapshotMeetingId !== this.meetingId)
				throw new Error(
					`Projection meeting mismatch: expected ${this.meetingId}, received ${snapshotMeetingId}`,
				);
		}
		if (this.roomId !== undefined && snapshot.room_id !== this.roomId)
			this.roomMismatch(snapshot.room_id);
		if (this.cursor !== undefined && snapshot.cursor < this.cursor)
			throw new Error("Projection snapshot cursor regressed");
		if (this.observedAt !== undefined && snapshot.observed_at < this.observedAt)
			throw new Error("Projection snapshot timestamp regressed");
		this.validateSnapshot(snapshot);
		this.roomId = snapshot.room_id;
		this.cursor = snapshot.cursor;
		this.observedAt = snapshot.observed_at;
		if (this.latestEvent?.cursor !== snapshot.cursor) this.latestEvent = undefined;
		this.participants.clear();
		this.producers.clear();
		this.raisedHands.clear();
		for (const participant of snapshot.participants)
			this.participants.set(participant.participant_id, participant);
		for (const producer of snapshot.producers)
			this.producers.set(producer.producer_id, producer);
		for (const [participantId, timestamp] of Object.entries(snapshot.raised_hands))
			this.raisedHands.set(participantId, timestamp);
		this.activeSpeakerIds = [...snapshot.active_speaker_ids];

		const buffered = this.bufferedEvents.splice(0).sort((a, b) => a.cursor - b.cursor);
		for (const event of buffered) this.assertRoom(event.room_id);
		this.reconciling = false;
		const accepted: RecorderStageProjectionEvent[] = [];
		for (const event of buffered) {
			if (event.cursor < snapshot.cursor) continue;
			if (event.cursor === snapshot.cursor && !this.latestEvent) continue;
			accepted.push(...this.applyInitializedEvent(event));
		}
		return accepted;
	}

	private applyInitializedEvent(event: RecorderStageProjectionEvent): RecorderStageProjectionEvent[] {
		this.assertRoom(event.room_id);
		const cursor = this.cursor as number;
		if (event.cursor < cursor)
			throw new Error(`Projection cursor regressed: ${event.cursor} after ${cursor}`);
		if (event.cursor === cursor) {
			if (this.latestEvent && JSON.stringify(event) === JSON.stringify(this.latestEvent))
				return [];
			throw new Error(`Conflicting projection event at cursor ${cursor}`);
		}
		if (event.cursor !== cursor + 1)
			throw new Error(`Projection cursor gap: expected ${cursor + 1}, received ${event.cursor}`);
		if (this.observedAt !== undefined && event.observed_at < this.observedAt)
			throw new Error("Projection event timestamp regressed");
		this.applyPayload(event);
		this.cursor = event.cursor;
		this.observedAt = event.observed_at;
		this.latestEvent = event;
		return [event];
	}

	private applyPayload(event: RecorderStageProjectionEvent): void {
		const payload = event.payload;
		switch (payload.type) {
			case "participant_joined":
				if (this.participants.has(payload.participant.participant_id))
					throw new Error("Duplicate participant relationship");
				this.participants.set(payload.participant.participant_id, payload.participant);
				break;
			case "participant_updated":
				this.requireParticipant(payload.participant.participant_id);
				this.participants.set(payload.participant.participant_id, payload.participant);
				break;
			case "participant_left":
				this.requireParticipant(payload.participant_id);
				this.participants.delete(payload.participant_id);
				this.raisedHands.delete(payload.participant_id);
				this.activeSpeakerIds = this.activeSpeakerIds.filter((id) => id !== payload.participant_id);
				for (const [id, producer] of this.producers)
					if (producer.participant_id === payload.participant_id) this.producers.delete(id);
				break;
			case "producer_created":
				this.requireParticipant(payload.producer.participant_id);
				if (this.producers.has(payload.producer.producer_id))
					throw new Error("Duplicate producer relationship");
				if (payload.producer.is_screen && payload.producer.kind !== "video")
					throw new Error("Audio producer cannot be a screen share");
				if (payload.producer.observed_at > event.observed_at)
					throw new Error("Producer timestamp follows event timestamp");
				this.producers.set(payload.producer.producer_id, payload.producer);
				break;
			case "producer_updated": {
				const producer = this.producers.get(payload.producer_id);
				if (!producer) throw new Error("Projection producer is absent");
				this.producers.set(payload.producer_id, {
					...producer,
					paused: payload.paused,
					observed_at: event.observed_at,
				});
				break;
			}
			case "producer_closed": {
				const producer = this.producers.get(payload.producer_id);
				if (!producer || producer.participant_id !== payload.participant_id || producer.is_screen !== payload.is_screen)
					throw new Error("Producer close metadata mismatch");
				this.producers.delete(payload.producer_id);
				break;
			}
			case "media_control": {
				const participant = this.requireParticipant(payload.participant_id);
				const audio = payload.action === "mute" || payload.action === "unmute";
				this.participants.set(payload.participant_id, {
					...participant,
					...(audio
						? { audio_enabled: payload.action === "unmute" }
						: { video_enabled: payload.action === "video_on" }),
				});
				break;
			}
			case "active_speaker":
				if (new Set(payload.participant_ids).size !== payload.participant_ids.length)
					throw new Error("Duplicate active speaker relationship");
				for (const id of payload.participant_ids) this.requireParticipant(id);
				this.activeSpeakerIds = [...payload.participant_ids];
				break;
			case "hand_raised":
				this.requireParticipant(payload.participant_id);
				if (payload.raised) this.raisedHands.set(payload.participant_id, event.observed_at);
				else this.raisedHands.delete(payload.participant_id);
				break;
			case "reaction":
			case "chat_message":
				break;
		}
	}

	private validateSnapshot(snapshot: RecorderStageSnapshot): void {
		const participantIds = new Set(snapshot.participants.map((p) => p.participant_id));
		const producerIds = new Set(snapshot.producers.map((p) => p.producer_id));
		if (participantIds.size !== snapshot.participants.length) throw new Error("Duplicate snapshot participant");
		if (producerIds.size !== snapshot.producers.length) throw new Error("Duplicate snapshot producer");
		for (const producer of snapshot.producers) {
			if (!participantIds.has(producer.participant_id)) throw new Error("Orphan snapshot producer");
			if (producer.is_screen && producer.kind !== "video") throw new Error("Audio snapshot screen producer");
			if (producer.observed_at > snapshot.observed_at) throw new Error("Producer timestamp follows snapshot");
		}
		for (const id of Object.keys(snapshot.raised_hands))
			if (!participantIds.has(id)) throw new Error("Orphan snapshot raised hand");
		if (new Set(snapshot.active_speaker_ids).size !== snapshot.active_speaker_ids.length)
			throw new Error("Duplicate snapshot active speaker");
		for (const id of snapshot.active_speaker_ids)
			if (!participantIds.has(id)) throw new Error("Orphan snapshot active speaker");
	}

	private requireParticipant(id: string): RecorderStageParticipant {
		const participant = this.participants.get(id);
		if (!participant) throw new Error(`Projection participant ${id} is absent`);
		return participant;
	}

	private assertRoom(roomId: string): void {
		if (roomId !== this.roomId) this.roomMismatch(roomId);
	}

	private roomMismatch(roomId: string): never {
		throw new Error(`Projection room mismatch: expected ${this.roomId}, received ${roomId}`);
	}
}
