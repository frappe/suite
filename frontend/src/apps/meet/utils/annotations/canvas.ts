import type { AnnotationStroke } from "./types";

export interface ContentRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function getContainedVideoRect(
	containerWidth: number,
	containerHeight: number,
	videoWidth: number,
	videoHeight: number,
): ContentRect {
	if (
		containerWidth <= 0 ||
		containerHeight <= 0 ||
		videoWidth <= 0 ||
		videoHeight <= 0
	) {
		return { left: 0, top: 0, width: containerWidth, height: containerHeight };
	}
	const scale = Math.min(
		containerWidth / videoWidth,
		containerHeight / videoHeight,
	);
	const width = Math.min(containerWidth, videoWidth * scale);
	const height = Math.min(containerHeight, videoHeight * scale);
	return {
		left: (containerWidth - width) / 2,
		top: (containerHeight - height) / 2,
		width,
		height,
	};
}

export function renderAnnotationStrokes(
	context: CanvasRenderingContext2D,
	strokes: AnnotationStroke[],
	width: number,
	height: number,
): void {
	context.clearRect(0, 0, width, height);
	context.lineCap = "round";
	context.lineJoin = "round";

	for (const stroke of strokes) {
		if (!stroke.points.length) continue;
		context.save();
		context.globalCompositeOperation =
			stroke.tool === "eraser" ? "destination-out" : "source-over";
		context.globalAlpha = stroke.tool === "highlighter" ? 0.35 : 1;
		context.strokeStyle = stroke.color;
		context.fillStyle = stroke.color;
		context.lineWidth = Math.max(
			1,
			(stroke.width * Math.min(width, height)) / 720,
		);

		const first = stroke.points[0];
		if (stroke.points.length === 1) {
			context.beginPath();
			context.arc(
				first.x * width,
				first.y * height,
				context.lineWidth / 2,
				0,
				Math.PI * 2,
			);
			context.fill();
		} else {
			context.beginPath();
			context.moveTo(first.x * width, first.y * height);
			for (const point of stroke.points.slice(1)) {
				context.lineTo(point.x * width, point.y * height);
			}
			context.stroke();
		}
		context.restore();
	}
}
