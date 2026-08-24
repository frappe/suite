import type { Socket } from 'socket.io';
import type {
	AnnotationLaserRequest,
	AnnotationPoint,
	AnnotationStrokeChunkRequest,
	AnnotationTool,
} from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { checkSocketRateLimits } from './utils';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const TOOLS = new Set<AnnotationTool>(['pen', 'highlighter', 'eraser']);
const PHASES = new Set(['start', 'append', 'end']);

interface AnnotationPayload {
	producerId?: unknown;
	strokeId?: unknown;
	phase?: unknown;
	tool?: unknown;
	color?: unknown;
	width?: unknown;
	points?: unknown;
	active?: unknown;
	participantsCanAnnotate?: unknown;
	action?: unknown;
	x?: unknown;
	y?: unknown;
}

export function registerAnnotationHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('annotation:stroke', (rawData) => {
			try {
				const context = getContext(deps, socket);
				if (!isWithinRateLimit(deps, socket, 'stroke', 260, 800)) return;
				const chunk = normalizeStrokeChunk(rawData);
				const timestamp = new Date().toISOString();
				deps.registry.annotationBoards.applyStrokeChunk(
					context.roomId,
					context.participantId,
					chunk,
					timestamp,
				);
				deps.registry.emitAnnotation(
					context.roomId,
					chunk.producerId,
					'annotation:stroke',
					{ ...chunk, authorId: context.participantId, timestamp },
				);
			} catch (error) {
				logFailure('annotation:stroke', error);
			}
		});

		socket.on('annotation:laser', (rawData) => {
			try {
				const context = getContext(deps, socket);
				if (!isWithinRateLimit(deps, socket, 'laser', 240, 720)) return;
				const laser = normalizeLaser(rawData);
				const snapshot = deps.registry.annotationBoards.getSnapshot(
					context.roomId,
					laser.producerId,
				);
				if (
					!snapshot ||
					snapshot.presenterId === context.participantId ||
					!snapshot.participantsCanAnnotate
				) {
					throw new Error('Viewer annotations are unavailable');
				}
				deps.registry.emitAnnotation(
					context.roomId,
					laser.producerId,
					'annotation:laser',
					{
						...laser,
						participantId: context.participantId,
						timestamp: new Date().toISOString(),
					},
				);
			} catch (error) {
				logFailure('annotation:laser', error);
			}
		});

		socket.on('annotation:permission', (rawData) => {
			try {
				const context = getContext(deps, socket);
				const data = requireRecord(rawData);
				const producerId = requireId(data.producerId, 'producerId');
				if (typeof data.participantsCanAnnotate !== 'boolean') {
					throw new Error('Invalid annotation permission');
				}
				const snapshot = deps.registry.annotationBoards.setPermission(
					context.roomId,
					producerId,
					context.participantId,
					data.participantsCanAnnotate,
				);
				deps.registry.emitAnnotation(
					context.roomId,
					producerId,
					'annotation:permission',
					{
						producerId,
						presenterId: snapshot.presenterId,
						participantsCanAnnotate: snapshot.participantsCanAnnotate,
					},
				);
			} catch (error) {
				logFailure('annotation:permission', error);
			}
		});

		socket.on('annotation:action', (rawData) => {
			try {
				const context = getContext(deps, socket);
				const data = requireRecord(rawData);
				const producerId = requireId(data.producerId, 'producerId');
				if (data.action !== 'undo' && data.action !== 'clear') {
					throw new Error('Invalid annotation action');
				}
				const strokeId =
					data.action === 'undo'
						? deps.registry.annotationBoards.undo(
								context.roomId,
								producerId,
								context.participantId,
							)
						: undefined;
				if (data.action === 'clear') {
					deps.registry.annotationBoards.clear(
						context.roomId,
						producerId,
						context.participantId,
					);
				}
				deps.registry.emitAnnotation(
					context.roomId,
					producerId,
					'annotation:action',
					{
						producerId,
						action: data.action,
						...(strokeId ? { strokeId } : {}),
					},
				);
			} catch (error) {
				logFailure('annotation:action', error);
			}
		});

		socket.on('annotation:get_snapshot', (rawData, callback) => {
			try {
				const context = getContext(deps, socket);
				const producerId = requireId(
					requireRecord(rawData).producerId,
					'producerId',
				);
				const snapshot = deps.registry.annotationBoards.getSnapshot(
					context.roomId,
					producerId,
				);
				callback(
					snapshot
						? { success: true, snapshot }
						: { success: false, error: 'Annotation board is unavailable' },
				);
			} catch (error) {
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('annotation:create_overlay_grant', (rawData, callback) => {
			try {
				const context = getContext(deps, socket);
				const producerId = parseProducerId(rawData);
				const snapshot = deps.registry.annotationBoards.getSnapshot(
					context.roomId,
					producerId,
				);
				if (!snapshot || snapshot.presenterId !== context.participantId) {
					throw new Error('Only the screen presenter can launch an overlay');
				}
				callback({
					success: true,
					...deps.annotationOverlayGrantManager.issue({
						meetingId: socket.meetingId,
						site: socket.site,
						presenterId: context.participantId,
						producerId,
					}),
				});
			} catch (error) {
				callback({ success: false, error: (error as Error).message });
			}
		});
	};
}

function parseProducerId(value: unknown): string {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('producerId' in value) ||
		typeof value.producerId !== 'string' ||
		!ID_PATTERN.test(value.producerId)
	) {
		throw new Error('Invalid annotation producer');
	}
	return value.producerId;
}

