<!--
  The last row of an import or export form: whether a background job is
  running, a link to it or to past jobs, and the button that starts one
  (default slot). Put it in the `SettingsSection` under the rows it starts.

  The product passes the facts: the `operation`, the name of the running
  `job` (none while nothing runs), and `routeBase`, the Desk list of these
  jobs, such as `/mail/mail-exchanges`. A running job links to its own page;
  otherwise the link opens the list of past jobs of this operation. Keep the
  job read current with `useJobDoneRefetch`.
-->
<template>
  <div class="flex flex-wrap items-center justify-between gap-3 py-3.5">
    <p class="text-p-sm text-ink-gray-5">
      {{ status }}
      <a class="text-ink-gray-7 underline underline-offset-2" :href="href" target="_blank">
        {{ job ? __('Track status') : __('View history') }}
      </a>
    </p>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { JobOperation } from './useJobDoneRefetch'

const props = defineProps<{
  operation: JobOperation
  job?: string | null
  routeBase: string
}>()
defineSlots<{ default?: () => unknown }>()

const STATUS: Record<JobOperation, { running: string; idle: string }> = {
  Import: {
    running: __("Import in progress. We'll email you when it's ready."),
    idle: __('No imports in progress.'),
  },
  Export: {
    running: __("Export in progress. We'll email you when it's ready."),
    idle: __('No exports in progress.'),
  },
}

const status = computed(() => STATUS[props.operation][props.job ? 'running' : 'idle'])
const href = computed(() =>
  props.job ? `${props.routeBase}/${props.job}` : `${props.routeBase}?operation=${props.operation}`,
)
</script>
