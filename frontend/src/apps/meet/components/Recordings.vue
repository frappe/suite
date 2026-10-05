<script setup lang="ts">
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { Button, useCall } from 'frappe-ui'
import { List, ListCell, ListRow } from 'frappe-ui/list'
import { onMounted } from 'vue'

import { driveNodeRoute } from '@/apps/drive'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

interface Recording {
  name: string
  meet_room: string
  room_title: string | null
  started_at: string
  artifact: string
  status: 'Ready' | 'Partial'
}
dayjs.extend(utc)
const session = useSession()
const recordings = useCall<Recording[]>({
  url: '/api/v2/method/suite.meet.api.recordings.get_recordings',
  cacheKey: ['meet-recordings', window.location.origin, session.user.value?.id || 'Guest'],
  immediate: false,
})
onMounted(() => {
  void recordings.reload().catch(() => {})
})
</script>

<template>
  <section :aria-label="__('Recordings')">
    <h2 class="pb-3 text-lg font-medium text-ink-gray-9">{{ __('Recordings') }}</h2>
    <p
      v-if="recordings.loading && !recordings.data"
      role="status"
      class="text-base text-ink-gray-5"
    >
      {{ __('Loading recordings…') }}
    </p>
    <div v-else-if="recordings.error" role="alert" class="text-base text-ink-gray-5">
      {{ __('Could not load recordings.') }}
      <Button :label="__('Retry')" @click="recordings.reload()" />
    </div>
    <List
      v-else-if="recordings.data?.length"
      class="-mx-3 list-row-px-3"
      :columns="['12rem', 'minmax(0,1fr)', '5rem']"
      :row-height="40"
    >
      <ListRow v-for="recording in recordings.data" :key="recording.name" :value="recording.name">
        <ListCell
          ><span class="whitespace-nowrap text-base text-ink-gray-5">{{
            dayjs.utc(recording.started_at).local().format('D MMM, h:mm a')
          }}</span></ListCell
        >
        <ListCell class="gap-2">
          <span class="truncate text-base text-ink-gray-8">{{
            recording.room_title || recording.meet_room
          }}</span>
          <span
            v-if="recording.status === 'Partial'"
            class="lucide-circle-alert size-4 shrink-0 text-ink-gray-5"
            role="img"
            :aria-label="__('Partial recording')"
            :title="__('Partial recording')"
          />
        </ListCell>
        <ListCell class="justify-end"
          ><Button
            :aria-label="__('Play recording')"
            icon="lucide-circle-play"
            variant="ghost"
            :route="driveNodeRoute(recording.artifact)"
        /></ListCell>
      </ListRow>
    </List>
    <div
      v-else
      class="flex flex-col items-center rounded-5 border border-dashed border-outline-gray-2 px-4 py-8 text-center text-base text-ink-gray-5"
    >
      <p>{{ __('No recordings yet. Record from inside a meeting.') }}</p>
      <Button class="mt-3" variant="outline" :label="__('Open Files')" route="/drive" />
    </div>
  </section>
</template>
