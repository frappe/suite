<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { Button, Skeleton } from 'frappe-ui'
import { computed, ref, useTemplateRef, watch } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import SlidePreview from '@/apps/slides/components/SlidePreview.vue'

import { fetchVersion, readVersionBody } from './versions'
import { versionSlides } from './versionSlides'

const props = defineProps<{
  session: DocumentSession
  seq: string
}>()

const slides = ref<Record<string, unknown>[]>([])
const position = ref(1)
const loading = ref(true)
const failed = ref(false)

let latestRequest = 0

async function showVersion(seq: string) {
  const thisRequest = ++latestRequest
  loading.value = true
  try {
    const shown = versionSlides(
      await readVersionBody(await fetchVersion(props.session, Number(seq))),
    )
    if (thisRequest !== latestRequest) {
      return
    }

    slides.value = shown
    position.value = 1
    failed.value = false
  } catch {
    if (thisRequest === latestRequest) {
      failed.value = true
    }
  } finally {
    if (thisRequest === latestRequest) {
      loading.value = false
    }
  }
}

watch(() => props.seq, showVersion, { immediate: true })

const shownSlide = computed(() => slides.value[position.value - 1])
const isFirst = computed(() => position.value <= 1)
const isLast = computed(() => position.value >= slides.value.length)

const isEmpty = computed(() => !shownSlide.value)

function previous() {
  position.value = Math.max(position.value - 1, 1)
}

function next() {
  position.value = Math.min(position.value + 1, slides.value.length)
}

// The slide fills the canvas area at 16:9, as the canvas does
const SLIDE_WIDTH = 960
const SLIDE_HEIGHT = 540
const canvas = useTemplateRef<HTMLElement>('canvas')
const { width, height } = useElementSize(canvas)
const scale = computed(() => Math.min(width.value / SLIDE_WIDTH, height.value / SLIDE_HEIGHT))
const slideWidth = computed(() => {
  const pixels = SLIDE_WIDTH * scale.value
  return `${pixels}px`
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" role="region" :aria-label="__('Version preview')">
    <div ref="canvas" class="relative flex min-h-0 flex-1 items-center justify-center p-6">
      <Skeleton v-if="loading" class="aspect-video w-full max-w-3xl rounded-4" />
      <p v-else-if="failed" class="text-p-sm text-ink-gray-6">
        {{ __("This version can't be shown.") }}
      </p>
      <p v-else-if="isEmpty" class="text-p-sm text-ink-gray-6">
        {{ __('This version has no slides.') }}
      </p>
      <SlidePreview
        v-else
        class="shadow-md"
        :style="{ width: slideWidth }"
        :slide="shownSlide"
        :scale="scale"
      />
    </div>
    <nav
      v-if="slides.length"
      class="flex shrink-0 items-center justify-center gap-4 border-t border-outline-gray-1 bg-surface-base px-3 py-2"
      :aria-label="__('Slides')"
    >
      <Button
        icon="lucide-chevron-left"
        :aria-label="__('Previous slide')"
        variant="ghost"
        :disabled="isFirst"
        @click="previous"
      />
      <span class="text-sm tabular-nums text-ink-gray-6">{{
        __('{0} of {1}', [String(position), String(slides.length)])
      }}</span>
      <Button
        icon="lucide-chevron-right"
        :aria-label="__('Next slide')"
        variant="ghost"
        :disabled="isLast"
        @click="next"
      />
    </nav>
  </div>
</template>
