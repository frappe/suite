import type {
	AnnotationSnapshot,
	AnnotationStroke,
	AnnotationStrokeChunkRequest,
} from '../types';

const MAX_STROKES = 200;
const MAX_POINTS_PER_STROKE = 4096;
const MAX_POINTS_PER_BOARD = 40_000;

interface AnnotationBoard {
	producerId: string;
	presenterId: string;
	participantsCanAnnotate: boolean;
	strokes: AnnotationStroke[];
}

export class AnnotationBoardStore {
	private boardsByRoom = new Map<string, Map<string, AnnotationBoard>>();

	startBoard(roomId: string, producerId: string, presenterId: string): boolean {
		const boards = this.getRoomBoards(roomId);
		const existing = boards.get(producerId);
		if (existing) {
			if (existing.presenterId !== presenterId) {
				throw new Error('Annotation board presenter mismatch');
			}
			return false;
		}
		boards.set(producerId, {
			producerId,
			presenterId,
			participantsCanAnnotate: true,
			strokes: [],
		});
		return true;
	}

	closeBoard(roomId: string, producerId: string): boolean {
		const boards = this.boardsByRoom.get(roomId);
		const deleted = boards?.delete(producerId) ?? false;
		if (boards?.size === 0) this.boardsByRoom.delete(roomId);
		return deleted;
	}

	cleanupRoom(roomId: string): void {
		this.boardsByRoom.delete(roomId);
	}

	getSnapshot(roomId: string, producerId: string): AnnotationSnapshot | null {
		const board = this.getBoard(roomId, producerId);
		if (!board) return null;
		return {
			producerId: board.producerId,
			presenterId: board.presenterId,
			participantsCanAnnotate: board.participantsCanAnnotate,
			strokes: board.strokes.map((stroke) => ({
				...stroke,
				points: stroke.points.map((point) => ({ ...point })),
			})),
		};
	}

	setPermission(
		roomId: string,
		producerId: string,
		participantId: string,
		participantsCanAnnotate: boolean,
	): AnnotationSnapshot {
		const board = this.requireBoard(roomId, producerId);
		this.requirePresenter(board, participantId);
		board.participantsCanAnnotate = participantsCanAnnotate;
		return this.getSnapshot(roomId, producerId) as AnnotationSnapshot;
	}

	applyStrokeChunk(
		roomId: string,
		participantId: string,
		chunk: AnnotationStrokeChunkRequest,
		timestamp: string,
	): void {
		const board = this.requireBoard(roomId, chunk.producerId);
		this.requireAnnotator(board, participantId);

		if (chunk.phase === 'start') {
			this.startStroke(board, participantId, chunk, timestamp);
			return;
		}

		const stroke = board.strokes.find((item) => item.id === chunk.strokeId);
		if (!stroke || stroke.authorId !== participantId) {
			throw new Error('Annotation stroke is unavailable');
		}
		if (stroke.points.length + chunk.points.length > MAX_POINTS_PER_STROKE) {
			throw new Error('Annotation stroke is too large');
		}
		stroke.points.push(...chunk.points);
	}

	undo(
		roomId: string,
		producerId: string,
		participantId: string,
	): string | null {
		const board = this.requireBoard(roomId, producerId);
		this.requireAnnotator(board, participantId);
		const canUndoAny = board.presenterId === participantId;
		for (let index = board.strokes.length - 1; index >= 0; index -= 1) {
			const stroke = board.strokes[index];
			if (canUndoAny || stroke.authorId === participantId) {
				board.strokes.splice(index, 1);
				return stroke.id;
			}
		}
		return null;
	}

	clear(roomId: string, producerId: string, participantId: string): void {
		const board = this.requireBoard(roomId, producerId);
		this.requirePresenter(board, participantId);
		board.strokes = [];
	}

	private startStroke(
		board: AnnotationBoard,
		participantId: string,
		chunk: AnnotationStrokeChunkRequest,
		timestamp: string,
	): void {
		if (!chunk.tool || !chunk.color || chunk.width === undefined) {
			throw new Error('Annotation stroke metadata is required');
		}
		if (board.strokes.some((stroke) => stroke.id === chunk.strokeId)) {
			throw new Error('Annotation stroke already exists');
		}
		while (
			board.strokes.length >= MAX_STROKES ||
			this.getPointCount(board) + chunk.points.length > MAX_POINTS_PER_BOARD
		) {
			board.strokes.shift();
		}
		board.strokes.push({
			id: chunk.strokeId,
			producerId: chunk.producerId,
			authorId: participantId,
			tool: chunk.tool,
			color: chunk.color,
			width: chunk.width,
			points: [...chunk.points],
			createdAt: timestamp,
		});
	}

	private getPointCount(board: AnnotationBoard): number {
		return board.strokes.reduce(
			(total, stroke) => total + stroke.points.length,
			0,
		);
	}

	private getRoomBoards(roomId: string): Map<string, AnnotationBoard> {
		let boards = this.boardsByRoom.get(roomId);
		if (!boards) {
			boards = new Map();
			this.boardsByRoom.set(roomId, boards);
		}
		return boards;
	}

	private getBoard(roomId: string, producerId: string): AnnotationBoard | null {
		return this.boardsByRoom.get(roomId)?.get(producerId) ?? null;
	}

	private requireBoard(roomId: string, producerId: string): AnnotationBoard {
		const board = this.getBoard(roomId, producerId);
		if (!board) throw new Error('Annotation board is unavailable');
		return board;
	}

	private requirePresenter(
		board: AnnotationBoard,
		participantId: string,
	): void {
		if (board.presenterId !== participantId) {
			throw new Error('Only the presenter can change this annotation setting');
		}
	}

	private requireAnnotator(
		board: AnnotationBoard,
		participantId: string,
	): void {
		if (board.presenterId === participantId)
			throw new Error('Presenters cannot annotate their own screen share');
		if (!board.participantsCanAnnotate)
			throw new Error('The presenter has disabled viewer annotations');
	}
}
