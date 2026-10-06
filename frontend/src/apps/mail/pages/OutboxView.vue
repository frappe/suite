<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center justify-between border-b px-3 py-2.5 max-sm:p-0 sm:px-5">
      <MobileTitleHeader v-if="isMobile" class="min-w-0 flex-1" :title="__('Outbox')" />
      <!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
      <Breadcrumbs v-else :items="[{ label: __('Outbox') }]" class="-ml-0.5" />
      <HeaderActions @reload-mails="refresh()" />
    </header>

    <OutboxFilters :filters="filters" />

    <div class="flex-1 overflow-y-auto px-3 py-2.5 sm:px-5" @scroll.passive="onScroll">
      <template v-if="!refetching">
        <ListView
          v-if="rows.length"
          class="flex-1"
          :columns="LIST_COLUMNS"
          :rows="rows"
          :options="listOptions"
          row-key="id"
        >
          <ListHeader />
          <ListRows>
            <ListRow
              v-for="row in rows"
              :key="row.id"
              v-slot="{ column, item }"
              :row="row"
              class="hover:!bg-surface-gray-1"
            >
              <ListRowItem :item="item">
                <span v-if="column.key === 'recipients'" class="truncate">
                  {{ recipientLabel(row) }}
                </span>
                <span
                  v-else-if="column.key === 'subject'"
                  class="truncate"
                  :class="{ 'text-ink-gray-5 italic': row.email_deleted }"
                >
                  {{ subjectLabel(row) }}
                </span>
                <span v-else-if="column.key === 'send_at'" class="truncate">
                  {{ formatDateTime(row.send_at) }}
                  <span class="text-ink-gray-5">({{ fromNow(row.send_at) }})</span>
                </span>
                <div
                  v-else-if="column.key === 'status'"
                  class="flex w-full items-center justify-between gap-2"
                >
                  <!-- Show failure details when hovering the status badge. -->
                  <Tooltip :text="deliveryErrorTitle(row)" :disabled="!deliveryErrorTitle(row)">
                    <Badge
                      :label="undoStatusLabel(row.undo_status)"
                      :theme="undoStatusTheme(row.undo_status)"
                    />
                  </Tooltip>
                  <div class="flex items-center">
                    <Button
                      v-if="!row.email_deleted && row.thread_id"
                      variant="ghost"
                      :tooltip="__('Open email')"
                      @click.stop.prevent="openEmail(row)"
                    >
                      <template #icon>
                        <Mail class="text-ink-gray-5 h-4 w-4" />
                      </template>
                    </Button>
                    <AdaptiveDropdown :options="rowOptions(row)" align="end">
                      <Button variant="ghost" @click.stop.prevent>
                        <template #icon>
                          <EllipsisVertical class="text-ink-gray-5 h-4 w-4" />
                        </template>
                      </Button>
                    </AdaptiveDropdown>
                  </div>
                </div>
              </ListRowItem>
            </ListRow>
          </ListRows>
        </ListView>
        <!-- Outside the ListView: its horizontally scrolling body would center this
				within the full (off-screen) table width on narrow viewports. -->
        <div v-else class="flex h-full flex-col items-center justify-center px-4 text-center">
          <div class="text-2xl-medium text-ink-gray-8">{{ emptyState.title }}</div>
          <div class="text-ink-gray-5 mt-1 text-base">{{ emptyState.description }}</div>
        </div>
        <div v-if="loadingMore" class="flex justify-center py-3">
          <LoadingIndicator class="text-ink-gray-5 h-4 w-4" />
        </div>
      </template>
      <DashboardListSkeleton v-else :columns="4" />
    </div>

    <ScheduleSendModal
      v-model="showReschedule"
      :title="__('Reschedule delivery')"
      :initial-value="selected?.send_at"
      :save="(sendAt: string) => rescheduleMailSubmit({ send_at: sendAt })"
    />
    <Dialog v-model:open="showSendNow" v-bind="sendNowOptions" />
    <Dialog v-model:open="showRetry" v-bind="retryOptions" />
    <Dialog v-model:open="showCancel" v-bind="cancelOptions" />
  </div>
</template>

