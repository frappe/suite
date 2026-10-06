<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
    <AreaSidebar area="meet" :title="__('Meet')">
      <MeetPanel />
    </AreaSidebar>
    <PageHeader>
      <div class="flex items-center gap-2">
        <Button
          class="md:hidden"
          variant="ghost"
          icon="lucide-menu"
          :aria-label="__('Meet navigation')"
          @click="openNavigation"
        />
        <h1 class="text-xl font-semibold text-ink-gray-9">{{ viewLabel }}</h1>
      </div>
      <NewMeetingMenu
        :loading="isStartingMeeting"
        variant="solid"
        @instant="startInstantMeeting"
        @restricted="startRestrictedMeeting"
        @schedule="openScheduleDialog"
      />
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-6">
        <section v-if="view === 'upcoming'" class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div class="hidden shrink-0 sm:block">
            <NewMeetingMenu
              :loading="isStartingMeeting"
              variant="subtle"
              size="md"
              @instant="startInstantMeeting"
              @restricted="startRestrictedMeeting"
              @schedule="openScheduleDialog"
            />
          </div>
          <form class="flex min-w-0 flex-1 items-start gap-2" @submit.prevent="joinWithCode">
            <TextInput
              v-model="meetingCode"
              size="md"
              class="min-w-0 flex-1"
              :placeholder="__('Enter a code or link')"
              :aria-label="__('Meeting code or link')"
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
        </section>
        <UpcomingMeetings
          v-if="view !== 'recordings' && calendarReady"
          :key="calendarStore.accountId"
          ref="upcomingMeetingsRef"
        />
        <p
          v-else-if="view !== 'recordings'"
          class="py-8 text-center text-base text-ink-gray-5"
          role="status"
        >
          {{ __('Loading meetings…') }}
        </p>
        <RecentMeetings v-if="view !== 'recordings'" />
        <Recordings v-if="view === 'recordings'" />
      </div>
    </div>

    <Dialog v-model:open="showScheduleDialog" :title="__('Schedule meet')" dismissible>
      <template #default>
        <div class="space-y-4">
          <FormControl
            v-model="scheduleTitle"
            :label="__('Title')"
            :placeholder="__('Team meeting')"
          />
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <FormControl
              v-model="scheduleDate"
              :label="__('Date')"
              type="date"
              format="MMM D, YYYY"
              :placeholder="__('Select date')"
            />
            <FormControl
              v-model="scheduleStartTime"
              :label="__('Start')"
              type="time"
              :interval="15"
              format="h:mm A"
              :placeholder="__('Select time')"
            />
            <FormControl
              v-model="scheduleEndTime"
              :label="__('End')"
              type="time"
              :interval="15"
              format="h:mm A"
              :placeholder="__('Select time')"
            />
          </div>
          <ParticipantSelector
            v-model="scheduleParticipants"
            :account="calendarStore.accountId"
            :display-participants="scheduledParticipants"
            :excluded-emails="currentUserEmail ? [currentUserEmail] : []"
          />
        </div>
      </template>
      <template #actions>
        <div class="flex justify-end">
          <Button
            variant="solid"
            :loading="scheduleMeeting.isPending"
            :disabled="!isScheduleTimeValid"
            @click="submitScheduledMeeting"
            >{{ __('Schedule') }}</Button
          >
        </div>
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl, PageHeader, TextInput, toast } from 'frappe-ui'
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, useMutation, useQuery } from '@/api'
import ParticipantSelector from '@/apps/calendar/components/ParticipantSelector.vue'
import { userStore as useCalendarUserStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import { adjustScheduleEndTime, adjustScheduleStartTime } from '@/apps/calendar/utils/scheduleTime'
import { AreaSidebar, openAreaSidebar } from '@/platform/area-sidebar'
import { translate as __ } from '@/platform/translation'
import { useRootStore } from '@/stores/root'

import MeetPanel from '../components/MeetPanel.vue'
import NewMeetingMenu from '../components/NewMeetingMenu.vue'
import RecentMeetings from '../components/RecentMeetings.vue'
import Recordings from '../components/Recordings.vue'
import UpcomingMeetings from '../components/UpcomingMeetings.vue'
import { useStartMeeting } from '../composables/useStartMeeting'
import { meetingCodeFrom } from '../utils/meetingCode'

interface CalendarParticipant {
  email: string
  _name?: string
  user_image?: string
  participation_status?: string
  expect_reply?: boolean
  isNew?: boolean
}

const router = useRouter()
const route = useRoute()
const root = useRootStore()
const { isStartingMeeting, startMeeting } = useStartMeeting()
const view = computed(() => (route.name === 'meet-recordings' ? 'recordings' : 'upcoming'))
const viewLabel = computed(() => (view.value === 'upcoming' ? __('Meet') : __('Recordings')))
const openNavigation = () => openAreaSidebar('meet')
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
const meetingCodeError = ref('')
const parsedMeetingCode = computed(() => meetingCodeFrom(meetingCode.value, window.location.origin))
const showScheduleDialog = ref(false)
const scheduleTitle = ref('')
const scheduleDate = ref(dayjs().format('YYYY-MM-DD'))
const scheduleStartTime = ref(dayjs().add(1, 'hour').startOf('hour').format('HH:mm'))
const scheduleEndTime = ref(dayjs().add(2, 'hour').startOf('hour').format('HH:mm'))
const scheduleParticipants = ref<CalendarParticipant[]>([])
const upcomingMeetingsRef = ref<{ reload: () => void } | null>(null)

watch(scheduleStartTime, (startTime) => {
  scheduleEndTime.value = adjustScheduleEndTime(startTime, scheduleEndTime.value)
})
watch(scheduleEndTime, (endTime) => {
  scheduleStartTime.value = adjustScheduleStartTime(scheduleStartTime.value, endTime)
})

const userResource = useQuery(api.suite.account.get)
const scheduleStart = computed(() => dayjs(`${scheduleDate.value}T${scheduleStartTime.value}`))
const scheduleEnd = computed(() => dayjs(`${scheduleDate.value}T${scheduleEndTime.value}`))
const isScheduleTimeValid = computed(
  () =>
    Boolean(scheduleDate.value && scheduleStartTime.value && scheduleEndTime.value) &&
    scheduleStart.value.isValid() &&
    scheduleEnd.value.isValid() &&
    scheduleEnd.value.isAfter(scheduleStart.value),
)
const scheduledDuration = computed(() => {
  if (!isScheduleTimeValid.value) return ''
  const diff = dayjs.duration(scheduleEnd.value.diff(scheduleStart.value))
  return dayjs
    .duration({ hours: Math.floor(diff.asHours()), minutes: diff.minutes() })
    .toISOString()
})
const currentUserEmail = computed(
  () => calendarStore.userResource.data?.name || userResource.data?.name,
)
const scheduledParticipants = computed(() => {
  const participants: CalendarParticipant[] = currentUserEmail.value
    ? [
        {
          email: currentUserEmail.value,
          _name: calendarStore.userResource.data?.full_name || userResource.data?.full_name,
          user_image: calendarStore.userResource.data?.avatar || userResource.data?.avatar,
          participation_status: 'ACCEPTED',
        },
      ]
    : []
  participants.push(...scheduleParticipants.value)
  return participants
})
const scheduleMeeting = useMutation(api.meet.meetings.createCalendar, { silent: true })
const startInstantMeeting = () => startMeeting('open')
const startRestrictedMeeting = () => startMeeting('restricted')
const openScheduleDialog = async () => {
  try {
    await calendarStore.loadUser()
    if (!calendarStore.accountId) {
      toast.error(__('Set up Calendar before scheduling a Meet.'))
      return
    }
    showScheduleDialog.value = true
  } catch (error) {
    console.error('Failed to load calendar account:', error)
    toast.error(__('Could not load Calendar account.'))
  }
}
const submitScheduledMeeting = () => {
  if (!calendarStore.accountId) {
    toast.error(__('Set up Calendar before scheduling a Meet.'))
    return
  }
  if (!isScheduleTimeValid.value) {
    toast.error(__('Enter a valid date and an end time after the start time.'))
    return
  }
  toast.promise(
    scheduleMeeting
      .run({
        account: calendarStore.accountId,
        title: scheduleTitle.value,
        start: scheduleStart.value.format('YYYY-MM-DD[T]HH:mm:ss'),
        duration: scheduledDuration.value,
        time_zone: dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone,
        participants: scheduledParticipants.value.map((participant) => ({ ...participant })),
        send_scheduling_messages: scheduledParticipants.value.length > 1,
      })
      .then(() => {
        showScheduleDialog.value = false
        toast.success(__('Meeting scheduled.'))
        upcomingMeetingsRef.value?.reload()
      }),
    {
      loading: __('Scheduling meeting...'),
      error: __('Failed to schedule meeting. Please try again.'),
    },
  )
}
const joinWithCode = () => {
  meetingCodeError.value = ''
  if (!parsedMeetingCode.value) {
    meetingCodeError.value = __('Please enter a valid meeting code (format: xxxx-xxxx-xxxx)')
    return
  }
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
        run: async () => {
          await router.push('/meet')
          await nextTick()
          document
            .querySelector<HTMLInputElement>('[data-testid="meeting-code-input"] input')
            ?.focus()
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
