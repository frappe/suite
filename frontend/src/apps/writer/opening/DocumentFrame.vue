<template>
  <div class="flex min-h-0 w-full flex-1 flex-col bg-surface-base">
    <!-- The toolbar's place, so the text does not move when the toolbar comes -->
    <div v-if="hasToolbar" class="shrink-0 border-b border-outline-gray-1 px-3">
      <slot name="toolbar"><div class="h-9" /></slot>
    </div>
    <div class="flex min-h-0 flex-1">
      <div class="hidden w-12 shrink-0 py-2 ps-3.5 md:block"><slot name="rail" /></div>
      <div
        class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden border-outline-gray-1 md:border-l"
      >
        <div class="flex min-h-full flex-col md:grid md:grid-rows-[1fr]" :style="editorColumns()">
          <div class="hidden md:block" />
          <slot />
          <div class="hidden md:block" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { editorColumns } from '@/apps/writer/utils/editor-layout'

withDefaults(defineProps<{ hasToolbar?: boolean }>(), { hasToolbar: true })
</script>
