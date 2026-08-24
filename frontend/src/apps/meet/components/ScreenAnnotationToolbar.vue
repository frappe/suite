<template>
	<div
		class="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-gray-900/90 p-1 text-white shadow-xl backdrop-blur pointer-events-auto"
		role="toolbar"
		aria-label="Screen annotation controls"
		@click.stop
	>
		<template v-if="isPresenter">
			<button
				class="annotation-button"
				title="Clear viewer annotations"
				aria-label="Clear viewer annotations"
				@click="emit('clear')"
			>
				<Trash2 class="h-4 w-4" />
			</button>
			<button
				class="ml-1 rounded-md px-2 py-1 text-xs font-medium transition"
				:class="
					participantsCanAnnotate
						? 'bg-green-600'
						: 'bg-white/10 hover:bg-white/15'
				"
				:aria-pressed="participantsCanAnnotate"
				@click="emit('toggle-permission')"
			>
				{{ participantsCanAnnotate ? "Viewers can draw" : "Viewers blocked" }}
			</button>
		</template>

		<template v-else>
			<button
				class="annotation-button"
				:class="{ 'annotation-button-active': active }"
				:disabled="!canDraw"
				:title="
					canDraw ? 'Annotate screen' : 'The presenter has disabled annotations'
				"
				aria-label="Toggle screen annotation"
				@click="emit('update:active', !active)"
			>
				<Pencil class="h-4 w-4" />
			</button>

			<template v-if="active && canDraw">
				<div class="mx-0.5 h-5 w-px bg-white/15" />
				<button
					v-for="item in tools"
					:key="item.value"
					class="annotation-button"
					:class="{ 'annotation-button-active': tool === item.value }"
					:title="item.label"
					:aria-label="item.label"
					@click="emit('update:tool', item.value)"
				>
					<component :is="item.icon" class="h-4 w-4" />
				</button>
				<div v-if="tool !== 'eraser'" class="flex items-center gap-1 px-1">
					<button
						v-for="swatch in colors"
						:key="swatch"
						class="h-4 w-4 rounded-full border-2"
						:class="color === swatch ? 'border-white' : 'border-transparent'"
						:style="{ backgroundColor: swatch }"
						:aria-label="`Use ${swatch}`"
						@click="emit('update:color', swatch)"
					/>
				</div>
				<div class="mx-0.5 h-5 w-px bg-white/15" />
				<button
					class="annotation-button"
					title="Undo"
					aria-label="Undo annotation"
					@click="emit('undo')"
				>
					<Undo2 class="h-4 w-4" />
				</button>
			</template>
		</template>
	</div>
</template>

<script setup lang="ts">
import {
	Eraser,
	Highlighter,
	MousePointer2,
	Pencil,
	Trash2,
	Undo2,
} from "lucide-vue-next";
import { markRaw } from "vue";
import type { SelectedAnnotationTool } from "../utils/annotations/types";

defineProps<{
	active: boolean;
	canDraw: boolean;
	isPresenter: boolean;
	participantsCanAnnotate: boolean;
	tool: SelectedAnnotationTool;
	color: string;
}>();

const emit = defineEmits<{
	"update:active": [value: boolean];
	"update:tool": [value: SelectedAnnotationTool];
	"update:color": [value: string];
	undo: [];
	clear: [];
	"toggle-permission": [];
}>();

const colors = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff"];
const tools = [
	{ value: "pen" as const, label: "Pen", icon: markRaw(Pencil) },
	{
		value: "highlighter" as const,
		label: "Highlighter",
		icon: markRaw(Highlighter),
	},
	{ value: "eraser" as const, label: "Eraser", icon: markRaw(Eraser) },
	{
		value: "laser" as const,
		label: "Laser pointer",
		icon: markRaw(MousePointer2),
	},
];
</script>

<style scoped>
.annotation-button {
	@apply flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40;
}

.annotation-button-active {
	@apply bg-white/15 text-white;
}
</style>
