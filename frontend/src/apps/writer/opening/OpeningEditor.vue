<template>
  <div class="flex min-h-0 w-full flex-1 flex-col bg-surface-base">
    <!-- The toolbar's place, so the text does not move when the toolbar comes -->
    <div class="h-9 shrink-0 border-b border-outline-gray-1" />
    <div class="flex min-h-0 flex-1">
      <div class="hidden w-12 shrink-0 md:block" />
      <div
        class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden border-outline-gray-1 md:border-l"
      >
        <div class="flex min-h-full flex-col md:grid md:grid-rows-[1fr]" :style="editorColumns()">
          <div class="hidden md:block" />
          <div ref="place" class="flex min-w-0 grow flex-col" />
          <div class="hidden md:block" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

import { editorColumns } from '@/apps/writer/utils/editor-layout'

import { placeOpeningEditor, releaseOpeningEditor } from './openingEditor'

const props = defineProps<{ node: string }>()
const place = useTemplateRef<HTMLElement>('place')

onMounted(() => {
  if (place.value) placeOpeningEditor(props.node, place.value)
})
onBeforeUnmount(() => releaseOpeningEditor(props.node))
</script>
