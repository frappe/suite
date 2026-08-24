<template>
	<div
		ref="overlay"
		class="absolute z-20 overflow-visible pointer-events-none"
		:style="overlayStyle"
	>
		<canvas
			ref="canvas"
			class="absolute inset-0 h-full w-full touch-none"
			:class="
				canDraw && isAnnotating
					? 'pointer-events-auto cursor-crosshair'
					: 'pointer-events-none'
			"
			@pointerdown="handlePointerDown"
			@pointermove="handlePointerMove"
			@pointerup="finishPointer"
			@pointercancel="finishPointer"
		/>

		<div
			v-for="laser in visibleLasers"
			:key="laser.participantId"
			class="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.25)] pointer-events-none"
			:style="{
				left: `${laser.point.x * 100}%`,
				top: `${laser.point.y * 100}%`,
			}"
		/>

		<ScreenAnnotationToolbar
			v-if="showControls"
			v-model:active="isAnnotating"
			v-model:tool="tool"
			v-model:color="color"
			:can-draw="canDraw"
			:is-presenter="isPresenter"
			:participants-can-annotate="Boolean(board?.participantsCanAnnotate)"
			@undo="undo"
			@clear="clear"
			@toggle-permission="toggleParticipantPermission"
		/>
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMeetingContext } from "../composables/useMeetingContext";
import {
	getContainedVideoRect,
	renderAnnotationStrokes,
} from "../utils/annotations/canvas";
import type {
	AnnotationPoint,
	SelectedAnnotationTool,
	AnnotationStroke,
	AnnotationStrokeChunk,
	AnnotationTool,
} from "../utils/annotations/types";
import ScreenAnnotationToolbar from "./ScreenAnnotationToolbar.vue";

const props = defineProps<{
	producerId: string;
	videoElement: HTMLVideoElement | null;
	showControls?: boolean;
}>();
const meetingCtx = useMeetingContext()!;
const overlay = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const contentRect = ref({ left: 0, top: 0, width: 0, height: 0 });
const isAnnotating = ref(false);
const tool = ref<SelectedAnnotationTool>("pen");
const color = ref("#ef4444");
const draftStroke = ref<AnnotationStroke | null>(null);
const pendingPoints: AnnotationPoint[] = [];
let flushTimer: number | null = null;
let resizeObserver: ResizeObserver | null = null;
const board = computed(
	() => meetingCtx.annotationStore.boards[props.producerId],
);
const currentParticipantId = computed(
	() => meetingCtx.currentUser.currentUser.value?.user_id as string | undefined,
);
const isPresenter = computed(
	() => board.value?.presenterId === currentParticipantId.value,
);
const canDraw = computed(
	() => !isPresenter.value && Boolean(board.value?.participantsCanAnnotate),
);
const visibleLasers = computed(() =>
	Object.values(meetingCtx.annotationStore.lasers[props.producerId] || {}),
);
const overlayStyle = computed(() => ({
	left: `${contentRect.value.left}px`,
	top: `${contentRect.value.top}px`,
	width: `${contentRect.value.width}px`,
	height: `${contentRect.value.height}px`,
}));
function updateGeometry() {
	const parent = overlay.value?.parentElement;
	if (!parent) return;
	contentRect.value = getContainedVideoRect(
		parent.clientWidth,
		parent.clientHeight,
		props.videoElement?.videoWidth || 0,
		props.videoElement?.videoHeight || 0,
	);
	renderCanvas();
}
function renderCanvas() {
	const element = canvas.value;
	const width = contentRect.value.width;
	const height = contentRect.value.height;
	if (!element || width <= 0 || height <= 0) return;
	const ratio = window.devicePixelRatio || 1;
	const pixelWidth = Math.round(width * ratio);
	const pixelHeight = Math.round(height * ratio);
	if (element.width !== pixelWidth || element.height !== pixelHeight) {
		element.width = pixelWidth;
		element.height = pixelHeight;
	}
	const context = element.getContext("2d");
	if (!context) return;
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	const committed = (board.value?.strokes || []).filter(
		(stroke) => stroke.id !== draftStroke.value?.id,
	);
	renderAnnotationStrokes(
		context,
		draftStroke.value ? [...committed, draftStroke.value] : committed,
		width,
		height,
	);
}
function handlePointerDown(event: PointerEvent) {
	if (!canDraw.value || !isAnnotating.value) return;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	const point = getPoint(event);
	if (tool.value === "laser") {
		meetingCtx.annotations.sendLaser(props.producerId, [point], true);
		return;
	}
	const strokeTool: AnnotationTool = tool.value;
	const stroke: AnnotationStroke = {
		id: createStrokeId(),
		producerId: props.producerId,
		authorId: currentParticipantId.value || "",
		tool: strokeTool,
		color: strokeTool === "eraser" ? "#000000" : color.value,
		width: strokeTool === "eraser" ? 22 : strokeTool === "highlighter" ? 12 : 4,
		points: [point],
		createdAt: new Date().toISOString(),
	};
	draftStroke.value = stroke;
	meetingCtx.annotations.sendStrokeChunk(toChunk(stroke, "start", [point]));
	renderCanvas();
}