<script setup lang="ts">
import { refDebounced, useDebounceFn } from '@vueuse/core'
import {
  Badge,
  Breadcrumbs,
  Button,
  Dialog,
  LoadingIndicator,
  Tooltip,
  usePageMeta,
} from 'frappe-ui'
import { ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'
import { EllipsisVertical, Mail } from 'lucide-vue-next'
import { computed, inject, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { api, useInfiniteQuery, useMutation, type InputOf } from '@/api'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import ScheduleSendModal from '@/apps/mail/components/Modals/ScheduleSendModal.vue'
import OutboxFilters from '@/apps/mail/components/OutboxFilters.vue'
import { userStore } from '@/apps/mail/stores/user'
import { raiseError, raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { formatDateTime, fromNow, utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'
import {
  activeSubmissionFilterCount,
  deliveryErrorTitle,
  emptySubmissionFilters,
  subjectLabel,
  submissionActions,
  submissionRow,
  undoStatusLabel,
  undoStatusTheme,
  type Submission,
  type SubmissionFilters,
} from '@/apps/mail/utils/submission'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import DashboardListSkeleton from '@/components/dashboard/DashboardListSkeleton.vue'
import { appPageMeta } from '@/utils/documentTitle'

usePageMeta(() => appPageMeta(__('Outbox'), 'Mail'))
const store = userStore()
const router = useRouter()
const socket = inject('$socket') as {
  on: (event: string, handler: () => void) => void
  off: (event: string, handler: () => void) => void
}
const { isMobile } = useScreenSize()
const selected = ref<Submission | null>(null)
const showReschedule = ref(false)
const showSendNow = ref(false)
const showRetry = ref(false)
const showCancel = ref(false)
const filters = reactive(emptySubmissionFilters())
// The status tabs always narrow the list; only the optional filters make an empty result
// mean "no matches" rather than "nothing with this status".
const hasActiveFilters = computed(() => activeSubmissionFilterCount(filters) > 0)
const input = refDebounced(
  computed(() => ({
    account: store.accountId,
    undo_status: filters.undoStatus,
    identity_id: filters.identityId || undefined,
    email_id: filters.emailId.trim() || undefined,
    thread_id: filters.threadId.trim() || undefined,
    after: filters.after ? utcDayStart(filters.after) : undefined,
    before: filters.before ? utcDayEnd(filters.before) : undefined,
    start: 0,
    page_length: 50,
  })),
  300,
)
const submissions = useInfiniteQuery(api.mail.scheduled.list, input)
const rows = computed(() => submissions.rows.map(submissionRow))
computed(() => submissions.total ?? 0)
const loadingMore = computed(() => submissions.isFetchingNext)
const refetching = computed(() => submissions.status === 'pending')
computed(() => submissions.hasNext)
const refresh = () => submissions.refetch().catch(() => {})
const onScroll = useDebounceFn((event: Event) => {
  const target = event.target
  if (
    target instanceof HTMLElement &&
    target.scrollTop + target.clientHeight >= target.scrollHeight - 100
  )
    void submissions.fetchNext().catch(() => {})
}, 200)

// Kept current the way mailboxes are — a periodic poll (holds release, retries advance, and
// other clients schedule/cancel without any local signal) plus the new-mail socket (an undo
// or schedule cancel publishes it).
const reloadInterval = ref<ReturnType<typeof setInterval>>()
const onNewMail = () => refresh()
onMounted(() => {
  reloadInterval.value = setInterval(onNewMail, 30000)
  socket.on('new_mail_created', onNewMail)
})
onUnmounted(() => {
  if (reloadInterval.value) clearInterval(reloadInterval.value)
  socket.off('new_mail_created', onNewMail)
})
const recipientLabel = (row: Submission) => {
  const emails = [
    ...row.recipients.filter((r) => r.type === 'To'),
    ...row.recipients.filter((r) => r.type !== 'To'),
  ].map((r) => r.display_name || r.email)
  if (!emails.length) return '—'
  const [first, ...rest] = emails
  return rest.length ? `${first} +${rest.length}` : first
}
const LIST_COLUMNS = [
  {
    label: __('To'),
    key: 'recipients',
  },
  {
    label: __('Subject'),
    key: 'subject',
  },
  {
    label: __('Send at'),
    key: 'send_at',
  },
  {
    label: __('Status'),
    key: 'status',
  },
]

// What an empty result means depends on the status tab being viewed.
const EMPTY_STATES: Record<
  SubmissionFilters['undoStatus'],
  {
    title: string
    description: string
  }
> = {
  pending: {
    title: __('No pending submissions'),
    description: __('Scheduled emails and deliveries still in flight will wait here.'),
  },
  final: {
    title: __('No final submissions'),
    description: __('Concluded deliveries — delivered, sent, or failed — will appear here.'),
  },
  canceled: {
    title: __('No cancelled submissions'),
    description: __('Deliveries you cancel will appear here.'),
  },
}
const listOptions = {
  showTooltip: false,
  selectable: false,
  rowHeight: 50,
  // The row opens the submission's details page; the message itself is behind the
  // explicit Open-email button instead.
  getRowRoute: (row: Submission) => ({
    name: 'mail-submission',
    params: {
      accountId: store.accountId,
      submissionId: row.id,
    },
  }),
}
const emptyState = computed(() =>
  hasActiveFilters.value
    ? {
        title: __('No matching submissions'),
        description: __('Try adjusting the filters.'),
      }
    : EMPTY_STATES[filters.undoStatus],
)

// A held message sits in Sent until delivery, so its thread opens there.
const openEmail = (row: Submission) => {
  if (!row.thread_id || !store.mailboxIds.sent) return
  router.push({
    name: 'mail-mail',
    params: {
      accountId: store.accountId,
      mailbox: store.mailboxIds.sent,
      threadID: row.thread_id,
    },
  })
}
const rowOptions = (row: Submission) => {
  // Every handler targets this row: `selected` must be set before dialogs read it
  // and before the resources build their params.
  const act = (fn: () => void) => () => {
    selected.value = row
    fn()
  }

  // No openEmail here — the list row keeps its explicit Open-email button.
  return submissionActions(row, {
    sendNow: act(() => (showSendNow.value = true)),
    reschedule: act(() => (showReschedule.value = true)),
    cancelDelivery: act(() => (showCancel.value = true)),
    sendAgain: act(() => (showRetry.value = true)),
    remove: act(() => dismissMailSubmit()),
  })
}
const openDrafts = () => {
  if (!store.mailboxIds.drafts) return
  router.push({
    name: 'mail-mailbox',
    params: {
      accountId: store.accountId,
      mailbox: store.mailboxIds.drafts,
    },
  })
}
const onActionError = (error: unknown) => {
  showSendNow.value = false
  showRetry.value = false
  showCancel.value = false
  raiseError(error)
  // The action may have failed because the email already went out; reflect the
  // reconciled state either way.
  refresh()
}
const rescheduleMail = useMutation(api.mail.scheduled.reschedule, {
  silent: true,
})
async function rescheduleMailSubmit({ send_at }: { send_at: string }) {
  if (!selected.value) return
  const input: InputOf<typeof api.mail.scheduled.reschedule> = {
    account: store.accountId,
    id: selected.value!.id,
    send_at,
  }
  const result = await rescheduleMail.run(input)
  const data = result
  refresh()
  raiseToast(__('Delivery rescheduled to {0}.', [formatDateTime(data.send_at)]))
}
const sendNow = useMutation(api.mail.scheduled.sendNow, {
  silent: true,
})
async function sendNowSubmit() {
  if (!selected.value) return
  const input: InputOf<typeof api.mail.scheduled.sendNow> = {
    account: store.accountId,
    id: selected.value!.id,
  }
  try {
    await sendNow.run(input)
    showSendNow.value = false
    refresh()
    raiseToast(__('Message sent.'))
  } catch (error) {
    onActionError(error)
  }
}
const retryMail = useMutation(api.mail.scheduled.retry, {
  silent: true,
})
async function retryMailSubmit() {
  if (!selected.value) return
  const input: InputOf<typeof api.mail.scheduled.retry> = {
    account: store.accountId,
    id: selected.value!.id,
  }
  try {
    await retryMail.run(input)
    showRetry.value = false
    refresh()
    raiseToast(__('Message sent.'))
  } catch (error) {
    onActionError(error)
  }
}
const dismissMail = useMutation(api.mail.scheduled.dismiss, {
  silent: true,
})
async function dismissMailSubmit() {
  if (!selected.value) return
  const input: InputOf<typeof api.mail.scheduled.dismiss> = {
    account: store.accountId,
    id: selected.value!.id,
  }
  try {
    await dismissMail.run(input)
    await refresh()
  } catch (error) {
    onActionError(error)
  }
}
const cancelSchedule = useMutation(api.mail.scheduled.cancel, {
  silent: true,
})
async function cancelScheduleSubmit() {
  if (!selected.value) return
  const input: InputOf<typeof api.mail.scheduled.cancel> = {
    account: store.accountId,
    id: selected.value!.id,
  }
  try {
    const result = await cancelSchedule.run(input)
    const data = result
    showCancel.value = false
    refresh()
    // No message was moved when the email had been deleted — don't point at Drafts.
    if (!data.id) raiseToast(__('Delivery cancelled.'), 'success')
    raiseToast(
      __('Delivery cancelled. The message is back in your drafts.'),
      'success',
      store.mailboxIds.drafts
        ? {
            label: __('Open Drafts'),
            onClick: openDrafts,
          }
        : undefined,
    )
  } catch (error) {
    onActionError(error)
  }
}
const sendNowOptions = computed(() => ({
  title: __('Send Now'),
  message: __('Deliver this email immediately instead of at the scheduled time?'),
  actions: [
    {
      label: __('Send'),
      variant: 'solid' as const,
      loading: sendNow.isPending,
      onClick: sendNowSubmit,
    },
  ],
}))
const retryOptions = computed(() => ({
  title: __('Send Again'),
  message:
    selected.value?.status === 'failed'
      ? __('The delivery failed. Try to send this email again now?')
      : __('Send this email again now?'),
  actions: [
    {
      label: __('Send'),
      variant: 'solid' as const,
      loading: retryMail.isPending,
      onClick: retryMailSubmit,
    },
  ],
}))
const cancelOptions = computed(() => ({
  title: __('Cancel Delivery'),
  message: selected.value?.email_deleted
    ? __('Cancel the scheduled delivery?')
    : __('Cancel the scheduled delivery and move the message back to Drafts?'),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      theme: 'red' as const,
      loading: cancelSchedule.isPending,
      onClick: cancelScheduleSubmit,
    },
  ],
}))
</script>
