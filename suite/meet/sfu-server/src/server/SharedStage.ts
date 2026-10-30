import { randomUUID } from 'node:crypto';
import type { RecorderStageParticipant, SharedStageState } from '../types';

const SUSTAIN_MS = 1000;
const ACTIVITY_LEASE_MS = 1600;
const RECENT_MS = 120_000;
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Room-owned selection and presentation, independent of endpoint history. */
export class SharedStage {
	private participants: RecorderStageParticipant[] = [];
	private hands: Record<string, string> = {};
	private candidates = new Map<string, { since: number; until: number }>();
	private recent = new Map<string, { turn: number; until: number }>();
	private active = new Set<string>();
	private turn = 0;
	private slots: Record<string, string[]> = {};
	private selfSlots = new Map<string, Record<string, string[]>>();
	private arrivals = new Map<string, number>();
	private arrival = 0;
	private timer?: ReturnType<typeof setTimeout>;
	private state: SharedStageState = {
		epoch: randomUUID(),
		protocolVersion: 1,
		version: 0,
		participantIds: [],
		activeSpeakerIds: [],
	};
	constructor(private readonly publish: (state: SharedStageState) => void) {}

	get snapshot(): SharedStageState {
		return this.snapshotFor();
	}

	snapshotFor(excludedParticipantId?: string): SharedStageState {
		const slots = this.selfSlots.get(excludedParticipantId ?? '') ?? this.slots;
		return {
			...(excludedParticipantId ? { excludedParticipantId } : {}),
			...this.state,
			participantIds: [...this.state.participantIds],
			activeSpeakerIds: [...this.state.activeSpeakerIds],
			presentationOrders: Object.fromEntries(
				Object.entries(slots).map(([capacity, ids]) => [capacity, [...ids]]),
			),
		};
	}

	inventory(
		participants: RecorderStageParticipant[],
		hands: Record<string, string>,
	): void {
		this.participants = participants;
		this.hands = { ...hands };
		const ids = new Set(participants.map((p) => p.participant_id));
		for (const map of [this.arrivals, this.selfSlots])
			for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
		for (const id of [...ids].sort(compareIds))
			if (!this.arrivals.has(id)) this.arrivals.set(id, ++this.arrival);
		for (const map of [this.candidates, this.recent])
			for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
		for (const id of this.active) if (!ids.has(id)) this.active.delete(id);
		this.reconcile();
	}

	activity(ids: string[]): void {
		const now = Date.now();
		const current = new Set(ids);
		for (const id of this.candidates.keys())
			if (!current.has(id)) this.candidates.delete(id);
		for (const id of current) {
			if (!this.participants.some((p) => p.participant_id === id)) continue;
			const previous = this.candidates.get(id);
			this.candidates.set(id, {
				since: previous && previous.until > now ? previous.since : now,
				until: now + ACTIVITY_LEASE_MS,
			});
		}
		this.reconcile();
	}

	close(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	private updateSlots(ids: string[], slots: Record<string, string[]>): void {
		// Desktop grid supports at most 16 tiles, including self/screens/overflow.
		for (let capacity = 1; capacity <= 16; capacity++) {
			const selected = ids.slice(0, capacity);
			const entrants = selected.filter((id) => !slots[capacity]?.includes(id));
			const next = (slots[capacity] ?? []).map((id) =>
				selected.includes(id) ? id : undefined,
			);
			for (let index = 0; index < selected.length; index++) {
				if (next[index]) continue;
				if (entrants.length) next[index] = entrants.shift();
				else {
					const tail = next.findIndex(
						(id, position) => position >= selected.length && !!id,
					);
					if (tail >= 0) {
						next[index] = next[tail];
						next[tail] = undefined;
					}
				}
			}
			slots[capacity] = next
				.slice(0, selected.length)
				.filter((id): id is string => !!id);
		}
	}

	private reconcile = (): void => {
		this.close();
		const now = Date.now();
		for (const [id, value] of this.candidates)
			if (value.until <= now) this.candidates.delete(id);
		for (const [id, value] of this.recent)
			if (value.until <= now) this.recent.delete(id);
		const active = new Set(
			[...this.candidates]
				.filter(([, v]) => now - v.since >= SUSTAIN_MS)
				.map(([id]) => id),
		);
		// A turn is promotion into sustained activity, not accumulated speaking time.
		const promoted = [...active]
			.filter((id) => !this.active.has(id))
			.sort(compareIds);
		if (promoted.length) {
			const turn = ++this.turn;
			for (const id of promoted)
				this.recent.set(id, { turn, until: now + RECENT_MS });
		}
		for (const id of active) {
			const recent = this.recent.get(id);
			if (recent) recent.until = now + RECENT_MS;
		}
		this.active = active;
		const priority = (p: RecorderStageParticipant) =>
			active.has(p.participant_id)
				? p.video_enabled
					? 0
					: 1
				: this.hands[p.participant_id]
					? 2
					: this.recent.has(p.participant_id)
						? p.video_enabled
							? 3
							: 4
						: p.video_enabled
							? 5
							: 6;
		const ids = [...this.participants]
			.sort((a, b) => {
				const difference = priority(a) - priority(b);
				if (difference) return difference;
				const left = a.participant_id,
					right = b.participant_id;
				if (this.hands[left] && this.hands[right]) {
					const order = compareIds(this.hands[left], this.hands[right]);
					if (order) return order;
				}
				return (
					(this.recent.get(right)?.turn ?? 0) -
						(this.recent.get(left)?.turn ?? 0) ||
					this.arrivals.get(left)! - this.arrivals.get(right)!
				);
			})
			.map((p) => p.participant_id);
		// Keep a canonical presentation for every prefix. A selected survivor stays
		// in its slot; only vacancies receive entrants. This history belongs to the
		// room snapshot, never to an endpoint that may have joined late.
		const rankingChanged = ids.length !== this.state.participantIds.length ||
			ids.some((id, index) => id !== this.state.participantIds[index]);
		if (rankingChanged) {
			this.updateSlots(ids, this.slots);
			for (const id of ids) {
				let slots = this.selfSlots.get(id);
				if (!slots) {
					slots = Object.fromEntries(
						Object.entries(this.slots).map(([capacity, order]) => [
							capacity,
							order.filter((member) => member !== id),
						]),
					);
					this.selfSlots.set(id, slots);
				}
			}
			for (const [self, slots] of this.selfSlots)
				this.updateSlots(
					ids.filter((id) => id !== self),
					slots,
				);
		}
		const activeIds = ids.filter((id) => active.has(id));
		if (
			rankingChanged ||
			activeIds.length !== this.state.activeSpeakerIds.length ||
			activeIds.some((id, index) => id !== this.state.activeSpeakerIds[index])
		) {
			this.state = {
				epoch: this.state.epoch,
				protocolVersion: 1,
				version: this.state.version + 1,
				participantIds: ids,
				activeSpeakerIds: activeIds,
			};
			this.publish(this.snapshot);
		}
		const deadlines = [...this.candidates.values()]
			.flatMap((v) => [v.until, v.since + SUSTAIN_MS])
			.concat([...this.recent.values()].map((v) => v.until))
			.filter((t) => t > now);
		if (deadlines.length) {
			this.timer = setTimeout(this.reconcile, Math.min(...deadlines) - now);
			this.timer.unref?.();
		}
	};
}
