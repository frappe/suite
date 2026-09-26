<script setup lang="ts">
import { computed } from 'vue'
import type { AlignmentGuide, SpacingMarker } from '../canvas/snapping'

const props = defineProps<{
  alignmentGuides: AlignmentGuide[]
  spacingMarkers: SpacingMarker[]
  scale: number
}>()

const tickSize = computed(() => 5 / props.scale)

</script>

<template>
  <g class="snap-guides">
    <line
      v-for="(guide, index) in alignmentGuides"
      :key="`alignment-${guide.axis}-${index}`"
      :x1="guide.axis === 'x' ? guide.position : guide.start"
      :y1="guide.axis === 'x' ? guide.start : guide.position"
      :x2="guide.axis === 'x' ? guide.position : guide.end"
      :y2="guide.axis === 'x' ? guide.end : guide.position"
      class="snap-guide-line"
    />

    <g v-for="(marker, index) in spacingMarkers" :key="`spacing-${marker.axis}-${index}`">
      <line
        :x1="marker.axis === 'x' ? marker.start : marker.cross"
        :y1="marker.axis === 'x' ? marker.cross : marker.start"
        :x2="marker.axis === 'x' ? marker.end : marker.cross"
        :y2="marker.axis === 'x' ? marker.cross : marker.end"
        class="snap-guide-line"
      />
      <line
        :x1="marker.axis === 'x' ? marker.start : marker.cross - tickSize"
        :y1="marker.axis === 'x' ? marker.cross - tickSize : marker.start"
        :x2="marker.axis === 'x' ? marker.start : marker.cross + tickSize"
        :y2="marker.axis === 'x' ? marker.cross + tickSize : marker.start"
        class="snap-guide-line"
      />
      <line
        :x1="marker.axis === 'x' ? marker.end : marker.cross - tickSize"
        :y1="marker.axis === 'x' ? marker.cross - tickSize : marker.end"
        :x2="marker.axis === 'x' ? marker.end : marker.cross + tickSize"
        :y2="marker.axis === 'x' ? marker.cross + tickSize : marker.end"
        class="snap-guide-line"
      />
    </g>

  </g>
</template>

<style scoped>
.snap-guides {
  pointer-events: none;
}

.snap-guide-line {
  stroke: #e34aa6;
  stroke-width: 1px;
  stroke-dasharray: 1 3;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

</style>
