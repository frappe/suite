<template>
  <div
    :style="handleStyles"
    @mousedown="(e) => cornerRadius.startRound(props.corner, e)"
    @mouseenter="cornerRadius.setHovered(activeElement?.id)"
    @mouseleave="cornerRadius.setHovered(null)"
  ></div>
</template>
<script setup>
import { computed, inject } from 'vue'

import { activeElement } from '@/apps/slides/stores/element'
import { slideBounds } from '@/apps/slides/stores/slide'
import { getHandleBaseStyles } from '@/apps/slides/utils/constants'

const props = defineProps({
  corner: {
    type: String,
    required: true,
  },
})

const HANDLE_SIZE = 8
const MIN_INSET = 14

const EDGES = {
  'top-left': { hEdge: 'left', vEdge: 'top' },
  'top-right': { hEdge: 'right', vEdge: 'top' },
  'bottom-left': { hEdge: 'left', vEdge: 'bottom' },
  'bottom-right': { hEdge: 'right', vEdge: 'bottom' },
}

const cornerRadius = inject('cornerRadius')

const displayInset = computed(() => {
  const radius = activeElement.value?.borderRadius ?? 0
  const minInset = MIN_INSET / slideBounds.scale
  return Math.min(Math.max(radius, minInset), cornerRadius.maxRadius.value)
})

const handleStyles = computed(() => {
  const size = HANDLE_SIZE / slideBounds.scale
  const offset = `${displayInset.value - size / 2}px`
  const edge = EDGES[props.corner]
  return {
    ...getHandleBaseStyles(slideBounds.scale),
    borderRadius: '50%',
    opacity: 0.75,
    cursor: 'grab',
    width: `${size}px`,
    height: `${size}px`,
    [edge.hEdge]: offset,
    [edge.vEdge]: offset,
  }
})
</script>
