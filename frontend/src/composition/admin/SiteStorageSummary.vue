<!-- Shows stored usage and reservations separately, with storage-only remediation beside the breakdown. -->
<script setup lang="ts">
import { Alert } from 'frappe-ui'
import { computed } from 'vue'

import type { api, OutputOf } from '@/api'
import { translate as __ } from '@/platform/translation'

const props = defineProps<{ report: OutputOf<typeof api.suite.storage.get> }>()

function bytes(value: number | null) {
  if (value === null) return __('Unavailable')
  return __('{0} GB', [
    (value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
  ])
}

const segments = computed(() => [
  {
    label: __('Personal Drive'),
    value: props.report.personal_drive_bytes,
    tone: 'bg-surface-gray-7',
  },
  { label: __('Shared Drive'), value: props.report.shared_drive_bytes, tone: 'bg-surface-gray-5' },
  ...(props.report.cloud
    ? [{ label: __('Mail'), value: props.report.mail_bytes, tone: 'bg-surface-gray-4' }]
    : []),
  ...(props.report.reserved_bytes
    ? [{ label: __('In progress'), value: props.report.reserved_bytes, tone: 'bg-surface-gray-3' }]
    : []),
])
const knownCharge = computed(() =>
  segments.value.reduce((total, segment) => total + (segment.value ?? 0), 0),
)
// Scale over-limit and uncapped sites to their actual charge so no segment
// disappears. An unknown Mail value stays unknown in the legend and total.
const scale = computed(() => Math.max(props.report.allowance_bytes ?? 0, knownCharge.value, 1))
const summary = computed(() => {
  const report = props.report
  if (report.cloud && report.combined_bytes === null) return ''
  const stored = bytes(report.cloud ? report.combined_bytes : report.drive_bytes)
  if (!report.cloud) return __('{0} used', [stored])
  if (report.allowance_bytes === null) return __('{0} used', [stored])
  if (report.allowance_bytes === 0) return __('{0} used · no limit', [stored])
  return __('{0} of {1} used', [stored, bytes(report.allowance_bytes)])
})
const alerts = computed(() => {
  const report = props.report
  if (!report.cloud) return []
  const rows: { title: string; description: string; theme: 'amber' | 'red' }[] = []
  if (report.combined_bytes === null) {
    rows.push({
      title: __('Storage usage is unavailable'),
      description: __('Uploads are temporarily paused. Your files and mail are still available.'),
      theme: 'amber',
    })
  }
  if (report.allowance_bytes === null && report.combined_bytes !== null) {
    rows.push({
      title: __('Storage limit is unavailable'),
      description: __('Uploads are temporarily paused. Your files and mail are still available.'),
      theme: 'amber',
    })
  }
  if (
    report.allowance_bytes &&
    report.combined_bytes !== null &&
    report.combined_bytes >= report.allowance_bytes * 0.9
  ) {
    const overThreshold =
      report.combined_bytes > (report.effective_allowance_bytes ?? report.allowance_bytes)
    const usingHeadroom = report.combined_bytes > report.allowance_bytes
    rows.push({
      title: overThreshold
        ? __('Storage is full')
        : usingHeadroom
          ? __('Extra storage is in use')
          : __('Storage is almost full'),
      description: overThreshold
        ? __('Free up space to upload more files. Mail will keep working.')
        : usingHeadroom
          ? __(
              'You can use up to {0}. Free up space before uploading more files. Mail will keep working.',
              [bytes(report.effective_allowance_bytes ?? report.allowance_bytes)],
            )
          : __('Free up space to keep uploading files. Mail will keep working.'),
      theme: overThreshold ? 'red' : 'amber',
    })
  }
  return rows
})
</script>

<template>
  <section
    class="space-y-4 rounded-5 border border-outline-gray-2 p-4 sm:p-5"
    :aria-label="__('Site storage')"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg-medium text-ink-gray-9">{{ __('Where storage goes') }}</h2>
      <slot name="actions" />
    </div>
    <div class="space-y-3">
      <p v-if="summary" class="text-p-sm tabular-nums text-ink-gray-6">{{ summary }}</p>
      <div class="flex h-2.5 overflow-hidden rounded-full bg-surface-gray-2" aria-hidden="true">
        <div
          v-for="segment in segments"
          :key="segment.label"
          :class="segment.tone"
          :style="{ width: `${((segment.value ?? 0) / scale) * 100}%` }"
        />
      </div>
      <ul class="flex flex-wrap gap-x-6 gap-y-2">
        <li
          v-for="segment in segments"
          :key="segment.label"
          class="flex items-center gap-1.5 text-sm text-ink-gray-6"
        >
          <span :class="segment.tone" class="size-2 shrink-0 rounded-full" aria-hidden="true" />
          {{ segment.label }}
          <span class="tabular-nums text-ink-gray-5">{{ bytes(segment.value) }}</span>
        </li>
      </ul>
    </div>
    <Alert
      v-for="alert in alerts"
      :key="alert.title"
      class="storage-alert"
      :title="alert.title"
      :description="alert.description"
      :theme="alert.theme"
    />
  </section>
</template>

<style scoped>
.storage-alert[data-color='amber'] {
  background-color: var(--surface-amber-2);
}
.storage-alert[data-color='red'] {
  background-color: var(--surface-red-2);
}
</style>
