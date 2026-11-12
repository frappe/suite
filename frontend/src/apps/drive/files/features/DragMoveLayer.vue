<template>
  <!-- The drag image follows the pointer. The pointer passes through it, so the
       target under it is still found. It appears and moves without animation. -->
  <Teleport to="body">
    <div
      v-if="image"
      data-slot="drag-move-image"
      class="pointer-events-none fixed left-0 top-0 z-50 flex max-w-72 items-center gap-2.5 rounded-5 border border-outline-gray-2 bg-surface-elevation-2 px-2.5 py-1.5 shadow-lg"
      :style="{ transform: `translate(${pointer.x + OFFSET}px, ${pointer.y + OFFSET}px)` }"
      aria-hidden="true"
    >
      <span class="size-4 shrink-0" :class="icon" />
      <span class="flex min-w-0 flex-col">
        <span class="truncate text-base-medium text-ink-gray-8">{{ name }}</span>
        <span
          v-if="image.check"
          class="truncate text-sm"
          :class="image.check.status === 'allowed' ? 'text-ink-gray-7' : 'text-ink-gray-5'"
          >{{ image.check.status === 'allowed' ? image.check.label : image.check.reason }}</span
        >
      </span>
    </div>
  </Teleport>
  <MoveAccessDialog
    :open="drag.review.open"
    :change="drag.review.change"
    @update:open="drag.closeReview"
    @confirm="drag.settleReview(true)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import { nodeIcon, nodeIconTint } from '../internal/icons'
import MoveAccessDialog from './MoveAccessDialog.vue'
import type { DragMove } from './useDragMove'

const props = defineProps<{ drag: DragMove }>()
/** The image sits below and right of the pointer, clear of the target it points at. */
const OFFSET = 12
const { image, pointer } = props.drag

const name = computed(() => {
  const items = image.value?.items ?? []
  return items.length === 1 ? (items[0]?.title ?? '') : __('{0} items', [items.length])
})
const icon = computed(() => {
  const items = image.value?.items ?? []
  const [only] = items
  return items.length === 1 && only
    ? [nodeIcon(only), nodeIconTint(only)]
    : 'lucide-files text-ink-gray-6'
})
</script>
