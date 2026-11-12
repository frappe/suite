<template>
  <!-- An action of the list below, as a button; and the time menus, which a phone opens from its More
       sheet instead. Defined once, for each place they stand. -->
  <DefineAction v-slot="{ action }">
    <Button
      variant="ghost"
      class="max-sm:!h-8 max-sm:!w-8"
      :tooltip="action.label"
      @click="action.onClick"
    >
      <template #icon>
        <component :is="action.icon" class="icon max-sm:!h-[18px] max-sm:!w-[18px]" />
      </template>
    </Button>
  </DefineAction>
  <DefineLater>
    <ReminderMenu
      v-if="remindOnly"
      v-model:open="laterOpen"
      @pick="(at: string) => emit('remind', at)"
    >
      <template v-if="!isMobile" #default>
        <Button variant="ghost" :tooltip="laterLabel" :aria-label="laterLabel">
          <template #icon>
            <BellPlus class="icon" />
          </template>
        </Button>
      </template>
    </ReminderMenu>
    <SnoozeMenu
      v-else-if="snoozable || inSnoozed"
      v-model:open="laterOpen"
      :changing="inSnoozed"
      @pick="(until: string) => emit('snooze', until)"
    >
      <template v-if="!isMobile" #default>
        <Button variant="ghost" :tooltip="laterLabel">
          <template #icon>
            <Clock class="icon" />
          </template>
        </Button>
      </template>
    </SnoozeMenu>
    <Button
      v-if="inSnoozed && !isMobile"
      variant="ghost"
      :tooltip="__('Unsnooze')"
      @click="emit('unsnooze')"
    >
      <template #icon>
        <AlarmClockOff class="icon" />
      </template>
    </Button>
  </DefineLater>
  <!-- px-3.5 matches the body/subject axis; the max-sm negative margins cancel the
	     ghost buttons' own padding so the edge glyphs land on that axis too. -->
  <div
    class="bg-surface-base sticky top-0 flex items-center px-3.5 py-2.5 max-sm:min-h-14 max-sm:py-0 sm:border-b"
  >
    <Button
      variant="ghost"
      class="mr-2 shrink-0 max-sm:-ml-2 max-sm:!h-8 max-sm:!w-8"
      @click="$router.push(backRoute)"
    >
      <template #icon>
        <ChevronLeft class="icon max-sm:!h-[18px] max-sm:!w-[18px]" />
      </template>
    </Button>
    <!-- Only actions up here, on a phone as on a desktop: the subject heads the thread below,
	     where it can wrap. -->
    <template v-if="thread?.length">
      <div class="flex min-w-0 flex-1 items-center gap-4 max-sm:gap-3">
        <!-- Three groups, apart a step more than their buttons, with a line halfway: what is done to
             it, read or taken away; where it is filed; what holds it for later, the order of a row's
             hover actions. A group with nothing to offer here takes no room, and no line stands at
             either end. -->
        <div class="flex min-w-0 items-center gap-2 max-sm:gap-1.5">
          <div v-if="visibleActions.length" class="flex items-center space-x-2">
            <ReuseAction v-for="action in visibleActions" :key="action.label" :action />
          </div>
          <Divider v-if="visibleActions.length && !inDrafts" v-bind="GROUP_LINE" />
          <div v-if="!inDrafts" class="flex items-center space-x-2">
            <AdaptiveDropdown :options="moveToOptions" :title="__('Move To')">
              <Button variant="ghost" class="max-sm:!h-8 max-sm:!w-8" :tooltip="__('Move To')">
                <template #icon>
                  <FolderInput class="icon max-sm:!h-[18px] max-sm:!w-[18px]" />
                </template>
              </Button>
            </AdaptiveDropdown>
            <!-- Where the thread is filed, as ticks: one box per folder it can be in, so the same
                 menu says where it is and changes it. Stays open, to file it in several at once. -->
            <AdaptiveDropdown
              v-if="folderOptions.length"
              :options="folderOptions"
              :title="__('Folders')"
            >
              <Button variant="ghost" class="max-sm:!h-8 max-sm:!w-8" :tooltip="__('Folders')">
                <template #icon>
                  <Folders class="icon max-sm:!h-[18px] max-sm:!w-[18px]" />
                </template>
              </Button>
            </AdaptiveDropdown>
          </div>
          <Divider
            v-if="(visibleActions.length || !inDrafts) && hasLaterGroup"
            v-bind="GROUP_LINE"
          />
          <div v-if="hasLaterGroup" class="flex items-center space-x-2">
            <ReuseLater />
            <Button
              v-if="pinnable"
              variant="ghost"
              :tooltip="pinned ? __('Unpin') : __('Pin to Top')"
              @click="emit('setPinned', !pinned, pinFolder)"
            >
              <!-- Pinned, the filled blue pin a pinned row shows, hovered or not. -->
              <template #icon>
                <Pin v-if="pinned" class="icon" :style="PINNED_PIN_STYLE" />
                <Pin v-else class="icon" />
              </template>
            </Button>
          </div>
          <!-- On a phone they open from the More sheet, with no button of their own, so out of the
               row's flow. -->
          <div v-if="isMobile" class="absolute">
            <ReuseLater />
          </div>
        </div>
        <!-- A phone's toolbar is full: what is left goes in a sheet. -->
        <AdaptiveDropdown
          v-if="isMobile && laterOptions.length"
          :options="laterOptions"
          :title="__('More')"
        >
          <Button variant="ghost" class="max-sm:!h-8 max-sm:!w-8" :aria-label="__('More')">
            <template #icon>
              <Ellipsis class="icon max-sm:!h-[18px] max-sm:!w-[18px]" />
            </template>
          </Button>
        </AdaptiveDropdown>
        <!-- Prev/next thread arrows are a desktop affordance (↑/K, ↓/J). -->
        <div v-if="threads.includes(threadID) && !isMobile" class="!ml-auto flex space-x-2">
          <Button
            variant="ghost"
            :tooltip="__('Previous Thread (↑/K)')"
            :disabled="threadID === threads[0]"
            @click="emit('prevThread')"
          >
            <template #icon>
              <ArrowLeft class="icon" />
            </template>
          </Button>

          <Button
            variant="ghost"
            :tooltip="__('Next Thread (↓/J)')"
            :disabled="threadID === threads.at(-1) && !canGoNext"
            @click="emit('nextThread')"
          >
            <template #icon>
              <ArrowRight class="icon" />
            </template>
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { createReusableTemplate } from '@vueuse/core'
import { Button, Checkbox, Divider } from 'frappe-ui'
import { Icon } from 'frappe-ui/experimental'
import {
  AlarmClockOff,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  BellPlus,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Clock,
  Ellipsis,
  FolderInput,
  Folders,
  Mail as MailIcon,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-vue-next'
import { computed, h, ref, type Component } from 'vue'
import { useRoute } from 'vue-router'

import ReminderMenu from '@/apps/mail/components/ReminderMenu.vue'
import SnoozeMenu from '@/apps/mail/components/SnoozeMenu.vue'
import { FOLDER_ICON_COLOR_MAP, PINNED_PIN_STYLE } from '@/apps/mail/constants'
import { takesPins } from '@/apps/mail/stores/user'
import type { Mail, MailboxData } from '@/apps/mail/types'
import { getIcon, getMailboxName } from '@/apps/mail/utils'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { folderTicks } from '@/apps/mail/utils/folderTicks'
import { canMoveToMailbox, commonMailboxIds } from '@/apps/mail/utils/mailboxTargets'
import { archivable, holdsReceivedMail, unarchivable } from '@/apps/mail/utils/receivedMail'
import { GROUP_LINE } from '@/apps/mail/utils/toolbarGroups'
import {
  INBOX_FOLDER,
  mailboxForUnifiedFolder,
  mailboxIdForParam,
  UNIFIED_ROUTE,
  UNIFIED_THREAD_ROUTE,
} from '@/apps/mail/utils/unifiedFolders'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'

const { thread, threads, canGoNext, remindable } = defineProps<{
  thread: Mail[]
  threads: string[]
  canGoNext?: boolean
  // The last word is yours and nothing is set to chase it (see useReplyReminder).
  remindable?: boolean
}>()
const emit = defineEmits([
  'setSeen',
  'setPinned',
  'snooze',
  'unsnooze',
  'remind',
  'archiveThread',
  'unarchiveThread',
  'moveThread',
  'addThreadToMailbox',
  'removeThreadFromMailbox',
  'setSpamStatus',
  'deleteThread',
  'prevThread',
  'nextThread',
])

const { isMobile } = useScreenSize()
const route = useRoute()
// Folder menus come from the pane's account scope — the thread's owning account
// when All Inboxes opened it, the active account otherwise.
const { mailboxes, mailboxIds } = injectAccountScope()

// The mailbox the thread was opened from, as an id. The URL names it by slug: the merged folder's
// slug on its thread route, which in the thread's own account is that folder, and the account
// folder's own param otherwise (see utils/unifiedFolders).
const mailbox = computed(() =>
  route.name === UNIFIED_THREAD_ROUTE
    ? (mailboxForUnifiedFolder(route.params.folder, mailboxes.value.data ?? []) ?? '')
    : mailboxIdForParam(route.params.mailbox, mailboxes.value.data ?? []),
)
const threadID = computed(() =>
  Array.isArray(route.params.threadID) ? (route.params.threadID[0] ?? '') : route.params.threadID,
)

// Back returns to the list the thread was opened from: the merged folder
// list on its thread route, the mailbox list otherwise.
const backRoute = computed(() =>
  route.name === UNIFIED_THREAD_ROUTE
    ? { name: UNIFIED_ROUTE, params: { folder: route.params.folder }, query: route.query }
    : { name: 'mail-mailbox', params: { mailbox: route.params.mailbox }, query: route.query },
)

// The mailboxes the whole thread sits in — the same intersection the list takes across a selection,
// here across the thread's mails (a mail still being sent has no id yet and doesn't count).
const threadMailboxes = computed(() =>
  commonMailboxIds((thread ?? []).filter((mail: Mail) => mail.id)),
)

// Drafts offers only Discard: a draft isn't archived, junked, filed, starred or read. And Archive and
// Junk act only on mail you received, so a conversation of nothing but your own has neither.
const inDrafts = computed(() => mailbox.value === mailboxIds.value.drafts)
const holdsReceived = computed(() =>
  holdsReceivedMail(
    (thread ?? []).filter((mail: Mail) => mail.id),
    mailboxIds.value.sent,
  ),
)

// A pin is the folder's the thread was opened from, where it takes pins, on the mail the conversation
// holds there (see suite/mail/pins.py). Of the merged folders only the Inbox holds pins.
const pinFolder = computed(() =>
  (route.name !== UNIFIED_THREAD_ROUTE || route.params.folder === INBOX_FOLDER) &&
  takesPins(mailboxes.value.data?.find((box: MailboxData) => box.id === mailbox.value))
    ? mailbox.value
    : '',
)
const inFolder = computed(() =>
  (thread ?? []).filter(
    (mail: Mail) =>
      mail.id && !mail.draft && mail.mailboxes.some((box) => box.mailbox_id === pinFolder.value),
  ),
)
const pinnable = computed(() => !!pinFolder.value && inFolder.value.length > 0)
const pinned = computed(() =>
  inFolder.value.some((mail: Mail) => mail.pinned_in?.includes(pinFolder.value)),
)

// What can be held for later goes by the folder it is viewed from: in Sent, your own mail, only a
// reminder if nobody has replied; anywhere else, only a snooze. Snoozing takes what it finds in the
// Inbox or Archive (see suite/mail/filing.py).
const viewingSent = computed(() => mailbox.value === mailboxIds.value.sent)
const received = computed(() => (thread ?? []).filter((mail: Mail) => mail.id && !mail.draft))
const isIn = (mail: Mail, box: string) => mail.mailboxes.some((m) => m.mailbox_id === box)
const inSnoozed = computed(
  () =>
    !viewingSent.value && received.value.some((mail: Mail) => isIn(mail, mailboxIds.value.snoozed)),
)
const snoozable = computed(
  () =>
    !viewingSent.value &&
    !inSnoozed.value &&
    received.value.some(
      (mail: Mail) => isIn(mail, mailboxIds.value.inbox) || isIn(mail, mailboxIds.value.archive),
    ),
)

const remindOnly = computed(() => viewingSent.value && !!remindable)

const laterOpen = ref(false)
const laterLabel = computed(() => {
  if (inSnoozed.value) return __('Change snooze time')
  return remindOnly.value ? __('Remind me if no reply') : __('Snooze')
})

const laterOptions = computed(() => [
  ...(snoozable.value || inSnoozed.value || remindOnly.value
    ? [
        {
          label: laterLabel.value,
          icon: remindOnly.value ? BellPlus : Clock,
          onClick: () => (laterOpen.value = true),
        },
      ]
    : []),
  ...(inSnoozed.value
    ? [{ label: __('Unsnooze'), icon: AlarmClockOff, onClick: () => emit('unsnooze') }]
    : []),
  ...(pinnable.value
    ? [
        {
          label: pinned.value ? __('Unpin') : __('Pin to Top'),
          icon: pinned.value ? PinOff : Pin,
          onClick: () => emit('setPinned', !pinned.value, pinFolder.value),
        },
      ]
    : []),
])

const moreActions = computed((): Action[] => [
  {
    label: __('Mark as Unread (U)'),
    onClick: () => emit('setSeen', false),
    icon: MailIcon,
    condition: () => !inDrafts.value,
  },
  {
    label: __('Archive (E)'),
    onClick: () => emit('archiveThread'),
    icon: Archive,
    condition: () =>
      !inDrafts.value &&
      archivable(
        (thread ?? []).filter((mail: Mail) => mail.id),
        mailboxIds.value,
      ),
  },
  // Archive reversed, in Archive's place once the received mail is archived.
  {
    label: __('Unarchive'),
    onClick: () => emit('unarchiveThread'),
    icon: ArchiveRestore,
    condition: () =>
      !inDrafts.value &&
      unarchivable(
        (thread ?? []).filter((mail: Mail) => mail.id),
        mailboxIds.value,
      ),
  },
  {
    label: __('Mark as Junk (!)'),
    onClick: () => emit('setSpamStatus', true),
    icon: CircleAlert,
    condition: () =>
      !inDrafts.value &&
      holdsReceived.value &&
      !threadMailboxes.value.some((m: string) =>
        [mailboxIds.value.junk, mailboxIds.value.drafts].includes(m),
      ),
  },
  {
    label: __('Mark as Not Junk'),
    onClick: () => emit('setSpamStatus', false),
    icon: CircleCheck,
    condition: () => threadMailboxes.value.includes(mailboxIds.value.junk),
  },
  {
    label: __('Move to Trash (Delete)'),
    onClick: () => emit('moveThread', mailboxIds.value.trash),
    icon: Trash2,
    condition: () =>
      mailbox.value !== mailboxIds.value.drafts &&
      !threadMailboxes.value.includes(mailboxIds.value.trash),
  },
  // Read from Drafts, a draft is discarded for good, as the list and the composer do.
  {
    label: __('Discard (Delete)'),
    onClick: () => emit('deleteThread'),
    icon: Trash2,
    condition: () => mailbox.value === mailboxIds.value.drafts,
  },
  {
    label: __('Delete Thread (Shift+Delete)'),
    onClick: () => emit('deleteThread'),
    icon: Trash2,
    condition: () => threadMailboxes.value.includes(mailboxIds.value.trash),
  },
])

const visibleActions = computed(() => moreActions.value.filter((action) => action.condition()))
// A desktop's alone: a phone offers these from its More sheet.
const hasLaterGroup = computed(
  () =>
    !isMobile.value && (pinnable.value || snoozable.value || inSnoozed.value || remindOnly.value),
)

const [DefineAction, ReuseAction] = createReusableTemplate<{ action: Action }>()
const [DefineLater, ReuseLater] = createReusableTemplate()

const showFiling = computed(() =>
  threadMailboxes.value.every((m) => ![mailboxIds.value.junk, mailboxIds.value.trash].includes(m)),
)

// The folders a thread can be filed in by hand: the Inbox, Archive and your own. Sent and Drafts
// are filed by sending and writing, Junk and Trash by what is done with the mail, so they are not
// ticked here. None at all while the thread is in Junk or Trash: it comes out of those by a move.
// Default to [] rather than undefined: in All Inboxes the pane's mailbox resource belongs to the
// row's account and is still loading on first paint, and AdaptiveDropdown requires an array.
const fileableFolders = computed(() =>
  showFiling.value
    ? (mailboxes.value.data ?? []).filter((m) => !m.role || ['inbox', 'archive'].includes(m.role))
    : [],
)

const folderOptions = computed(() => {
  const mails = (thread ?? []).filter((mail: Mail) => mail.id)
  const ticks = folderTicks(
    [mails],
    fileableFolders.value.map((m) => m.id),
  )
  return fileableFolders.value.map((mailbox, i) => {
    const { ticked, removable } = ticks[i]
    const blocked = ticked === 'all' && !removable
    return {
      label: getMailboxName(mailbox),
      slots: {
        prefix: () =>
          h(Checkbox, {
            modelValue: ticked === 'all',
            indeterminate: ticked === 'some',
            disabled: blocked,
            class: 'pointer-events-none',
          }),
      },
      // Unticking the folder some message's only one would leave it nowhere: it stays, greyed.
      disabled: blocked,
      keepOpen: true,
      onClick: (event?: Event) => {
        event?.preventDefault()
        if (blocked) return
        // A half-ticked folder takes the whole thread; a ticked one lets it go.
        if (ticked === 'all') emit('removeThreadFromMailbox', mailbox.id)
        else emit('addThreadToMailbox', mailbox.id)
      },
    }
  })
})

const moveToOptions = computed(() =>
  (mailboxes.value.data ?? [])
    .filter((m) => canMoveToMailbox(m.id, threadMailboxes.value, mailboxIds.value))
    .map((m) => getMailboxOption(m, 'moveThread')),
)

const getMailboxOption = (mailbox: MailboxData, emitName: 'moveThread') => ({
  label: getMailboxName(mailbox),
  icon: h(Icon, { name: getIcon(mailbox), class: FOLDER_ICON_COLOR_MAP[mailbox.color!] }),
  onClick: () => emit(emitName, mailbox.id),
})

interface Action {
  label: string
  onClick: () => void
  icon: typeof ArrowLeft | Component
  condition: () => boolean
}
</script>
