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
      :class="
        overall
          ? 'flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 border-b border-outline-gray-1 py-2 pl-4 pr-2'
          : 'flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 pl-4 pr-2'
      "
    >
      <div v-if="overall" class="min-w-0 flex-1">
        <h2 class="truncate text-base-semibold text-ink-gray-8">{{ heading }}</h2>
        <p
          v-if="subline"
          data-slot="upload-summary"
          class="mt-0.5 truncate text-sm text-ink-gray-5"
        >
          {{ subline }}
        </p>
      </div>
      <h2 v-else class="min-w-0 flex-1 truncate text-base-semibold text-ink-gray-8">
        {{ heading }}
      </h2>
      <Button
        v-if="retryable > 1 && !(messages && queue.state.halted)"
        variant="ghost"
        :label="__('Retry all')"
        @click="queue.retryAll()"
      />
      <Button
        v-if="resumesAll && stopped > 1"
        variant="ghost"
        :label="__('Resume all')"
        @click="queue.resumeAll(() => pickFiles({ multiple: true }))"
      />
      <Button
        v-if="cancels && active > 1"
        variant="ghost"
        :label="__('Cancel all')"
        @click="queue.cancelAll()"
      />
      <!-- Closing only hides the list while uploads go on. -->
      <Button
        variant="ghost"
        icon="lucide-x"
        :aria-label="active ? __('Hide uploads') : __('Close uploads')"
        @click="queue.closeTracker()"
      />
      <Progress
        v-if="overall && active"
        :value="overallPercent"
        size="sm"
        class="mr-2 mt-2 basis-full"
        :aria-label="__('Upload progress')"
      />
    </header>
    <Alert
      v-if="queue.state.halted"
      class="m-2 shrink-0"
      theme="amber"
      :title="__('Storage is full')"
      :description="messages ? __('Free up space, then retry.') : queue.state.halted"
      :primary-action="{ label: __('Retry all'), onClick: () => queue.retryAll() }"
      :secondary-action="
        messages
          ? { label: __('Manage storage'), onClick: () => openSettings('drive.statistics') }
          : undefined
      "
    />
    <p
      v-if="queue.state.preparing && !overall"
      class="flex h-10 shrink-0 items-center gap-2 px-4 text-sm text-ink-gray-5"
    >
      <span
        class="lucide-loader-circle size-4 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {{ __('Creating folders…') }}
    </p>
    <ul class="min-h-0 flex-1 divide-y divide-outline-gray-1 overflow-y-auto">
      <li
        v-for="entry in entries"
        :key="entry.id"
        data-slot="upload-entry"
        :data-state="entry.state"
        :class="
          messages
            ? 'flex min-h-16 items-center gap-3 px-4 py-2'
            : 'flex h-16 items-center gap-3 px-4'
        "
      >
        <span :class="iconClass(entry)" class="size-4 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <RouterLink
            v-if="opens && entry.state === 'done' && entry.node"
            :to="driveNodeRoute({ name: entry.node, title: entry.title, kind: 'file' })"
            class="block truncate text-base text-ink-gray-8 hover:underline focus-visible:underline focus-visible:outline-none"
            :title="messages ? entry.title : undefined"
          >
            {{ entry.title }}
          </RouterLink>
          <p
            v-else
            class="truncate text-base text-ink-gray-8"
            :title="messages ? entry.title : undefined"
          >
            {{ entry.title }}
          </p>
          <p
            :class="[
              messages && (entry.state === 'failed' || entry.note)
                ? 'mt-1 line-clamp-2 text-sm'
                : 'mt-1 truncate text-sm',
              entry.state === 'failed' ? 'text-ink-red-7' : 'text-ink-gray-5',
            ]"
            :title="entry.state === 'failed' ? status(entry) : undefined"
          >
            {{ status(entry) }}
          </p>
          <!-- Always laid out, so a row keeps its height when it finishes. -->
          <Progress
            :value="percent(entry)"
            size="sm"
            class="mt-1.5"
            :class="{ invisible: !showsProgress(entry) }"
          />
        </div>
        <template v-if="cancels">
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
        </template>
        <template v-else>
          <Button
            v-if="entry.state === 'interrupted'"
            :label="__('Resume')"
            @click="queue.resume(entry.id)"
          />
          <Button
            v-else-if="(entry.state === 'failed' && entry.retryable) || entry.state === 'held'"
            :label="__('Retry')"
            @click="queue.retry(entry.id)"
          />
          <Button
            v-else-if="dismissible(entry)"
            variant="ghost"
            icon="lucide-x"
            :aria-label="__('Remove {0}', [entry.title])"
            @click="queue.dismiss(entry.id)"
          />
        </template>
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
import { useTweak } from '@/platform/tweaks'

import { TimeLeft } from './eta'
import { formatBytes } from './format'
import { pickFiles } from './picker'
import { isFinishing, uploadQueue, type UploadEntry, type UploadQueue } from './queue'

/** The upload list (spec §6.3). Opening it counts as seeing its failures. */
const props = defineProps<{ queue?: UploadQueue }>()
const queue = props.queue ?? uploadQueue()
const cancels = useTweak('t28-cancel-upload')
const resumesAll = useTweak('t29-resume-all')
const reopens = useTweak('t29-reopen-tracker')
const overall = useTweak('t30-overall-progress')
const timesLeft = useTweak('t30-time-left')
const opens = useTweak('t30-open-finished')
const messages = useTweak('t30-messages')
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
const retryable = computed(
  () =>
    entries.value.filter(
      (entry) => (entry.state === 'failed' && entry.retryable) || entry.state === 'held',
    ).length,
)
const heading = computed(() => (overall.value ? summaryHeading() : listHeading()))
const subline = computed(() => (overall.value ? summaryLine() : null))
const overallPercent = computed(() => Math.round((queue.indicator.value?.fraction ?? 0) * 100))

function listHeading(): string {
  if (running.value)
    return running.value === 1 ? __('Uploading 1 file') : __('Uploading {0} files', [running.value])
  if (queue.state.preparing) return __('Preparing upload')
  if (reopens.value && stopped.value) return stoppedHeading()
  return __('Uploads')
}

/** The header's heading while it sums up the run (t30-overall-progress). First match wins. */
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

// Time left (t30-time-left), sampled once a second while files upload.
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
  () => timesLeft.value && overall.value && active.value > 0,
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

function dismissible(entry: UploadEntry) {
  if (cancels.value && (entry.state === 'cancelled' || entry.state === 'interrupted')) return true
  return entry.state === 'done' || entry.state === 'skipped' || entry.state === 'failed'
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
      if (cancels.value && isFinishing(entry)) return __('Finishing…')
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
    case 'done':
      return 'lucide-circle-check text-ink-green-6'
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
