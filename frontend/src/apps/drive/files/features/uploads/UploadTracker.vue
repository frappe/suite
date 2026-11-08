<template>
  <section
    v-if="
      queue.state.trackerOpen && (entries.length || queue.state.preparing || queue.state.reading)
    "
    data-slot="upload-tracker"
    :aria-label="__('Uploads')"
    class="fixed inset-x-2 bottom-20 z-20 flex max-h-96 flex-col overflow-hidden rounded-6 border border-outline-gray-1 bg-surface-elevation-2 shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
  >
    <header
      class="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 border-b border-outline-gray-1 px-4 py-2"
    >
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-base-semibold text-ink-gray-8">{{ heading }}</h2>
        <p
          v-if="subline"
          data-slot="upload-summary"
          class="mt-0.5 truncate text-sm text-ink-gray-5"
        >
          {{ subline }}
        </p>
      </div>
      <Button
        v-if="retryable > 1 && !queue.state.halted"
        variant="ghost"
        :label="__('Retry all')"
        @click="queue.retryAll()"
      />
      <Button
        v-if="stopped > 1"
        variant="ghost"
        :label="__('Resume all')"
        @click="queue.resumeAll(() => pickFiles({ multiple: true }))"
      />
      <Button
        v-if="active > 1"
        variant="ghost"
        :label="__('Cancel all')"
        @click="queue.cancelAll()"
      />
      <!-- Closing only hides the list, and only once uploads are over. -->
      <Button
        v-if="!busy"
        variant="ghost"
        icon="lucide-x"
        :aria-label="active ? __('Hide uploads') : __('Close uploads')"
        @click="queue.closeTracker()"
      />
      <Progress
        v-if="active"
        :value="overallPercent"
        size="sm"
        class="mt-2 basis-full"
        :aria-label="__('Upload progress')"
      />
    </header>
    <Alert
      v-if="queue.state.halted"
      class="m-2 shrink-0"
      theme="amber"
      :title="__('Storage is full')"
      :description="__('Free up space, then retry.')"
      :primary-action="{ label: __('Retry all'), onClick: () => queue.retryAll() }"
      :secondary-action="{
        label: __('Manage storage'),
        onClick: () => openSettings('drive.statistics'),
      }"
    />
    <ul class="min-h-0 flex-1 divide-y divide-outline-gray-1 overflow-y-auto">
      <!-- On a 4 px grid: rows inset to the header's edges, so names, bars and dividers line up.
           A row is 52 px with its divider, so the divided rows give up 1 px of top padding. -->
      <li
        v-for="entry in entries"
        :key="entry.id"
        data-slot="upload-entry"
        :data-state="entry.state"
        class="relative mx-4 flex min-h-[52px] items-center gap-3 pb-2 pt-[7px] first:pt-2"
      >
        <!-- The icon sits on the name's line, and a finished upload gets a filled check. -->
        <span class="flex h-5 shrink-0 items-center self-start" aria-hidden="true">
          <span
            v-if="entry.state === 'done'"
            data-slot="upload-done"
            class="flex size-4 items-center justify-center rounded-full bg-surface-green-7"
          >
            <span class="lucide-check size-3 text-white" />
          </span>
          <span v-else :class="iconClass(entry)" class="size-4" />
        </span>
        <div class="min-w-0 flex-1">
          <RouterLink
            v-if="entry.state === 'done' && entry.node"
            :to="driveNodeRoute({ name: entry.node, title: entry.title, kind: 'file' })"
            class="block truncate text-base leading-5 text-ink-gray-8 hover:underline focus-visible:underline focus-visible:outline-none"
            :title="entry.title"
          >
            {{ entry.title }}
          </RouterLink>
          <p v-else class="truncate text-base leading-5 text-ink-gray-8" :title="entry.title">
            {{ entry.title }}
          </p>
          <p
            class="text-sm leading-4"
            :class="[
              entry.state === 'failed' || entry.note ? 'line-clamp-2' : 'truncate',
              entry.state === 'failed' ? 'text-ink-red-7' : 'text-ink-gray-5',
            ]"
            :title="entry.state === 'failed' ? status(entry) : undefined"
          >
            {{ status(entry) }}
          </p>
        </div>
        <!-- The bar runs along the row's bottom edge, as wide as the dividers. -->
        <Progress
          v-if="showsProgress(entry)"
          :value="percent(entry)"
          size="sm"
          class="absolute inset-x-0 bottom-0"
        />
        <Button
          v-if="entry.state === 'interrupted'"
          :label="__('Resume')"
          @click="queue.resume(entry.id)"
        />
        <Button v-else-if="canRetry(entry)" :label="__('Retry')" @click="queue.retry(entry.id)" />
        <Button
          v-if="canCancel(entry)"
          variant="ghost"
          icon="lucide-x"
          :aria-label="__('Cancel upload of {0}', [entry.title])"
          @click="queue.cancel(entry.id)"
        />
        <Button
          v-else-if="dismissible(entry)"
          variant="ghost"
          icon="lucide-x"
          :aria-label="__('Remove {0}', [entry.title])"
          @click="queue.dismiss(entry.id)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { Alert, Button, Progress } from 'frappe-ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { driveNodeRoute } from '@/apps/drive'
