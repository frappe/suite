<script setup lang="ts">
import { useMediaQuery, useNow } from '@vueuse/core'
import dayjs from 'dayjs'
import { Button, useCall } from 'frappe-ui'
import { List, ListCell, ListRow } from 'frappe-ui/list'
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { driveNodeRoute } from '@/apps/drive'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

interface RecentMeeting {
  id: string
  title: string | null
  last_joined: string
  recording?: string | null
}

const router = useRouter()
const session = useSession()
const now = useNow({ interval: 30_000 })
const isMobile = useMediaQuery('(max-width: 767px)')
function recentDay(date: string): string {
  const joined = dayjs(date)
  const today = dayjs(now.value).startOf('day')
  const days = today.diff(joined.startOf('day'), 'day')
  if (days <= 0) return __('Today')
  if (days === 1) return __('Yesterday')
  if (days < 7) {
    const weekdays = [
      __('Sunday'),
      __('Monday'),
      __('Tuesday'),
      __('Wednesday'),
      __('Thursday'),
      __('Friday'),
      __('Saturday'),
    ]
    return weekdays[joined.day()]
  }
  return __('Last week')
}
const meetings = useCall<RecentMeeting[]>({
  url: '/api/v2/method/suite.meet.api.recents.get_recent_meetings',
  cacheKey: ['meet-recent-rooms', window.location.origin, session.user.value?.id || 'Guest'],
  immediate: false,
})
onMounted(() => {
  void meetings.reload().catch(() => {})
})
</script>

<template>
  <section
    v-if="meetings.loading || meetings.error || meetings.data?.length"
    :aria-label="__('Recent')"
  >
    <h2 class="pb-3 text-lg font-medium text-ink-gray-9">{{ __('Recent') }}</h2>
    <p v-if="meetings.loading && !meetings.data" class="text-base text-ink-gray-5" role="status">
      {{ __('Loading meetings…') }}
    </p>
    <div
      v-else-if="meetings.error"
      class="flex items-center gap-2 text-base text-ink-gray-5"
      role="alert"
    >
      {{ __('Could not load recent meetings.') }}
      <Button :label="__('Retry')" @click="meetings.reload()" />
    </div>
    <List
      v-else
      class="-mx-3 list-row-px-3"
      :columns="['12rem', 'minmax(0,1fr)', '9rem']"
      :row-height="isMobile ? 52 : 40"
    >
      <ListRow v-for="meeting in meetings.data" :key="meeting.id" :value="meeting.id">
        <ListCell
          ><span class="whitespace-nowrap text-base text-ink-gray-5">
            {{ recentDay(meeting.last_joined) }}, {{ dayjs(meeting.last_joined).format('h:mm a') }}
          </span></ListCell
        >
        <ListCell>
          <span class="truncate text-base text-ink-gray-8">{{ meeting.title || meeting.id }}</span>
        </ListCell>
        <ListCell class="justify-end gap-2"
          ><Button
            v-if="meeting.recording"
            :aria-label="__('Play recording')"
            variant="ghost"
            icon="lucide-circle-play"
            :route="driveNodeRoute(meeting.recording)" />
          <Button
            :label="__('Join')"
            variant="outline"
            @click="router.push({ name: 'meet-meeting', params: { meetingId: meeting.id } })"
        /></ListCell>
      </ListRow>
    </List>
  </section>
</template>
