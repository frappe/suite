<template>
  <Alert
    v-if="result"
    v-bind="$attrs"
    :title="batchResultText(result, verb)"
    :theme="result.failed.length ? 'amber' : 'green'"
    :primary-action="result.failed.length ? { label: 'Details', onClick: () => (details = true) } : undefined"
    dismissible
    @dismiss="$emit('dismiss')"
  />
  <Dialog v-model:open="details" title="Items that failed" size="lg">
    <ul class="divide-y divide-outline-gray-1">
      <li v-for="failure in result?.failed" :key="failure.node" class="py-3">
        <p class="text-base font-medium text-ink-gray-8">{{ failure.node }}</p>
        <p class="text-p-sm text-ink-red-7">{{ failure.message }}</p>
      </li>
    </ul>
  </Dialog>
</template>

<script lang="ts">
export default { inheritAttrs: false }
</script>

<script setup lang="ts">
import { ref } from 'vue'
import { Alert, Dialog } from 'frappe-ui'
import type { DriveBatchResult } from '@/apps/drive/client/types'
import { batchResultText } from './batchResult'

defineProps<{ result: DriveBatchResult | null; verb: string }>()
defineEmits<{ dismiss: [] }>()
const details = ref(false)
</script>

