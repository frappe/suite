<template>
	<div :class="overlayClasses" />
</template>

<script setup>
const overlayClasses = [
	// cover the slide, sitting above content but below selection/interaction overlays
	'pointer-events-none absolute -inset-px z-[9998] rounded-4',
	// huge spread dims everything outside the slide via a single box-shadow
	'shadow-[0_0_0_200vmax_var(--overlay-color)]',
	// same token as the canvas so the empty area keeps the canvas color
	'[--overlay-color:color-mix(in_oklch,var(--surface-gray-1)_60%,transparent)]',
	'dark:[--overlay-color:color-mix(in_oklch,var(--surface-base)_60%,transparent)]',
]
</script>
