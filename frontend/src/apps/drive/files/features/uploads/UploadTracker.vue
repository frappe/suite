<template>
  <section
    v-if="queue.state.trackerOpen && (entries.length || queue.state.preparing)"
    data-slot="upload-tracker"
    aria-label="Uploads"
    class="fixed inset-x-2 bottom-20 z-20 flex max-h-96 flex-col overflow-hidden rounded-6 border border-outline-gray-1 bg-surface-elevation-2 shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
  >
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 pl-4 pr-2">
      <h2 class="min-w-0 flex-1 truncate text-base-semibold text-ink-gray-8">{{ heading }}</h2>
      <Button
        v-if="retryable > 1"
        variant="ghost"
        label="Retry all"
        @click="queue.retryAll()"
      />
      <Button variant="ghost" icon="lucide-x" aria-label="Close uploads" @click="queue.closeTracker()" />
    </header>
    <Alert
      v-if="queue.state.halted"
      class="m-2 shrink-0"
      theme="amber"
      title="Storage is full"
      :description="queue.state.halted"
      :primary-action="{ label: 'Retry all', onClick: () => queue.retryAll() }"
    />
    <p v-if="queue.state.preparing" class="flex h-10 shrink-0 items-center gap-2 px-4 text-sm text-ink-gray-5">
      <span class="lucide-loader-circle size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Creating folders…
    </p>
    <ul class="min-h-0 flex-1 divide-y divide-outline-gray-1 overflow-y-auto">
      <li
        v-for="entry in entries"
        :key="entry.id"
        data-slot="upload-entry"
        :data-state="entry.state"
        class="flex h-16 items-center gap-3 px-4"
      >
        <span :class="iconClass(entry)" class="size-4 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-base text-ink-gray-8">{{ entry.title }}</p>
          <p class="mt-1 truncate text-sm" :class="entry.state === 'failed' ? 'text-ink-red-7' : 'text-ink-gray-5'">
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
        <Button
          v-if="entry.state === 'interrupted'"
          label="Resume"
          @click="queue.resume(entry.id)"
        />
        <Button
          v-else-if="(entry.state === 'failed' && entry.retryable) || entry.state === 'held'"
          label="Retry"
          @click="queue.retry(entry.id)"
        />
        <Button
          v-else-if="dismissible(entry)"
          variant="ghost"
          icon="lucide-x"
          :aria-label="`Remove ${entry.title}`"
          @click="queue.dismiss(entry.id)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { Alert, Button, Progress } from 'frappe-ui'

import { formatBytes } from './format'
import { uploadQueue, type UploadEntry, type UploadQueue } from './queue'

/** The upload list (spec §6.3). Opening it counts as seeing its failures. */
const props = defineProps<{ queue?: UploadQueue }>()
const queue = props.queue ?? uploadQueue()
const entries = computed(() => queue.entries.value)
const running = computed(() => entries.value.filter((entry) => ['queued', 'checking', 'uploading'].includes(entry.state)).length)
const retryable = computed(() => entries.value.filter((entry) => (entry.state === 'failed' && entry.retryable) || entry.state === 'held').length)
const heading = computed(() => {
  if (running.value) return running.value === 1 ? 'Uploading 1 file' : `Uploading ${running.value} files`
  if (queue.state.preparing) return 'Preparing upload'
  return 'Uploads'
})

watch(
  () => queue.state.trackerOpen,
  (open) => {
    if (open) queue.markSeen()
  },
  { immediate: true },
)

function percent(entry: UploadEntry) {
  if (entry.state === 'done') return 100
  return entry.size ? Math.round((entry.sent / entry.size) * 100) : 0
}

function showsProgress(entry: UploadEntry) {
  return entry.state === 'uploading' || entry.state === 'checking' || entry.state === 'held' || entry.state === 'interrupted'
}

function dismissible(entry: UploadEntry) {
  return entry.state === 'done' || entry.state === 'skipped' || entry.state === 'failed'
}

function status(entry: UploadEntry): string {
  if (entry.note && ['queued', 'checking', 'uploading', 'interrupted'].includes(entry.state)) return entry.note
  switch (entry.state) {
    case 'queued':
      return 'Waiting'
    case 'checking':
      return 'Checking the file…'
    case 'uploading':
      return `${formatBytes(entry.sent)} of ${formatBytes(entry.size)}`
    case 'held':
      return 'Paused: storage is full'
    case 'done':
      return 'Uploaded'
    case 'failed':
      return entry.error ?? 'The upload failed.'
    case 'interrupted':
      return `Stopped at ${formatBytes(entry.sent)} of ${formatBytes(entry.size)}`
    case 'skipped':
      return 'Skipped'
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
    case 'skipped':
      return 'lucide-circle-minus text-ink-gray-5'
    default:
      return 'lucide-file-up text-ink-gray-6'
  }
}
</script>
