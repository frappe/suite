<script setup lang="ts">
import { Button, Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import { translate as __ } from '@/platform/translation'

import { dayLabel, durationLabel } from '../utils/homeDates'

const recordings = useQuery(api.meet.recordings.list)
// Recordings are filed into the owner's "Meet Recordings" folder, so the newest
// one's folder is where the rest of them are.
const newest = computed(() => recordings.data?.[0]?.artifact)
const newestNode = useQuery(api.drive.nodes.get, () =>
  newest.value ? { node: newest.value } : false,
)
const folderRoute = computed(() =>
  newestNode.data?.parent_node ? `/drive/f/${newestNode.data.parent_node}` : undefined,
)

const rows = computed(() =>
  (recordings.data ?? []).slice(0, 3).map((recording) => ({
    name: recording.name,
    title: recording.room_title || __('Meeting recording'),
    detail: [dayLabel(recording.started_at), durationLabel(recording.artifact_duration)]
      .filter(Boolean)
      .join(' ・ '),
    partial: recording.status === 'Partial',
    route: `/d/${recording.artifact}`,
  })),
)
</script>

<template>
  <section v-if="rows.length" :aria-label="__('Recordings')">
    <div class="mb-3 flex h-7 items-center justify-between">
      <h2 class="text-base font-medium text-ink-gray-8">{{ __('Recordings') }}</h2>
      <Button
        v-if="folderRoute"
        variant="ghost"
        :label="__('View all')"
        icon-right="lucide-chevron-right"
        :route="folderRoute"
      />
    </div>
    <div class="overflow-hidden rounded-7 border border-outline-gray-1 bg-surface-gray-1">
      <Button
        v-for="recording in rows"
        :key="recording.name"
        class="recording-row"
        variant="ghost"
        :route="recording.route"
        :aria-label="
          recording.partial
            ? __('Open partial recording of {0}', [recording.title])
            : __('Open recording of {0}', [recording.title])
        "
      >
        <span class="flex w-full min-w-0 items-center gap-2.5">
          <span
            class="grid size-11 shrink-0 place-items-center rounded-6 border border-outline-gray-1 bg-surface-base"
            aria-hidden="true"
          >
            <span class="lucide-play size-4.5 text-ink-gray-7" />
          </span>
          <span class="min-w-0 flex-1 text-start">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="truncate text-sm font-medium text-ink-gray-8">{{
                recording.title
              }}</span>
              <Tooltip v-if="recording.partial" :text="__('Partial recording')">
                <span
                  class="lucide-circle-dashed size-3.5 shrink-0 text-ink-gray-6"
                  aria-hidden="true"
                />
              </Tooltip>
            </span>
            <span class="mt-1.5 block truncate text-sm text-ink-gray-6">{{
              recording.detail
            }}</span>
          </span>
        </span>
      </Button>
    </div>
  </section>
</template>

<style scoped>
.recording-row {
  @apply h-[66px] w-full rounded-none border-outline-gray-1 px-2.5 py-2.5 hover:bg-surface-gray-2;
}
.recording-row:not(:last-child) {
  @apply border-b;
}
.recording-row :deep(> span) {
  @apply w-full;
}
</style>
