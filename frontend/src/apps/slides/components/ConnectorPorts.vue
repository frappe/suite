<template>
	<div v-for="port in ports" :key="port.key" :style="port.style"></div>
</template>

<script setup>
import { computed } from 'vue'

import { slideBounds } from '@/apps/slides/stores/slide'
import { bindPreview, getTargetBox, pendingConnector } from '@/apps/slides/stores/interaction'
import { getHandleBaseStyles, portColor } from '@/apps/slides/utils/constants'
import { SIDES, getPort } from '@/apps/slides/utils/connectors'

const PORT_SIZE = 8

const ports = computed(() => {
	if (!bindPreview.value) return []
	const box = getTargetBox(bindPreview.value.elementId)
	if (!box) return []

	const size = PORT_SIZE / slideBounds.scale
	// a dragged endpoint handle fills on the snapped port itself, so the ring steps aside
	const sides = pendingConnector.value
		? SIDES.filter((side) => side !== bindPreview.value.anchor)
		: SIDES
	return sides.map((side) => {
		const point = getPort(box, side)
		const snapped = bindPreview.value.anchor === side
		return {
			key: `${bindPreview.value.elementId}-${side}`,
			style: {
				...getHandleBaseStyles(slideBounds.scale),
				// above the draw preview line, which would otherwise cross the snapped port
				zIndex: 10002,
				left: `${point.x - size / 2}px`,
				top: `${point.y - size / 2}px`,
				width: `${size}px`,
				height: `${size}px`,
				borderRadius: '9999px',
				border: `${1 / slideBounds.scale}px solid ${portColor}`,
				backgroundColor: snapped ? portColor : '#ffffff',
				pointerEvents: 'none',
				animation: 'connector-port-in 120ms ease-out',
			},
		}
	})
})
</script>

<style>
@keyframes connector-port-in {
	from {
		opacity: 0;
	}
	to {
		opacity: 1;
	}
}
</style>
