<template>
	<div
		class="absolute bg-black/60 text-white rounded-full pointer-events-none max-w-[calc(100%-0.5rem)] whitespace-nowrap overflow-hidden w-fit flex items-center gap-2"
		:class="pillClasses"
	>
		<span class="min-w-0 truncate">{{ name }}</span>
		<slot />
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";

type Size = "xs" | "sm" | "md";
type Position = "bottom-left" | "top-left" | "top-right" | "bottom-right";

interface Props {
	name: string;
	size?: Size;
	position?: Position;
}

const props = withDefaults(defineProps<Props>(), {
	size: "sm",
	position: "bottom-left",
});

const pillClasses = computed(() => {
	const classes: string[] = [];

	// Size classes
	switch (props.size) {
		case "xs":
			classes.push("text-[10px]", "px-1");
			break;
		case "sm":
			classes.push("text-xs", "px-2", "py-1");
			break;
		case "md":
			classes.push("text-sm", "px-2", "py-1");
			break;
	}

	// Position classes
	switch (props.position) {
		case "bottom-left":
			classes.push("bottom-1", "left-1");
			break;
		case "top-left":
			classes.push("top-1", "left-1");
			break;
		case "top-right":
			classes.push("top-1", "right-1");
			break;
		case "bottom-right":
			classes.push("bottom-1", "right-1");
			break;
	}

	return classes;
});
</script>
