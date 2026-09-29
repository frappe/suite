<!-- A read-only value with a copy button, for connection details. -->
<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="block text-sm text-ink-gray-6">{{ label }}</label>
    <div class="flex items-center gap-2">
      <TextInput :id="id" class="min-w-0 flex-1" :model-value="value" readonly />
      <Button icon="lucide-copy" :aria-label="__('Copy {0}', [label])" @click="copy" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue'
import { Button, TextInput, toast } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

const props = defineProps<{ label: string; value: string }>()
const id = useId()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    toast.success(__('Copied'))
  } catch {
    toast.error(__('Could not copy. Select the text and copy it.'))
  }
}
</script>
