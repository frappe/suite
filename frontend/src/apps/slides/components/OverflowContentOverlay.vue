<template>
	<div :class="overlayClasses" />
</template>

<script setup>
const overlayClasses = [
	// cover the slide, sitting above content but below selection/interaction overlays
	'pointer-events-none absolute -inset-px z-[9998] rounded-4',
	// huge spread dims everything outside the slide via a single box-shadow
	'shadow-[0_0_0_200vmax_var(--overlay-color)]',
	// dim color: light surface in light mode, dark surface in dark mode
	'[--overlay-color:rgba(255,255,255,0.6)] dark:[--overlay-color:rgba(31,31,31,0.6)]',
]
</script>
