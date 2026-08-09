export interface ReconciledParticipant {
  participantId: string;
}

export interface ReconciledProducer {
  producerId: string;
  participantId: string;
  isScreen: boolean;
}

export type MeetingReconciliationEvent<
  Participant extends ReconciledParticipant,
> =
  | { type: "participant-joined"; value: Participant }
  | { type: "participant-left"; value: { participantId: string } }
  | { type: "producer-created"; value: ReconciledProducer }
  | { type: "producer-closed"; value: ReconciledProducer };

export interface MeetingReconciliationState<
  Participant extends ReconciledParticipant,
> {
  participants: ReadonlyMap<string, Participant>;
  producers: ReadonlyMap<string, ReconciledProducer>;
  departedParticipantIds: ReadonlySet<string>;
  closedProducerIds: ReadonlySet<string>;
}

export interface MeetingSnapshot<Participant extends ReconciledParticipant> {
  participants?: readonly Participant[];
  producers?: readonly ReconciledProducer[];
}

/** Creates empty current state and empty tombstone sets. */
export function createMeetingReconciliationState<
  Participant extends ReconciledParticipant,
>(): MeetingReconciliationState<Participant> {
  return {
    participants: new Map(),
    producers: new Map(),
    departedParticipantIds: new Set(),
    closedProducerIds: new Set(),
  };
}

/**
 * Applies one live event. Later events win, while leave and close events leave
 * tombstones for stale snapshots.
 */
export function applyMeetingReconciliationEvent<
  Participant extends ReconciledParticipant,
>(
  state: MeetingReconciliationState<Participant>,
  event: MeetingReconciliationEvent<Participant>,
): MeetingReconciliationState<Participant> {
  const participants = new Map(state.participants);
  const producers = new Map(state.producers);
  const departedParticipantIds = new Set(state.departedParticipantIds);
  const closedProducerIds = new Set(state.closedProducerIds);

  if (event.type === "participant-joined") {
    if (!participants.has(event.value.participantId)) {
      participants.set(event.value.participantId, event.value);
    }
    departedParticipantIds.delete(event.value.participantId);
  } else if (event.type === "participant-left") {
    participants.delete(event.value.participantId);
    departedParticipantIds.add(event.value.participantId);
    for (const [producerId, producer] of producers) {
      if (producer.participantId === event.value.participantId) {
        producers.delete(producerId);
        closedProducerIds.add(producerId);
      }
    }
  } else if (event.type === "producer-created") {
    closedProducerIds.delete(event.value.producerId);
    if (
      !departedParticipantIds.has(event.value.participantId) &&
      !producers.has(event.value.producerId)
    ) {
      producers.set(event.value.producerId, event.value);
    }
  } else {
    producers.delete(event.value.producerId);
    closedProducerIds.add(event.value.producerId);
  }

  return {
    participants,
    producers,
    departedParticipantIds,
    closedProducerIds,
  };
}

/**
 * Uses supplied snapshot sections as the baseline, then replays live events in
 * arrival order. Omitted sections keep their current state.
 */
export function reconcileMeetingSnapshot<
  Participant extends ReconciledParticipant,
>(
  state: MeetingReconciliationState<Participant>,
  snapshot: MeetingSnapshot<Participant>,
  liveEvents: readonly MeetingReconciliationEvent<Participant>[],
): MeetingReconciliationState<Participant> {
  let reconciled: MeetingReconciliationState<Participant> = {
    participants: snapshot.participants
      ? new Map(
          snapshot.participants.map((participant) => [
            participant.participantId,
            participant,
          ]),
        )
      : new Map(state.participants),
    producers: snapshot.producers
      ? new Map(
          snapshot.producers.map((producer) => [producer.producerId, producer]),
        )
      : new Map(state.producers),
    departedParticipantIds: snapshot.participants
      ? new Set()
      : new Set(state.departedParticipantIds),
    closedProducerIds: snapshot.producers
      ? new Set()
      : new Set(state.closedProducerIds),
  };

  if (snapshot.producers) {
    const producers = new Map(reconciled.producers);
    for (const [producerId, producer] of producers) {
      if (reconciled.departedParticipantIds.has(producer.participantId)) {
        producers.delete(producerId);
      }
    }
    reconciled = { ...reconciled, producers };
  }

  for (const event of liveEvents) {
    reconciled = applyMeetingReconciliationEvent(reconciled, event);
  }
  return reconciled;
}
