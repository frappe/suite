import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useAnnotationStore } from "../../../composables/useAnnotationStore";
import { getContainedVideoRect } from "../canvas";
import { normalizeAnnotationBoard, normalizeStrokeChunk } from "../normalize";

describe("screen annotations", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("maps normalized annotations to the letterboxed video content", () => {
		expect(getContainedVideoRect(1000, 800, 1920, 1080)).toEqual({
			left: 0,
			top: 118.75,
			width: 1000,
			height: 562.5,
		});
	});

	it("builds a stroke from ordered chunks and applies authoritative actions", () => {
		const store = useAnnotationStore();
		store.setPermission("producer-1", "presenter-1", true);
		store.applyStrokeChunk({
			producerId: "producer-1",
			strokeId: "stroke-1",
			phase: "start",
			tool: "pen",
			color: "#ef4444",
			width: 4,
			points: [{ x: 0.1, y: 0.2 }],
			authorId: "participant-1",
			timestamp: "2026-08-24T00:00:00.000Z",
		});
		store.applyStrokeChunk({
			producerId: "producer-1",
			strokeId: "stroke-1",
			phase: "end",
			points: [{ x: 0.3, y: 0.4 }],
			authorId: "participant-1",
			timestamp: "2026-08-24T00:00:00.050Z",
		});

		expect(store.boards["producer-1"].strokes[0].points).toEqual([
			{ x: 0.1, y: 0.2 },
			{ x: 0.3, y: 0.4 },
		]);

		store.applyAction({
			producerId: "producer-1",
			action: "undo",
			strokeId: "stroke-1",
		});
		expect(store.boards["producer-1"].strokes).toEqual([]);
	});

	it("drops malformed snapshots and out-of-bounds event coordinates", () => {
		expect(
			normalizeAnnotationBoard({
				producerId: "producer-1",
				presenterId: "presenter-1",
				participantsCanAnnotate: false,
				strokes: [],
			}),
		).toEqual({
			producerId: "producer-1",
			presenterId: "presenter-1",
			participantsCanAnnotate: false,
			strokes: [],
		});
		expect(
			normalizeStrokeChunk({
				producerId: "producer-1",
				strokeId: "stroke-1",
				phase: "append",
				points: [{ x: 1.1, y: 0.5 }],
			}),
		).toBeNull();
	});
});
