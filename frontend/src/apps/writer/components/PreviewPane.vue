<script setup lang="ts">
import { EditorContent, type Editor } from '@tiptap/vue-3'
import { computed } from 'vue'

import {
  editorColumns,
  editorTextStyle,
  type LayoutSettings,
} from '@/apps/writer/utils/editor-layout'

/** Writer's page around a read-only editor, or what shows while it loads or can't be shown. */
const props = defineProps<{
  editor: Editor | null
  settings: LayoutSettings
  label: string
  isLoading?: boolean
  isFailed: boolean
}>()

defineSlots<{ loading?: () => unknown; failed: () => unknown }>()

const shownEditor = computed(() => props.editor ?? undefined)
</script>

<template>
  <div class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden md:border-l border-outline-gray-2">
    <div
      class="min-h-full flex flex-col md:grid md:grid-rows-[1fr]"
      :style="editorColumns(settings)"
    >
      <div class="hidden md:block" />
      <slot v-if="isLoading" name="loading" />
      <p v-else-if="isFailed" class="px-5 pt-10 text-center text-p-sm text-ink-gray-6">
        <slot name="failed" />
      </p>
      <EditorContent
        v-else
        :editor="shownEditor"
        :aria-label="label"
        class="flex grow flex-col"
        :style="editorTextStyle(settings)"
      />
    </div>
  </div>
</template>
