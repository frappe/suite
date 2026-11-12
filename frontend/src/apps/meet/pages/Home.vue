<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
    <PageHeader>
      <h1 class="text-xl font-semibold text-ink-gray-9">{{ __('Meet') }}</h1>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-6">
        <section class="grid grid-cols-2 gap-3 lg:grid-cols-4" :aria-label="__('Meeting actions')">
          <Button
            v-for="action in meetingActions"
            :key="action.icon"
            class="meeting-action"
            variant="outline"
            :disabled="action.startsMeeting && isStartingMeeting"
            @click="action.run"
          >
            <span class="flex h-full w-full min-w-0 flex-col items-start justify-between gap-3">
              <span
                :class="[action.icon, 'size-4.5 shrink-0 text-ink-gray-8']"
                aria-hidden="true"
              />
              <span class="w-full truncate text-start text-base font-medium text-ink-gray-8">{{
                action.label
              }}</span>
            </span>
          </Button>
        </section>
        <UpcomingMeetings
          v-if="calendarReady"
          :key="calendarStore.accountId"
          ref="upcomingMeetingsRef"
        />
      </div>
    </div>

    <Dialog v-model:open="showJoinDialog" :title="__('Join with meeting code')" dismissible>
      <template #default>
        <form class="flex min-w-0 flex-col gap-4" @submit.prevent="joinWithCode">
          <TextInput
            v-model="meetingCode"
            size="md"
            class="min-w-0 flex-1"
            :placeholder="__('Enter a code or link')"
            :label="__('Meeting code or link')"
            :error="meetingCodeError"
            data-testid="meeting-code-input"
          >
            <template #prefix
              ><span class="lucide-keyboard size-4 text-ink-gray-5" aria-hidden="true"
            /></template>
          </TextInput>
          <Button
            type="submit"
            size="md"
            variant="outline"
            :label="__('Join')"
            :disabled="!parsedMeetingCode"
            data-testid="join-meeting-button"
          />
        </form>
      </template>
    </Dialog>

    <ScheduleMeetingDialog ref="scheduleDialog" @scheduled="upcomingMeetingsRef?.reload()" />
  </div>
</template>

<script setup lang="ts">
import { Button, Dialog, PageHeader, TextInput } from 'frappe-ui'
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useCalendarUserStore } from '@/apps/calendar'
import { translate as __ } from '@/platform/translation'
import { useRootStore } from '@/stores/root'

import ScheduleMeetingDialog from '../components/ScheduleMeetingDialog.vue'
import UpcomingMeetings from '../components/UpcomingMeetings.vue'
import { useStartMeeting } from '../composables/useStartMeeting'
import { meetingCodeFrom } from '../utils/meetingCode'

const router = useRouter()
const root = useRootStore()
const { isStartingMeeting, startMeeting } = useStartMeeting()
const calendarStore = useCalendarUserStore()
// Resolve the account before mounting the list, so it shows the account's meetings from the start.
const calendarReady = ref(false)
onMounted(async () => {
  try {
    await calendarStore.loadUser()
  } catch {
    // The list owns the account error and retry UI.
  } finally {
    calendarReady.value = true
  }
})
const meetingCode = ref('')
const showJoinDialog = ref(false)
const meetingCodeError = ref('')
const parsedMeetingCode = computed(() => meetingCodeFrom(meetingCode.value, window.location.origin))
const scheduleDialog = ref<InstanceType<typeof ScheduleMeetingDialog> | null>(null)
const upcomingMeetingsRef = ref<{ reload: () => void } | null>(null)

const startInstantMeeting = () => startMeeting('open')
const startRestrictedMeeting = () => startMeeting('restricted')
const meetingActions = computed(() => [
  { label: __('Instant meet'), icon: 'lucide-zap', startsMeeting: true, run: startInstantMeeting },
  {
    label: __('Restricted meet'),
    icon: 'lucide-lock',
    startsMeeting: true,
    run: startRestrictedMeeting,
  },
  {
    label: __('Schedule meet'),
    icon: 'lucide-calendar-plus',
    startsMeeting: false,
    run: openScheduleDialog,
  },
  {
    label: __('Join with code'),
    icon: 'lucide-link',
    startsMeeting: false,
    run: () => (showJoinDialog.value = true),
  },
])
const openScheduleDialog = () => scheduleDialog.value?.show()
const joinWithCode = () => {
  meetingCodeError.value = ''
  if (!parsedMeetingCode.value) {
    meetingCodeError.value = __('Please enter a valid meeting code (format: xxxx-xxxx-xxxx)')
    return
  }
  showJoinDialog.value = false
  router.push({ name: 'meet-meeting', params: { meetingId: parsedMeetingCode.value } })
}

const unregisterPaletteGroups = root.registerPaletteGroups('meet-home', () => [
  {
    commands: [
      {
        id: 'meet-start-open',
        label: __('Start instant meet'),
        enterHint: __('start instant meet'),
        icon: 'lucide-zap',
        keywords: ['new', 'instant', 'room'],
        disabled: isStartingMeeting.value,
        run: startInstantMeeting,
      },
      {
        id: 'meet-start-restricted',
        label: __('Start restricted meet'),
        enterHint: __('start restricted meet'),
        icon: 'lucide-lock',
        keywords: ['new', 'private', 'room'],
        disabled: isStartingMeeting.value,
        run: startRestrictedMeeting,
      },
      {
        id: 'meet-join-code',
        label: __('Join with code'),
        enterHint: __('join with code'),
        icon: 'lucide-link',
        keywords: ['room', 'call'],
        run: () => {
          showJoinDialog.value = true
        },
      },
      {
        id: 'meet-schedule',
        label: __('Schedule meet'),
        enterHint: __('schedule meet'),
        icon: 'lucide-calendar-plus',
        keywords: ['calendar', 'new'],
        run: openScheduleDialog,
      },
    ],
  },
])
onScopeDispose(unregisterPaletteGroups)
</script>

<style scoped>
.meeting-action {
  @apply aspect-[1.7] w-full min-w-0 overflow-hidden rounded-5 border-outline-gray-1 bg-surface-elevation-1 p-3 text-start transition-colors;
  height: auto;
}
.meeting-action:hover {
  @apply border-outline-gray-2 bg-surface-gray-1 dark:bg-surface-elevation-2;
}
.meeting-action :deep(> span) {
  @apply h-full w-full;
}
</style>