import { openSettings } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'

import { TimeLeft } from './eta'
import { formatBytes } from './format'
import { pickFiles } from './picker'
import { isFinishing, uploadQueue, type UploadEntry, type UploadQueue } from './queue'

/** The upload list (spec §6.3). Opening it counts as seeing its failures. */
const props = defineProps<{ queue?: UploadQueue }>()
const queue = props.queue ?? uploadQueue()
const entries = computed(() => queue.entries.value)
const count = (state: UploadEntry['state']) =>
  entries.value.filter((entry) => entry.state === state).length
const stopped = computed(() => count('interrupted'))
const running = computed(
  () =>
    entries.value.filter((entry) =>
      ['queued', 'checking', 'uploading', 'reconnecting'].includes(entry.state),
    ).length,
)
/** Uploads still to send, held ones too. */
const active = computed(() => running.value + count('held'))
/** Anything still uploading, or a folder still being read or created. */
const busy = computed(() => active.value > 0 || !!queue.state.preparing || !!queue.state.reading)
const retryable = computed(
  () =>
    entries.value.filter(
      (entry) => (entry.state === 'failed' && entry.retryable) || entry.state === 'held',
    ).length,
)
const heading = computed(summaryHeading)
const subline = computed(summaryLine)
const overallPercent = computed(() => Math.round((queue.indicator.value?.fraction ?? 0) * 100))

/** The header's heading, which sums up the run. First match wins. */
function summaryHeading(): string {
  if (queue.state.reading) return __('Reading folder…')
  if (queue.state.preparing) return __('Creating folders…')
  if (active.value) {
    if (active.value === count('held')) return __('Upload paused')
    if (active.value === count('reconnecting')) return __('Waiting for connection')
    return active.value === 1 ? __('Uploading 1 file') : __('Uploading {0} files', [active.value])
  }
  if (stopped.value) return stoppedHeading()
  const failed = count('failed')
  if (failed) return failed === 1 ? __('1 upload failed') : __('{0} uploads failed', [failed])
  const done = count('done')
  if (done && done === entries.value.length)
    return done === 1 ? __('1 file uploaded') : __('{0} files uploaded', [done])
  return __('Uploads')
}

function stoppedHeading(): string {
  return stopped.value === 1 ? __('1 upload stopped') : __('{0} uploads stopped', [stopped.value])
}

function summaryLine(): string | null {
  const { reading, preparing, folders } = queue.state
  if (reading) return __('{0} files found', [reading.found])
  if (preparing) return __('{0} of {1}', [folders.created, folders.total])
  const bytes = queue.indicator.value?.bytes
  if (!active.value || !bytes) return null
  const sent = __('{0} of {1}', [formatBytes(bytes.sent), formatBytes(bytes.total)])
  return timeLeft.value ? `${sent} · ${timeLeft.value}` : sent
}

