<!--
  Placeholder for a real document. The real Writer/Sheets/Slides editors and
  the PDF viewer are not part of this static prototype, so an open document
  renders this card instead of mounting an editor.
-->
<template>
  <ScrollArea class="min-h-0 flex-1">
    <div class="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-16">
      <span
        class="flex size-14 items-center justify-center rounded-5 bg-surface-gray-2"
      >
        <span class="size-6" :class="[meta.icon, meta.tint]" aria-hidden="true" />
      </span>
      <div class="flex flex-col items-center gap-1 text-center">
        <span class="text-base font-medium text-ink-gray-8">{{ meta.label }}</span>
        <span class="max-w-sm text-p-sm text-ink-gray-5">
          The real {{ meta.label.toLowerCase() }} editor is not part of this static
          prototype.
        </span>
      </div>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ScrollArea } from 'frappe-ui'

import { DOC_KIND_META, type DocApp } from '../fixtures'

const props = defineProps<{ app: DocApp; id: string }>()

const KIND_BY_APP: Record<DocApp, keyof typeof DOC_KIND_META> = {
  writer: 'writer',
  sheets: 'sheet',
  slides: 'slides',
  pdf: 'pdf',
}

const meta = computed(() => DOC_KIND_META[KIND_BY_APP[props.app]])
</script>
