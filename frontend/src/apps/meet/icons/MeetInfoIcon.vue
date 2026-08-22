<template>
	<svg :class="$attrs.class || 'size-5'" viewBox="0 0 20 20" fill="none" aria-hidden="true">
		<path
			v-if="encrypted"
			fill-rule="evenodd"
			clip-rule="evenodd"
			d="M5.5 8V6.5a4.5 4.5 0 0 1 9 0V8h.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h.5Zm2 0h5V6.5a2.5 2.5 0 0 0-5 0V8Zm3.5 4.75a1.5 1.5 0 1 0-2 1.415V16h2v-1.835a1.5 1.5 0 0 0 0-1.415Z"
			fill="currentColor"
		/>
		<path
			v-else
			fill-rule="evenodd"
			clip-rule="evenodd"
			d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-1-9h2v6H9V9Zm2.25-2.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"
			fill="currentColor"
		/>
	</svg>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false });

defineProps<{
	encrypted?: boolean;
}>();
</script>
