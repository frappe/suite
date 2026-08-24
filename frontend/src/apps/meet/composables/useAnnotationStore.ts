import { defineStore } from "pinia";
import { ref } from "vue";
import type {
	AnnotationAction,
	AnnotationBoard,
	AnnotationLaser,
	AnnotationStroke,
	AnnotationStrokeChunk,
} from "../utils/annotations/types";

interface TimedLaser extends AnnotationLaser {
	timeoutId: number;
}

export const useAnnotationStore = defineStore("meet-annotations", () => {
	const boards = ref<Record<string, AnnotationBoard>>({});
	const lasers = ref<Record<string, Record<string, TimedLaser>>>({});

	function applySnapshot(snapshot: AnnotationBoard) {
		boards.value = {
			...boards.value,
			[snapshot.producerId]: {
				...snapshot,
				strokes: snapshot.strokes.map(cloneStroke),
			},
		};
	}

	function applyStrokeChunk(chunk: AnnotationStrokeChunk) {
		const board = boards.value[chunk.producerId];
		if (!board || !chunk.authorId || !chunk.timestamp) return;

		if (chunk.phase === "start") {
			if (!chunk.tool || !chunk.color || chunk.width === undefined) return;
			if (board.strokes.some((stroke) => stroke.id === chunk.strokeId)) return;
			board.strokes.push({
				id: chunk.strokeId,
				producerId: chunk.producerId,
				authorId: chunk.authorId,
				tool: chunk.tool,
				color: chunk.color,
				width: chunk.width,
				points: [...chunk.points],
				createdAt: chunk.timestamp,
			});
			return;
		}

		const stroke = board.strokes.find((item) => item.id === chunk.strokeId);
		if (stroke) stroke.points.push(...chunk.points);
	}

	function setPermission(
		producerId: string,
		presenterId: string,
		participantsCanAnnotate: boolean,
	) {
		const current = boards.value[producerId];
		boards.value = {
			...boards.value,
			[producerId]: {
				producerId,
				presenterId,
				participantsCanAnnotate,
				strokes: current?.strokes || [],
			},
		};
	}

	function applyAction(action: AnnotationAction) {
		const board = boards.value[action.producerId];
		if (!board) return;
		if (action.action === "clear") {
			board.strokes = [];
		} else if (action.strokeId) {
			board.strokes = board.strokes.filter(
				(stroke) => stroke.id !== action.strokeId,
			);
		}
	}

	function setLaser(laser: AnnotationLaser | null) {
		if (!laser) return;
		const producerLasers = lasers.value[laser.producerId] || {};
		const existing = producerLasers[laser.participantId];
		if (existing?.timeoutId) window.clearTimeout(existing.timeoutId);
		const timeoutId = window.setTimeout(() => {
			removeLaser(laser.producerId, laser.participantId);
		}, 900);
		lasers.value = {
			...lasers.value,
			[laser.producerId]: {
				...producerLasers,
				[laser.participantId]: { ...laser, timeoutId },
			},
		};
	}

	function removeLaser(producerId: string, participantId: string) {
		const producerLasers = { ...(lasers.value[producerId] || {}) };
		const existing = producerLasers[participantId];
		if (existing?.timeoutId) window.clearTimeout(existing.timeoutId);
		delete producerLasers[participantId];
		lasers.value = { ...lasers.value, [producerId]: producerLasers };
	}

	function closeBoard(producerId: string) {
		const nextBoards = { ...boards.value };
		delete nextBoards[producerId];
		boards.value = nextBoards;
		for (const laser of Object.values(lasers.value[producerId] || {})) {
			window.clearTimeout(laser.timeoutId);
		}
		const nextLasers = { ...lasers.value };
		delete nextLasers[producerId];
		lasers.value = nextLasers;
	}

	function $reset() {
		for (const producerLasers of Object.values(lasers.value)) {
			for (const laser of Object.values(producerLasers)) {
				window.clearTimeout(laser.timeoutId);
			}
		}
		boards.value = {};
		lasers.value = {};
	}

	return {
		boards,
		lasers,
		applySnapshot,
		applyStrokeChunk,
		setPermission,
		applyAction,
		setLaser,
		removeLaser,
		closeBoard,
		$reset,
	};
});

function cloneStroke(stroke: AnnotationStroke): AnnotationStroke {
	return {
		...stroke,
		points: stroke.points.map((point) => ({ ...point })),
	};
}

export type AnnotationStore = ReturnType<typeof useAnnotationStore>;
