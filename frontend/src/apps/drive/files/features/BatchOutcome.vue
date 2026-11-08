<template>
  <!-- What worked is reported in a toast. The alert shows only when some items failed. -->
  <Alert
    v-if="result?.failed.length"
    v-bind="$attrs"
    :title="batchFailureTitle(result, verb, titleOf)"
    :description="single ? failureReason(single) : undefined"
    theme="amber"
    :primary-action="single ? undefined : detailsAction"
    dismissible
    @dismiss="$emit('dismiss')"
  />
  <Dialog v-model:open="details" :title="__('Items that failed')" size="lg">
    <ul class="max-h-[60vh] divide-y divide-outline-gray-1 overflow-y-auto">
      <li v-for="failure in result?.failed" :key="failure.node" class="flex gap-3 py-3">
        <span
          class="mt-0.5 size-4 shrink-0"
          :class="iconOf(failure.node)"
          aria-hidden="true"
          data-slot="failure-icon"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-base-medium text-ink-gray-8" :title="titleOf(failure.node)">
            {{ titleOf(failure.node) }}
          </p>
          <p class="mt-1 text-p-sm text-ink-red-7">{{ failureReason(failure) }}</p>
        </div>
      </li>
    </ul>
  </Dialog>
</template>

<script lang="ts">
export default { inheritAttrs: false }
</script>

<script setup lang="ts">
import { Alert, Dialog, type AlertAction } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import type { DriveBatchResult } from '@/apps/drive/client/types'
import { nodeIcon, nodeIconTint } from '@/apps/drive/files/internal/icons'
import { translate as __ } from '@/platform/translation'

import { batchFailureTitle, failureReason, type BatchItem, type BatchVerb } from './batchResult'

/**
 * A batch's failures (spec §6.11). `rows` are the items the page lists; the
 * failed ones are named by their titles and icons from there, never by id.
 */
const props = withDefaults(
  defineProps<{
    result: DriveBatchResult | null
    verb: BatchVerb
    rows?: readonly BatchItem[]
  }>(),
  { rows: () => [] },
)
defineEmits<{ dismiss: [] }>()
const details = ref(false)
const detailsAction: AlertAction = {
  label: __('Details'),
  onClick: () => {
    details.value = true
  },
}
// Every row the page has shown, newest copy first. A live refresh can drop an
// item from the listing while its batch is still in flight.
const known = new Map<string, BatchItem>()
watch(
  () => [...props.rows],
  (rows) => {
    for (const row of rows) known.set(row.name, row)
  },
  { immediate: true },
)
const single = computed(() =>
  props.result?.failed.length === 1 ? props.result.failed[0] : undefined,
)

function titleOf(node: string): string {
  return known.get(node)?.title ?? __('An item')
}

function iconOf(node: string): string[] {
  const item = known.get(node)
  return item ? [nodeIcon(item), nodeIconTint(item)] : ['lucide-file', 'text-ink-gray-5']
}
</script>
