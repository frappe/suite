<!-- Owns Calendar account readiness, meeting participants and scheduling for both home screens. -->
<template>
  <Dialog v-model:open="open" :title="__('Schedule meet')" dismissible>
    <template #default>
      <div class="space-y-4">
        <FormControl v-model="title" :label="__('Title')" :placeholder="__('Team meeting')" />
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FormControl
            v-model="date"
            :label="__('Date')"
            type="date"
            format="MMM D, YYYY"
            :placeholder="__('Select date')"
          />
          <FormControl
            v-model="startTime"
            :label="__('Start')"
            type="time"
            :interval="15"
            format="h:mm A"
            :placeholder="__('Select time')"
          />
          <FormControl
            v-model="endTime"
            :label="__('End')"
            type="time"
            :interval="15"
            format="h:mm A"
            :placeholder="__('Select time')"
          />
        </div>
        <ParticipantSelector
          v-model="participants"
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
          :disabled="!isTimeValid"
          @click="submit"
          >{{ __('Schedule') }}</Button
        >
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl, toast } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import {
  adjustScheduleEndTime,
  adjustScheduleStartTime,
  calendarDayjs as dayjs,
  ParticipantSelector,
  useCalendarUserStore,
} from '@/apps/calendar'
import { translate as __ } from '@/platform/translation'

interface CalendarParticipant {
  email: string
  _name?: string
  user_image?: string
  participation_status?: string
  expect_reply?: boolean
  isNew?: boolean
}

const emit = defineEmits<{ scheduled: [] }>()
const open = ref(false)
const calendarStore = useCalendarUserStore()
const title = ref('')
const date = ref(dayjs().format('YYYY-MM-DD'))
const startTime = ref(dayjs().add(1, 'hour').startOf('hour').format('HH:mm'))
const endTime = ref(dayjs().add(2, 'hour').startOf('hour').format('HH:mm'))
const participants = ref<CalendarParticipant[]>([])

watch(startTime, (value) => {
  endTime.value = adjustScheduleEndTime(value, endTime.value)
})
watch(endTime, (value) => {
  startTime.value = adjustScheduleStartTime(startTime.value, value)
})

const userResource = useQuery(api.suite.account.get)
const start = computed(() => dayjs(`${date.value}T${startTime.value}`))
const end = computed(() => dayjs(`${date.value}T${endTime.value}`))
const isTimeValid = computed(
  () =>
    Boolean(date.value && startTime.value && endTime.value) &&
    start.value.isValid() &&
    end.value.isValid() &&
    end.value.isAfter(start.value),
)
const duration = computed(() => {
  if (!isTimeValid.value) return ''
  const diff = dayjs.duration(end.value.diff(start.value))
  return dayjs
    .duration({ hours: Math.floor(diff.asHours()), minutes: diff.minutes() })
    .toISOString()
})
const currentUserEmail = computed(
  () => calendarStore.userResource.data?.name || userResource.data?.name,
)
const scheduledParticipants = computed(() => {
  const attendees: CalendarParticipant[] = currentUserEmail.value
    ? [
        {
          email: currentUserEmail.value,
          _name: calendarStore.userResource.data?.full_name || userResource.data?.full_name,
          user_image: userResource.data?.avatar,
          participation_status: 'ACCEPTED',
        },
      ]
    : []
  attendees.push(...participants.value)
  return attendees
})
const scheduleMeeting = useMutation(api.meet.meetings.createCalendar, { silent: true })

async function show() {
  try {
    await calendarStore.loadUser()
    if (!calendarStore.accountId) {
      toast.error(__('Set up Calendar before scheduling a Meet.'))
      return
    }
    open.value = true
  } catch (error) {
    console.error('Failed to load calendar account:', error)
    toast.error(__('Could not load Calendar account.'))
  }
}

function submit() {
  if (!calendarStore.accountId) {
    toast.error(__('Set up Calendar before scheduling a Meet.'))
    return
  }
  if (!isTimeValid.value) {
    toast.error(__('Enter a valid date and an end time after the start time.'))
    return
  }
  toast.promise(
    scheduleMeeting
      .run({
        account: calendarStore.accountId,
        title: title.value,
        start: start.value.format('YYYY-MM-DD[T]HH:mm:ss'),
        duration: duration.value,
        time_zone: dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone,
        participants: scheduledParticipants.value.map((participant) => ({ ...participant })),
        send_scheduling_messages: scheduledParticipants.value.length > 1,
      })
      .then(() => {
        open.value = false
        toast.success(__('Meeting scheduled.'))
        emit('scheduled')
      }),
    {
      loading: __('Scheduling meeting...'),
      error: __('Failed to schedule meeting. Please try again.'),
    },
  )
}

defineExpose({ show })
</script>
