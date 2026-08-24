export type AnnotationTool = "pen" | "highlighter" | "eraser";
export type SelectedAnnotationTool = AnnotationTool | "laser";
export type AnnotationStrokePhase = "start" | "append" | "end";

export interface AnnotationPoint {
	x: number;
	y: number;
}

export interface AnnotationStroke {
	id: string;
	producerId: string;
	authorId: string;
	tool: AnnotationTool;
	color: string;
	width: number;
	points: AnnotationPoint[];
	createdAt: string;
}

export interface AnnotationBoard {
	producerId: string;
	presenterId: string;
	participantsCanAnnotate: boolean;
	strokes: AnnotationStroke[];
}

export interface AnnotationStrokeChunk {
	producerId: string;
	strokeId: string;
	phase: AnnotationStrokePhase;
	points: AnnotationPoint[];
	tool?: AnnotationTool;
	color?: string;
	width?: number;
	authorId?: string;
	timestamp?: string;
}

export interface AnnotationLaser {
	producerId: string;
	participantId: string;
	point: AnnotationPoint;
}

export interface AnnotationAction {
	producerId: string;
	action: "undo" | "clear";
	strokeId?: string;
}
