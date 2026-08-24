import { isUnknownRecord } from "../../types";
import type {
	AnnotationAction,
	AnnotationBoard,
	AnnotationLaser,
	AnnotationPoint,
	AnnotationStroke,
	AnnotationStrokeChunk,
	AnnotationStrokePhase,
	AnnotationTool,
} from "./types";

const TOOLS = new Set<AnnotationTool>(["pen", "highlighter", "eraser"]);
const PHASES = new Set<AnnotationStrokePhase>(["start", "append", "end"]);

export function normalizeAnnotationBoard(
	value: unknown,
): AnnotationBoard | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.producerId !== "string" ||
		typeof value.presenterId !== "string" ||
		typeof value.participantsCanAnnotate !== "boolean" ||
		!Array.isArray(value.strokes)
	) {
		return null;
	}
	const strokes = value.strokes
		.map(normalizeStroke)
		.filter((stroke): stroke is AnnotationStroke => stroke !== null);
	return {
		producerId: value.producerId,
		presenterId: value.presenterId,
		participantsCanAnnotate: value.participantsCanAnnotate,
		strokes,
	};
}

export function normalizeStrokeChunk(
	value: unknown,
): AnnotationStrokeChunk | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.producerId !== "string" ||
		typeof value.strokeId !== "string" ||
		typeof value.phase !== "string" ||
		!PHASES.has(value.phase as AnnotationStrokePhase)
	) {
		return null;
	}
	const points = normalizePoints(value.points);
	if (!points) return null;
	const tool = TOOLS.has(value.tool as AnnotationTool)
		? (value.tool as AnnotationTool)
		: undefined;
	return {
		producerId: value.producerId,
		strokeId: value.strokeId,
		phase: value.phase as AnnotationStrokePhase,
		points,
		...(tool ? { tool } : {}),
		...(typeof value.color === "string" ? { color: value.color } : {}),
		...(typeof value.width === "number" ? { width: value.width } : {}),
		...(typeof value.authorId === "string" ? { authorId: value.authorId } : {}),
		...(typeof value.timestamp === "string"
			? { timestamp: value.timestamp }
			: {}),
	};
}

export function normalizePermission(value: unknown): {
	producerId: string;
	presenterId: string;
	participantsCanAnnotate: boolean;
} | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.producerId !== "string" ||
		typeof value.presenterId !== "string" ||
		typeof value.participantsCanAnnotate !== "boolean"
	) {
		return null;
	}
	return {
		producerId: value.producerId,
		presenterId: value.presenterId,
		participantsCanAnnotate: value.participantsCanAnnotate,
	};
}

export function normalizeAction(value: unknown): AnnotationAction | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.producerId !== "string" ||
		(value.action !== "undo" && value.action !== "clear")
	) {
		return null;
	}
	return {
		producerId: value.producerId,
		action: value.action,
		...(typeof value.strokeId === "string" ? { strokeId: value.strokeId } : {}),
	};
}

export function normalizeLaser(value: unknown): {
	laser: AnnotationLaser | null;
	active: boolean;
	producerId: string;
	participantId: string;
} | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.producerId !== "string" ||
		typeof value.participantId !== "string" ||
		typeof value.active !== "boolean"
	) {
		return null;
	}
	const points = normalizePoints(value.points);
	if (!points) return null;
	const point = points.at(-1);
	return {
		producerId: value.producerId,
		participantId: value.participantId,
		active: value.active,
		laser:
			value.active && point
				? {
						producerId: value.producerId,
						participantId: value.participantId,
						point,
					}
				: null,
	};
}

function normalizeStroke(value: unknown): AnnotationStroke | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.producerId !== "string" ||
		typeof value.authorId !== "string" ||
		typeof value.tool !== "string" ||
		!TOOLS.has(value.tool as AnnotationTool) ||
		typeof value.color !== "string" ||
		typeof value.width !== "number" ||
		typeof value.createdAt !== "string"
	) {
		return null;
	}
	const points = normalizePoints(value.points);
	if (!points) return null;
	return {
		id: value.id,
		producerId: value.producerId,
		authorId: value.authorId,
		tool: value.tool as AnnotationTool,
		color: value.color,
		width: value.width,
		points,
		createdAt: value.createdAt,
	};
}

function normalizePoints(value: unknown): AnnotationPoint[] | null {
	if (!Array.isArray(value)) return null;
	const points: AnnotationPoint[] = [];
	for (const point of value) {
		if (
			!isUnknownRecord(point) ||
			typeof point.x !== "number" ||
			typeof point.y !== "number" ||
			!Number.isFinite(point.x) ||
			!Number.isFinite(point.y) ||
			point.x < 0 ||
			point.x > 1 ||
			point.y < 0 ||
			point.y > 1
		) {
			return null;
		}
		points.push({ x: point.x, y: point.y });
	}
	return points;
}
