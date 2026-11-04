<script setup lang="ts">
import { computed } from 'vue'

import { arrowGeometry } from '../canvas/arrow'
import type { LineShape } from '../canvas/scene'

const props = defineProps<{
  shape: LineShape
  gradientId: string
  scale?: number
  opacity?: number
}>()

const geometry = computed(() => arrowGeometry(props.shape, props.scale))
const shaftColor = computed(() =>
  props.shape.stroke === null ? 'transparent' : (props.shape.stroke ?? '#171717'),
)
const headColor = computed(() => props.shape.arrowHeadFill ?? shaftColor.value)
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