function handlePointerMove(event: PointerEvent) {
	if (!canvas.value?.hasPointerCapture(event.pointerId)) return;
	const point = getPoint(event);
	if (tool.value === "laser") {
		pendingPoints.push(point);
		scheduleFlush("laser");
		return;
	}
	if (!draftStroke.value) return;
	draftStroke.value.points.push(point);
	pendingPoints.push(point);
	scheduleFlush("stroke");
	renderCanvas();
}

function finishPointer(event: PointerEvent) {
	if (!canvas.value?.hasPointerCapture(event.pointerId)) return;
	canvas.value.releasePointerCapture(event.pointerId);
	if (tool.value === "laser") {
		flushLaser();
		meetingCtx.annotations.sendLaser(props.producerId, [], false);
		return;
	}
	if (!draftStroke.value) return;
	clearFlushTimer();
	meetingCtx.annotations.sendStrokeChunk(
		toChunk(draftStroke.value, "end", pendingPoints.splice(0)),
	);
	draftStroke.value = null;
	renderCanvas();
}

function scheduleFlush(kind: "stroke" | "laser") {
	if (flushTimer !== null) return;
	flushTimer = window.setTimeout(() => {
		flushTimer = null;
		if (kind === "laser") flushLaser();
		else flushStroke();
	}, 50);
}

function flushStroke() {
	if (!draftStroke.value || !pendingPoints.length) return;
	meetingCtx.annotations.sendStrokeChunk(
		toChunk(draftStroke.value, "append", pendingPoints.splice(0)),
	);
}

function flushLaser() {
	if (!pendingPoints.length) return;
	meetingCtx.annotations.sendLaser(
		props.producerId,
		pendingPoints.splice(0),
		true,
	);
}

function clearFlushTimer() {
	if (flushTimer !== null) window.clearTimeout(flushTimer);
	flushTimer = null;
}

function getPoint(event: PointerEvent): AnnotationPoint {
	const bounds = canvas.value!.getBoundingClientRect();
	return {
		x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
		y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
	};
}

function toChunk(
	stroke: AnnotationStroke,
	phase: AnnotationStrokeChunk["phase"],
	points: AnnotationPoint[],
): AnnotationStrokeChunk {
	return {
		producerId: stroke.producerId,
		strokeId: stroke.id,
		phase,
		points,
		...(phase === "start"
			? { tool: stroke.tool, color: stroke.color, width: stroke.width }
			: {}),
	};
}

function createStrokeId() {
	return `stroke_${crypto.randomUUID().replaceAll("-", "")}`;
}

function undo() {
	meetingCtx.annotations.undo(props.producerId);
}

function clear() {
	meetingCtx.annotations.clear(props.producerId);
}

function toggleParticipantPermission() {
	meetingCtx.annotations.setPermission(
		props.producerId,
		!board.value?.participantsCanAnnotate,
	);
}

watch(() => [board.value?.strokes, draftStroke.value], renderCanvas, {
	deep: true,
});
watch(canDraw, (enabled) => {
	if (!enabled) isAnnotating.value = false;
});
watch(
	() => props.producerId,
	(producerId) => meetingCtx.annotations.requestSnapshot(producerId),
);
watch(
	() => props.videoElement,
	(current, previous) => {
		previous?.removeEventListener("loadedmetadata", updateGeometry);
		current?.addEventListener("loadedmetadata", updateGeometry);
		updateGeometry();
	},
);

onMounted(() => {
	const parent = overlay.value?.parentElement;
	if (parent) {
		resizeObserver = new ResizeObserver(updateGeometry);
		resizeObserver.observe(parent);
	}
	props.videoElement?.addEventListener("loadedmetadata", updateGeometry);
	meetingCtx.annotations.requestSnapshot(props.producerId);
	updateGeometry();
});

onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	props.videoElement?.removeEventListener("loadedmetadata", updateGeometry);
	clearFlushTimer();
});
</script>
