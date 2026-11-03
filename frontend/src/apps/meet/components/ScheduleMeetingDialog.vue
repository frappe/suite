<!-- Owns Calendar account readiness, meeting participants and scheduling for both home screens. -->
<template>
  <Dialog v-model:open="open" :title="__('Schedule meet')" dismissible>
    <template #default>
      <div v-if="readiness !== 'ready'" class="space-y-3">
        <Alert :title="accountMessage" />
        <Button v-if="readiness !== 'loading'" @click="loadAccount">{{ __('Retry') }}</Button>
        <Button
          v-if="
            readiness === 'missing' &&
            canManageAccounts &&
            session.user.value?.is_mail_server_configured
          "
          :to="{ name: 'mail-accounts' }"
        >
          {{ __('Open Admin users') }}
        </Button>
      </div>
      <div v-else class="space-y-4" @keydown.meta.enter.prevent.stop="submit">
        <Alert v-if="submitError" theme="red" :title="submitError" />
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
          :disabled="readiness !== 'ready' || !isTimeValid"
          @click="submit"
          >{{ __('Schedule') }}</Button
        >
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Alert, Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import {
  adjustScheduleEndTime,
  adjustScheduleStartTime,
  calendarDayjs as dayjs,
  ParticipantSelector,
  useCalendarUserStore,
} from '@/apps/calendar'
import { toast } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { userTimeZone } from '@/platform/time-zone'
import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

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
const session = useSession()
const readiness = ref<'loading' | 'ready' | 'missing' | 'denied' | 'failed'>('loading')
const submitError = ref('')
const canManageAccounts = computed(() => !!session.capabilities.value.suiteAdmin)
const accountMessage = computed(() => {
  if (readiness.value === 'loading') return __('Loading Calendar account...')
  if (readiness.value === 'failed')
    return __('Could not load Calendar account. Retry to check availability.')
  if (readiness.value === 'denied')
    return __(
      'Your account cannot access Calendar. Ask a site administrator to review your access.',
    )
  if (!session.user.value?.is_mail_server_configured)
    return __(
      'Scheduling needs a configured mail account. Ask a site administrator to configure mail, then retry.',
    )
  return canManageAccounts.value
    ? __(
        'You do not have a Calendar account. Open Admin users to review your Mail account setup, then retry.',
      )
    : __("You don't have a Mail account. Ask your admin to add one, then retry.")
})
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
  open.value = true
  submitError.value = ''
  await loadAccount()
}

async function loadAccount() {
  readiness.value = 'loading'
  try {
    await calendarStore.loadUser()
    readiness.value = calendarStore.accountId ? 'ready' : 'missing'
  } catch (error) {
    readiness.value =
      error instanceof TransportError && error.type === 'AccountSetupRequired'
        ? 'missing'
        : error instanceof TransportError && error.type === 'PermissionError'
          ? 'denied'
          : 'failed'
  }
}

function submit() {
  if (scheduleMeeting.isPending || readiness.value !== 'ready') return
  if (!calendarStore.accountId) {
    readiness.value = 'missing'
    return
  }
  if (!isTimeValid.value) {
    toast.error(__('Enter a valid date and an end time after the start time.'))
    return
  }
  submitError.value = ''
  toast.promise(
    scheduleMeeting
      .run({
        account: calendarStore.accountId,
        title: title.value,
        start: start.value.format('YYYY-MM-DD[T]HH:mm:ss'),
        duration: duration.value,
        time_zone: userTimeZone(),
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
      error: (error: unknown) => {
        submitError.value =
          error instanceof TransportError &&
          ['ValidationError', 'BadRequest', 'PermissionError'].includes(error.type) &&
          error.status >= 400 &&
          error.status < 500 &&
          error.message
            ? error.message
            : __('Could not schedule the meeting. Your details are kept. Please try again.')
        return __('Meeting was not scheduled. Review the message and try again.')
      },
    },
  )
}

defineExpose({ show })
</script>
