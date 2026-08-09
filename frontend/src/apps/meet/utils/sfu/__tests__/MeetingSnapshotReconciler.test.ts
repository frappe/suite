import { describe, expect, it } from "vitest";
import {
  applyMeetingReconciliationEvent,
  createMeetingReconciliationState,
  reconcileMeetingSnapshot,
  type MeetingReconciliationEvent,
} from "../MeetingSnapshotReconciler";

interface Participant {
  participantId: string;
  name: string;
}

const participant = (participantId: string): Participant => ({
  participantId,
  name: participantId,
});
const producer = (producerId: string, participantId = "alice") => ({
  producerId,
  participantId,
  isScreen: false,
});

describe("MeetingSnapshotReconciler", () => {
  it("uses the snapshot as a baseline and replays live events in arrival order", () => {
    const events: MeetingReconciliationEvent<Participant>[] = [
      { type: "participant-left", value: { participantId: "alice" } },
      { type: "participant-joined", value: participant("alice") },
      { type: "producer-created", value: producer("new") },
    ];

    const state = reconcileMeetingSnapshot(
      createMeetingReconciliationState<Participant>(),
      { participants: [participant("alice")], producers: [producer("old")] },
      events,
    );

    expect([...state.participants.keys()]).toEqual(["alice"]);
    expect([...state.producers.keys()]).toEqual(["new"]);
  });

  it("lets leaves and closes beat stale snapshot entries", () => {
    const state = reconcileMeetingSnapshot(
      createMeetingReconciliationState<Participant>(),
      {
        participants: [participant("alice")],
        producers: [producer("audio"), producer("video")],
      },
      [
        { type: "producer-closed", value: producer("audio") },
        { type: "participant-left", value: { participantId: "alice" } },
      ],
    );

    expect(state.participants.size).toBe(0);
    expect(state.producers.size).toBe(0);
  });

  it("is idempotent and ignores producers for a departed participant", () => {
    let state = createMeetingReconciliationState<Participant>();
    const events: MeetingReconciliationEvent<Participant>[] = [
      { type: "participant-left", value: { participantId: "alice" } },
      { type: "participant-left", value: { participantId: "alice" } },
      { type: "producer-created", value: producer("ignored") },
      { type: "producer-closed", value: producer("ignored") },
      { type: "producer-closed", value: producer("ignored") },
    ];
    for (const event of events)
      state = applyMeetingReconciliationEvent(state, event);

    expect(state.participants.size).toBe(0);
    expect(state.producers.size).toBe(0);
    expect([...state.departedParticipantIds]).toEqual(["alice"]);
    expect([...state.closedProducerIds]).toEqual(["ignored"]);
  });

  it("keeps the first live producer claim when a create is duplicated", () => {
    const first = producer("audio");
    let state = applyMeetingReconciliationEvent(
      createMeetingReconciliationState<Participant>(),
      { type: "producer-created", value: first },
    );
    state = applyMeetingReconciliationEvent(state, {
      type: "producer-created",
      value: producer("audio"),
    });

    expect(state.producers.get("audio")).toBe(first);
  });

  it("preserves participant state during producer-only reconciliation", () => {
    const initial = reconcileMeetingSnapshot(
      createMeetingReconciliationState<Participant>(),
      { participants: [participant("alice")] },
      [],
    );
    const state = reconcileMeetingSnapshot(
      initial,
      { producers: [producer("audio")] },
      [],
    );

    expect([...state.participants.values()]).toEqual([participant("alice")]);
    expect([...state.producers.keys()]).toEqual(["audio"]);
  });
});
