<template>
	<svg :class="$attrs.class || 'size-5'" viewBox="0 0 20 20" fill="none" aria-hidden="true">
		<circle cx="4" cy="10" r="1.5" fill="currentColor" />
		<circle cx="10" cy="10" r="1.5" fill="currentColor" />
		<circle cx="16" cy="10" r="1.5" fill="currentColor" />
	</svg>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>
