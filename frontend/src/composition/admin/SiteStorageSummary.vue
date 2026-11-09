<!-- Shows stored usage and reservations separately, with storage-only remediation beside the breakdown. -->
<script setup lang="ts">
import { Alert } from 'frappe-ui'
import { computed } from 'vue'

import type { api, OutputOf } from '@/api'
import { translate as __ } from '@/platform/translation'

const props = defineProps<{ report: OutputOf<typeof api.suite.storage.get>; compact?: boolean }>()

function bytes(value: number | null) {
  if (value === null) return __('Unavailable')
  return __('{0} GB', [
    (value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
  ])
}

const segments = computed(() => [
  {
    label: __('Personal'),
    value: props.report.personal_drive_bytes,
    tone: 'bg-surface-gray-7',
  },
  { label: __('Shared'), value: props.report.shared_drive_bytes, tone: 'bg-surface-gray-5' },
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
    const overQuota = report.combined_bytes > report.allowance_bytes
    rows.push({
      title: overThreshold
        ? __('Storage is full')
        : overQuota
          ? __('Storage limit reached')
          : __('Storage is almost full'),
      description: overThreshold
        ? __('Free up space to upload more files. Mail will keep working.')
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
    <div v-if="!compact" class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg-medium text-ink-gray-9">{{ __('Where storage goes') }}</h2>
      <slot name="actions" />
    </div>
    <div
      class="space-y-3"
      :class="
        compact
          ? 'sm:grid sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-x-6 sm:space-y-0'
          : undefined
      "
    >
      <p v-if="compact" class="text-p-sm text-ink-gray-5 sm:col-start-1">
        {{ __('Workspace storage') }}
      </p>
      <p
        v-if="summary"
        class="text-xl font-semibold tabular-nums tracking-tight text-ink-gray-9"
        :class="compact ? 'sm:col-start-1 sm:row-start-2' : undefined"
      >
        {{ summary }}
      </p>
      <div
        class="flex h-2.5 overflow-hidden rounded-full bg-surface-gray-2"
        aria-hidden="true"
        :class="compact ? 'sm:col-start-2 sm:row-start-1' : undefined"
      >
        <div
          v-for="segment in segments"
          :key="segment.label"
          :class="segment.tone"
          :style="{ width: `${((segment.value ?? 0) / scale) * 100}%` }"
        />
      </div>
      <ul
        :class="
          compact
            ? 'flex flex-wrap gap-x-4 gap-y-2 text-p-sm sm:col-start-2 sm:row-start-2'
            : 'grid grid-cols-2 gap-x-6 gap-y-4 pt-2 sm:flex sm:flex-wrap sm:gap-x-10'
        "
      >
        <li
          v-for="segment in segments"
          :key="segment.label"
          :class="
            compact
              ? 'flex items-center gap-1 text-p-sm text-ink-gray-6'
              : 'grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-sm text-ink-gray-6'
          "
        >
          <span
            v-if="!compact"
            :class="segment.tone"
            class="size-2 shrink-0 rounded-full"
            aria-hidden="true"
          />
          {{ segment.label }}
          <span
            :class="
              compact
                ? 'tabular-nums text-ink-gray-8'
                : 'col-start-2 text-base font-medium tabular-nums text-ink-gray-8'
            "
            >{{ bytes(segment.value) }}</span
          >
        </li>
      </ul>
    </div>
    <Alert
      v-for="alert in alerts"
      :key="alert.title"
      :title="alert.title"
      :description="alert.description"
      :theme="alert.theme"
    />
  </section>
</template>
