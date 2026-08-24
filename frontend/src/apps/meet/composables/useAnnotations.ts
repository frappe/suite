import type { SFUClient } from "../utils/SFUClient";
import {
	normalizeAction,
	normalizeAnnotationBoard,
	normalizeLaser,
	normalizePermission,
	normalizeStrokeChunk,
} from "../utils/annotations/normalize";
import type {
	AnnotationPoint,
	AnnotationStrokeChunk,
} from "../utils/annotations/types";
import type { AnnotationStore } from "./useAnnotationStore";

export interface AnnotationController {
	setupEvents: () => void;
	cleanupEvents: () => void;
	requestSnapshot: (producerId: string) => Promise<void>;
	sendStrokeChunk: (chunk: AnnotationStrokeChunk) => void;
	sendLaser: (
		producerId: string,
		points: AnnotationPoint[],
		active: boolean,
	) => void;
	setPermission: (producerId: string, enabled: boolean) => void;
	undo: (producerId: string) => void;
	clear: (producerId: string) => void;
}

export function useAnnotations(deps: {
	annotationStore: AnnotationStore;
	sfuClient: SFUClient;
}): AnnotationController {
	const { annotationStore, sfuClient } = deps;
	const listeners = new Map<string, (...args: unknown[]) => void>();

	function setupEvents() {
		if (listeners.size) return;
		listen("annotation:stroke", (value) => {
			const chunk = normalizeStrokeChunk(value);
			if (chunk) annotationStore.applyStrokeChunk(chunk);
		});
		listen("annotation:permission", (value) => {
			const permission = normalizePermission(value);
			if (permission) {
				annotationStore.setPermission(
					permission.producerId,
					permission.presenterId,
					permission.participantsCanAnnotate,
				);
			}
		});
		listen("annotation:action", (value) => {
			const action = normalizeAction(value);
			if (action) annotationStore.applyAction(action);
		});
		listen("annotation:laser", (value) => {
			const event = normalizeLaser(value);
			if (!event) return;
			if (event.laser) annotationStore.setLaser(event.laser);
			else annotationStore.removeLaser(event.producerId, event.participantId);
		});
		listen("annotation:board_closed", (value) => {
			if (
				value &&
				typeof value === "object" &&
				"producerId" in value &&
				typeof value.producerId === "string"
			) {
				annotationStore.closeBoard(value.producerId);
			}
		});
	}

	function cleanupEvents() {
		for (const [event, handler] of listeners) sfuClient.off(event, handler);
		listeners.clear();
	}

	async function requestSnapshot(producerId: string) {
		if (!sfuClient.isConnected()) return;
		try {
			const response = await sfuClient.getAnnotationSnapshot(producerId);
			if (
				!response ||
				typeof response !== "object" ||
				!("snapshot" in response)
			) {
				return;
			}
			const snapshot = normalizeAnnotationBoard(response.snapshot);
			if (snapshot) annotationStore.applySnapshot(snapshot);
		} catch (error) {
			console.warn("Could not load screen annotations:", error);
		}
	}

	function sendStrokeChunk(chunk: AnnotationStrokeChunk) {
		if (sfuClient.isConnected()) sfuClient.sendAnnotationStroke(chunk);
	}

	function sendLaser(
		producerId: string,
		points: AnnotationPoint[],
		active: boolean,
	) {
		if (sfuClient.isConnected()) {
			sfuClient.sendAnnotationLaser({ producerId, points, active });
		}
	}

	function setPermission(producerId: string, enabled: boolean) {
		if (sfuClient.isConnected()) {
			sfuClient.sendAnnotationPermission(producerId, enabled);
		}
	}

	function sendAction(producerId: string, action: "undo" | "clear") {
		if (sfuClient.isConnected()) {
			sfuClient.sendAnnotationAction(producerId, action);
		}
	}

	function listen(event: string, handler: (...args: unknown[]) => void) {
		listeners.set(event, handler);
		sfuClient.on(event, handler);
	}

	return {
		setupEvents,
		cleanupEvents,
		requestSnapshot,
		sendStrokeChunk,
		sendLaser,
		setPermission,
		undo: (producerId) => sendAction(producerId, "undo"),
		clear: (producerId) => sendAction(producerId, "clear"),
	};
}
