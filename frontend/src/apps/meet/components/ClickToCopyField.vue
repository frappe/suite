<template>
  <div
    class="flex items-center gap-2 rounded-6 border border-outline-gray-2 bg-surface-gray-2 py-1.5 pl-3 pr-1.5"
  >
    <span
      class="min-w-0 flex-1 select-all truncate text-sm text-ink-gray-8"
      :class="{ 'font-mono': mono }"
      :title="textContent"
    >
      {{ textContent }}
    </span>
    <Button
      size="sm"
      :icon-left="copied ? 'lucide-check' : 'lucide-copy'"
      :label="copied ? __('Copied') : __('Copy')"
      class="shrink-0"
      @click="copyTextContentToClipboard"
    />
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { onScopeDispose, ref } from 'vue'

import { translate as __ } from '@/platform/translation'

const props = defineProps<{
  textContent: string
  mono?: boolean
}>()

const copied = ref(false)
let reset: ReturnType<typeof setTimeout> | undefined

async function copyTextContentToClipboard() {
  await window.navigator.clipboard.writeText(props.textContent)
  copied.value = true
  clearTimeout(reset)
  reset = setTimeout(() => (copied.value = false), 2000)
}

onScopeDispose(() => clearTimeout(reset))
</script>
