<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { Button } from 'frappe-ui'
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef } from 'vue'

import { slidesAdapter } from '@/apps/slides/collab/adapter'
import { drawnSlides, type DrawnSlide } from '@/apps/slides/collab/drawnDeck'
import SlidePreview from '@/apps/slides/components/SlidePreview.vue'
import { openCollabRoom, type CollabRoom, type CollabSession } from '@/platform/collab'
import { translate as __ } from '@/platform/translation'

const SLIDE_WIDTH = 960
const SLIDE_HEIGHT = 540
const STAGE_PADDING = 32

const props = defineProps<{
  session: CollabSession
  /** Tests pass a fake. */
  open?: typeof openCollabRoom
}>()

provide('inReadonlyMode', ref(true))

const slides = shallowRef<DrawnSlide[]>([])
const index = ref(0)
const hasFailed = ref(false)
const stage = ref<HTMLElement | null>(null)
const { width: stageWidth, height: stageHeight } = useElementSize(stage)

const slide = computed(() => slides.value[index.value])
const scale = computed(() =>
  Math.max(
    0,
    Math.min(
      (stageWidth.value - STAGE_PADDING) / SLIDE_WIDTH,
      (stageHeight.value - STAGE_PADDING) / SLIDE_HEIGHT,
    ),
  ),
)

const slideWidth = computed(() => {
  const width = SLIDE_WIDTH * scale.value

  return `${width}px`
})
const position = computed(() => __('{0} of {1}', [index.value + 1, slides.value.length]))
const isFirst = computed(() => index.value <= 0)
const isLast = computed(() => index.value >= slides.value.length - 1)

let room: CollabRoom | null = null
let isLeft = false

function draw() {
  if (!room) {
    return
  }

  slides.value = drawnSlides(room.doc)
  index.value = Math.min(index.value, slides.value.length - 1)
}

function showPrevious() {
  index.value -= 1
}

function showNext() {
  index.value += 1
}

onMounted(async () => {
  try {
    const opened = await (props.open ?? openCollabRoom)({
      session: props.session,
      adapter: slidesAdapter,
    })
    if (opened.state !== 'live') {
      hasFailed.value = true
      return
    }

    if (isLeft) {
      void opened.room.close()
      return
    }

    room = opened.room
    room.doc.on('update', draw)
    draw()
  } catch {
    hasFailed.value = true
  }
})

onBeforeUnmount(() => {
  isLeft = true
  room?.doc.off('update', draw)
  void room?.close()
})
</script>

<template>
  <p v-if="hasFailed" class="m-auto max-w-md px-6 text-center text-p-sm text-ink-gray-6">
    {{ __('Could not open this presentation.') }}
  </p>
  <div v-else class="flex min-h-0 flex-1 flex-col bg-surface-gray-1">
    <div ref="stage" class="flex min-h-0 flex-1 items-center justify-center">
      <SlidePreview
        v-if="slide"
        :key="slide.id"
        :slide="slide"
        :scale="scale"
        mode="viewer"
        class="shrink-0 shadow-sm"
        :style="{ width: slideWidth }"
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
        @click="showPrevious"
      />
      <span class="text-sm tabular-nums text-ink-gray-6">{{ position }}</span>
      <Button
        icon="lucide-chevron-right"
        :aria-label="__('Next slide')"
        variant="ghost"
        :disabled="isLast"
        @click="showNext"
      />
    </nav>
  </div>
</template>
