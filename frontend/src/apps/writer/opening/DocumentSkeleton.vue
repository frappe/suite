<template>
  <DocumentFrame :has-toolbar="hasToolbar" role="status" :aria-label="__('Opening document')">
    <template #toolbar>
      <div class="flex h-9 gap-x-0.5 overflow-hidden" aria-hidden="true">
        <div v-for="(group, index) in TOOLBAR" :key="index" class="writer-toolbar-group">
          <template v-for="(width, item) in group" :key="item">
            <span v-if="width === DIVIDER" class="writer-divider" />
            <span v-else class="flex h-7 items-center justify-center" :style="{ width: `${width}px` }">
              <Skeleton class="h-4 rounded-3" :style="{ width: `${width - 12}px` }" />
            </span>
          </template>
        </div>
      </div>
    </template>
    <template #rail>
      <span class="flex size-8 items-center justify-center" aria-hidden="true">
        <Skeleton class="size-4 rounded-3" />
      </span>
    </template>
    <div class="min-w-0 grow px-5 pt-10" aria-hidden="true">
      <Skeleton class="mb-5 h-6 w-2/5 rounded-4" />
      <div v-for="(lines, paragraph) in PARAGRAPHS" :key="paragraph" class="mb-5">
        <div v-for="width in lines" :key="width" class="flex h-[22.5px] items-center">
          <Skeleton class="h-3 rounded-3" :style="{ width }" />
        </div>
      </div>
    </div>
  </DocumentFrame>
</template>

<script setup lang="ts">
import { Skeleton } from 'frappe-ui'

import DocumentFrame from './DocumentFrame.vue'

defineProps<{ hasToolbar: boolean }>()

const DIVIDER = 0
// WriterToolbar's groups, by the width of each control
const TOOLBAR = [
  [28, 28, DIVIDER, 50],
  [130],
  [142],
  [28, 36, 28],
  [28, 28, 28, 28, 50],
  [DIVIDER, 28, 28, 28],
  [DIVIDER, 50, 50, 50, 28, 28],
  [DIVIDER, 28, 28, 28],
  [DIVIDER, 28, 28],
]
const PARAGRAPHS = [
  ['96%', '100%', '91%', '64%'],
  ['98%', '93%', '42%'],
  ['100%', '95%', '97%', '88%', '30%'],
]
</script>
