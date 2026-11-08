<template>
  <div class="relative aspect-video overflow-hidden" :style="previewStyles">
    <div :style="slideStyles">
      <SlideElement
        v-for="element in elements"
        :key="`${mode}-${element.id}`"
        :mode="mode"
        :element="element"
        :data-index="element.id"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import SlideElement from '@/apps/slides/components/SlideElement.vue'

const props = defineProps({
  slide: { type: Object, required: true },
  scale: { type: Number, default: 160 / 960 },
  // a viewer draws a video and a moving gif, a thumbnail only their stills
  mode: { type: String, default: 'thumbnail' },
})

const elements = computed(() => {
  const value = props.slide?.elements
  if (!value) return []
  if (Array.isArray(value)) return value

  try {
    return JSON.parse(value)
  } catch {
    return []
  }
})

const previewStyles = computed(() => ({
  backgroundColor: props.slide?.background || '#ffffff',
}))

const slideStyles = computed(() => ({
  width: '960px',
  height: '540px',
  transformOrigin: 'top left',
  transform: `scale(${props.scale})`,
  position: 'absolute',
  top: '0',
  left: '0',
}))
</script>