// Time left, sampled once a second while files upload.
const timeLeft = ref<string | null>(null)
const estimate = new TimeLeft()
let ticker: ReturnType<typeof setInterval> | undefined

function tick() {
  const indicator = queue.indicator.value
  // Paused or reconnecting: no estimate, and the next one starts afresh.
  if (!indicator?.bytes || indicator.tone !== 'running') {
    estimate.reset()
    timeLeft.value = null
    return
  }
  timeLeft.value = estimate.update({ ...indicator.bytes, at: Date.now() })
}

watch(
  () => active.value > 0,
  (on) => {
    clearInterval(ticker)
    estimate.reset()
    timeLeft.value = null
    if (!on) return
    tick()
    ticker = setInterval(tick, 1000)
  },
  { immediate: true },
)

watch(
  () => queue.state.trackerOpen,
  (open) => {
    if (open) queue.markSeen()
  },
  { immediate: true },
)
onMounted(() => queue.setTrackerMounted(true))
onUnmounted(() => {
  queue.setTrackerMounted(false)
  clearInterval(ticker)
})

function percent(entry: UploadEntry) {
  if (entry.state === 'done') return 100
  return entry.size ? Math.round((entry.sent / entry.size) * 100) : 0
}

function showsProgress(entry: UploadEntry) {
  return (
    entry.state === 'uploading' ||
    entry.state === 'checking' ||
    entry.state === 'reconnecting' ||
    entry.state === 'held' ||
    entry.state === 'interrupted'
  )
}

/**
 * A finished upload needs nothing more, and closing the panel clears it, so
 * only failed, cancelled and stopped rows keep their Remove.
 */
function dismissible(entry: UploadEntry) {
  return ['failed', 'cancelled', 'interrupted'].includes(entry.state)
}

function canRetry(entry: UploadEntry) {
  if (entry.state === 'held' || entry.state === 'cancelled') return true
  return entry.state === 'failed' && entry.retryable
}

function canCancel(entry: UploadEntry) {
  return (
    ['queued', 'checking', 'uploading', 'reconnecting', 'held'].includes(entry.state) &&
    !isFinishing(entry)
  )
}

function status(entry: UploadEntry): string {
  if (entry.note && ['queued', 'checking', 'uploading', 'interrupted'].includes(entry.state))
    return entry.note
  switch (entry.state) {
    case 'queued':
      return __('Waiting')
    case 'checking':
      return __('Checking the file…')
    case 'uploading':
      if (isFinishing(entry)) return __('Finishing…')
      return __('{0} of {1}', [formatBytes(entry.sent), formatBytes(entry.size)])
    case 'reconnecting':
      return entry.offline ? __('Waiting for connection…') : __('Connection lost. Retrying…')
    case 'cancelled':
      return __('Cancelled')
    case 'held':
      return __('Paused: storage is full')
    case 'done':
      return __('Uploaded')
    case 'failed':
      return entry.error ?? __('The upload failed.')
    case 'interrupted':
      // Why Resume did not start it, such as a picker the browser refused to open.
      if (entry.error) return entry.error
      return __('Stopped at {0} of {1}', [formatBytes(entry.sent), formatBytes(entry.size)])
    case 'skipped':
      return __('Skipped')
  }
}

function iconClass(entry: UploadEntry): string {
  switch (entry.state) {
    case 'failed':
      return 'lucide-circle-alert text-ink-red-6'
    case 'held':
    case 'interrupted':
      return 'lucide-circle-pause text-ink-amber-6'
    case 'reconnecting':
      return 'lucide-wifi-off text-ink-amber-6'
    case 'skipped':
    case 'cancelled':
      return 'lucide-circle-minus text-ink-gray-5'
    default:
      return 'lucide-file-up text-ink-gray-6'
  }
}
</script>
