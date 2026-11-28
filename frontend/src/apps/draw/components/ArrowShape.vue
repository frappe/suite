<script setup lang="ts">
import { computed } from 'vue'

import { useTheme } from '@/platform/theme'

import { arrowGeometry } from '../canvas/arrow'
import { paletteColor } from '../canvas/palette'
import type { LineShape } from '../canvas/scene'

const props = defineProps<{
  shape: LineShape
  gradientId: string
  scale?: number
  opacity?: number
}>()

const { resolvedMode: colorScheme } = useTheme()
const dark = computed(() => colorScheme.value === 'dark')
const geometry = computed(() => arrowGeometry(props.shape, props.scale))
const shaftColor = computed(() =>
  props.shape.stroke === null
    ? 'transparent'
    : (paletteColor(props.shape.stroke, dark.value) ?? 'var(--draw-ink, var(--ink-gray-9))'),
)
const headColor = computed(
  () => paletteColor(props.shape.arrowHeadFill, dark.value) ?? shaftColor.value,
)
</script>

<template>
  <g v-if="geometry.path">
    <defs>
      <linearGradient
        :id="props.gradientId"
        gradientUnits="userSpaceOnUse"
        :x1="geometry.gradientStart.x"
        :y1="geometry.gradientStart.y"
        :x2="geometry.gradientEnd.x"
        :y2="geometry.gradientEnd.y"
      >
        <stop offset="50%" :stop-color="shaftColor" />
        <stop offset="50%" :stop-color="headColor" />
      </linearGradient>
    </defs>
    <path
      class="drawn-arrow"
      :d="geometry.path"
      stroke="none"
      :style="{ fill: `url(#${props.gradientId})`, opacity: props.opacity ?? 1 }"
    />
  </g>
</template>
