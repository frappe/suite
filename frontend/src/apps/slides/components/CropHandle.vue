<template>
  <div :style="handleStyles"></div>
</template>
<script setup>
import { computed } from 'vue'

import { cursorMap } from '@/apps/slides/composables/useResizer'
import { slideBounds } from '@/apps/slides/stores/slide'
import { selectionColor } from '@/apps/slides/utils/constants'

const props = defineProps({
  handle: {
    type: String,
    required: true,
  },
})

const LENGTH = 16
const THICKNESS = 3
const HIT_PADDING = 4
const COLOR = selectionColor

const scaledPx = (value) => `${value / slideBounds.scale}px`

const getCornerStyles = () => {
  const border = `${scaledPx(THICKNESS)} solid ${COLOR}`
  const offset = `-${scaledPx(THICKNESS / 2)}`
  const vEdge = props.handle.includes('top') ? 'top' : 'bottom'
  const hEdge = props.handle.includes('left') ? 'left' : 'right'
  const capitalize = (edge) => edge[0].toUpperCase() + edge.slice(1)

  return {
    width: scaledPx(LENGTH),
    height: scaledPx(LENGTH),
    [vEdge]: offset,
    [hEdge]: offset,
    [`border${capitalize(vEdge)}`]: border,
    [`border${capitalize(hEdge)}`]: border,
  }
}

// the padding is invisible hit area; the clip keeps the painted bar thin
const getEdgeStyles = () => {
  const offset = `-${scaledPx(THICKNESS / 2 + HIT_PADDING)}`
  const bar = {
    padding: scaledPx(HIT_PADDING),
    backgroundColor: COLOR,
    backgroundClip: 'content-box',
  }

  if (['left', 'right'].includes(props.handle)) {
    return {
      ...bar,
      [props.handle]: offset,
      top: `calc(50% - ${scaledPx(LENGTH / 2 + HIT_PADDING)})`,
      width: scaledPx(THICKNESS + 2 * HIT_PADDING),
      height: scaledPx(LENGTH + 2 * HIT_PADDING),
    }
  }

  return {
    ...bar,
    [props.handle]: offset,
    left: `calc(50% - ${scaledPx(LENGTH / 2 + HIT_PADDING)})`,
    width: scaledPx(LENGTH + 2 * HIT_PADDING),
    height: scaledPx(THICKNESS + 2 * HIT_PADDING),
  }
}

const handleStyles = computed(() => {
  const isEdge = ['top', 'bottom', 'left', 'right'].includes(props.handle)
  return {
    position: 'absolute',
    boxSizing: 'border-box',
    cursor: cursorMap[props.handle],
    ...(isEdge ? getEdgeStyles() : getCornerStyles()),
  }
})
</script>