function getContext(deps: HandlerDeps, socket: Socket) {
	deps.authManager.ensureFullAccess(socket);
	if (!socket.roomId || !socket.participantId) {
		throw new Error('Participant has not joined a room');
	}
	return { roomId: socket.roomId, participantId: socket.participantId };
}

function isWithinRateLimit(
	deps: HandlerDeps,
	socket: Socket,
	surface: string,
	userLimit: number,
	ipLimit: number,
): boolean {
	return checkSocketRateLimits(
		socket,
		deps.rateLimiter,
		userLimit,
		ipLimit,
		10_000,
		deps.runtime.bypassRateLimits,
		`annotation:${surface}:`,
	);
}

function normalizeStrokeChunk(rawData: unknown): AnnotationStrokeChunkRequest {
	const data = requireRecord(rawData);
	const phase = typeof data.phase === 'string' ? data.phase : '';
	if (!PHASES.has(phase)) throw new Error('Invalid annotation stroke phase');
	const points = normalizePoints(data.points, phase === 'end');
	const tool =
		typeof data.tool === 'string' && TOOLS.has(data.tool as AnnotationTool)
			? (data.tool as AnnotationTool)
			: undefined;
	const color =
		typeof data.color === 'string' && COLOR_PATTERN.test(data.color)
			? data.color.toLowerCase()
			: undefined;
	const width =
		typeof data.width === 'number' && Number.isFinite(data.width)
			? Math.min(24, Math.max(1, data.width))
			: undefined;
	if (phase === 'start' && (!tool || !color || width === undefined)) {
		throw new Error('Invalid annotation stroke metadata');
	}
	return {
		producerId: requireId(data.producerId, 'producerId'),
		strokeId: requireId(data.strokeId, 'strokeId'),
		phase: phase as AnnotationStrokeChunkRequest['phase'],
		points,
		...(tool ? { tool } : {}),
		...(color ? { color } : {}),
		...(width !== undefined ? { width } : {}),
	};
}

function normalizeLaser(rawData: unknown): AnnotationLaserRequest {
	const data = requireRecord(rawData);
	if (typeof data.active !== 'boolean') throw new Error('Invalid laser state');
	return {
		producerId: requireId(data.producerId, 'producerId'),
		active: data.active,
		points: normalizePoints(data.points, !data.active, 16),
	};
}

function normalizePoints(
	value: unknown,
	allowEmpty = false,
	maximum = 64,
): AnnotationPoint[] {
	if (!Array.isArray(value) || value.length > maximum) {
		throw new Error('Invalid annotation points');
	}
	if (!allowEmpty && value.length === 0) {
		throw new Error('Annotation points are required');
	}
	return value.map((point) => {
		const record = requireRecord(point);
		if (
			typeof record.x !== 'number' ||
			typeof record.y !== 'number' ||
			!Number.isFinite(record.x) ||
			!Number.isFinite(record.y) ||
			record.x < 0 ||
			record.x > 1 ||
			record.y < 0 ||
			record.y > 1
		) {
			throw new Error('Annotation point is outside the shared screen');
		}
		return { x: record.x, y: record.y };
	});
}

function requireRecord(value: unknown): AnnotationPayload {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid annotation payload');
	}
	return value as AnnotationPayload;
}

function requireId(value: unknown, field: string): string {
	if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
		throw new Error(`Invalid ${field}`);
	}
	return value;
}

function logFailure(event: string, error: unknown): void {
	loggers.socketHandler.warn(
		'%s handling failed: %s',
		event,
		(error as Error).message || error,
	);
}
