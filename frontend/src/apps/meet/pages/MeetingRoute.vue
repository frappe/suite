<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

import { api, useQuery } from '@/api'
import { translate as __ } from '@/platform/translation'

import MeetStatusScreen from '../components/MeetStatusScreen.vue'
import Meeting from './Meeting.vue'

const route = useRoute()
const router = useRouter()
const meet = useQuery(api.meet.rooms.resolve, () => {
  const link = route.params.meetingId
  return typeof link === 'string' ? { link } : false
})
</script>

<template>
  <Meeting
    v-if="meet.data?.meeting"
    :key="route.params.meetingId?.toString()"
    :resolved-code="meet.data.meeting.code"
    :share-url="meet.data.meeting.url"
  />
  <div v-else class="fixed inset-0 flex bg-surface-base text-ink-gray-9" data-theme="dark">
    <p v-if="meet.status === 'pending'" class="m-auto" role="status">{{ __('Loading meet…') }}</p>
    <MeetStatusScreen
      v-else-if="meet.error"
      icon="lucide-circle-alert"
      :title="__('Could not open the meet')"
      :description="__('Try loading the link again.')"
      :action-label="__('Retry')"
      @action="meet.refetch()"
    />
    <MeetStatusScreen
      v-else
      icon="lucide-link-2-off"
      :title="__('Meet not found')"
      :description="__('Check the link or return to Meet.')"
      :action-label="__('Back to Meet')"
      @action="router.push({ name: 'meet-home' })"
    />
  </div>
</template>
