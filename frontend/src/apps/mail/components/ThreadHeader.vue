<template>
  <!-- px-3.5 matches the body/subject axis; the max-sm negative margins cancel the
	     ghost buttons' own padding so the edge glyphs land on that axis too. -->
  <div
    class="bg-surface-base border-b sticky top-0 flex items-center px-3.5 py-2.5 max-sm:min-h-14 max-sm:py-0"
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
      <div class="flex min-w-0 flex-1 items-center space-x-2">
        <!-- The everyday actions lead, on a phone as on a desktop; the star sits beside the
             subject, in the thread (MailThread). -->
        <Button
          v-for="action in visibleActions"
          :key="action.label"
          variant="ghost"
          class="max-sm:!h-8 max-sm:!w-8"
          :tooltip="action.label"
          @click="action.onClick"
        >
          <template #icon>
            <component :is="action.icon" class="icon max-sm:!h-[18px] max-sm:!w-[18px]" />
          </template>
        </Button>
        <AdaptiveDropdown v-if="!inDrafts" :options="moveToOptions" :title="__('Move To')">
          <Button variant="ghost" class="max-sm:!h-8 max-sm:!w-8" :tooltip="__('Move To')">
            <template #icon>
              <FolderInput class="icon max-sm:!h-[18px] max-sm:!w-[18px]" />
            </template>
          </Button>
        </AdaptiveDropdown>
        <!-- Where the thread is filed, as ticks: one box per folder it can be in, so the same
             menu says where it is and changes it. Stays open, to file it in several at once. -->
        <AdaptiveDropdown
          v-if="!inDrafts && folderOptions.length"
          :options="folderOptions"
          :title="__('Folders')"
        >
          <Button variant="ghost" class="max-sm:!h-8 max-sm:!w-8" :tooltip="__('Folders')">
            <template #icon>
              <Folders class="icon max-sm:!h-[18px] max-sm:!w-[18px]" />
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
import { Button, Checkbox } from 'frappe-ui'
import { Icon } from 'frappe-ui/experimental'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  FolderInput,
  Folders,
  Mail as MailIcon,
  Trash2,
} from 'lucide-vue-next'
import { computed, h, type Component } from 'vue'
import { useRoute } from 'vue-router'

import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import type { Mail, MailboxData } from '@/apps/mail/types'
import { getIcon, getMailboxName } from '@/apps/mail/utils'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { folderTicks } from '@/apps/mail/utils/folderTicks'
import { canMoveToMailbox, commonMailboxIds } from '@/apps/mail/utils/mailboxTargets'
import { archivable, holdsReceivedMail, unarchivable } from '@/apps/mail/utils/receivedMail'
import {
  mailboxForUnifiedFolder,
  mailboxIdForParam,
  UNIFIED_ROUTE,
  UNIFIED_THREAD_ROUTE,
} from '@/apps/mail/utils/unifiedFolders'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'

const { thread, threads, canGoNext } = defineProps<{
  thread: Mail[]
  threads: string[]
  canGoNext?: boolean
}>()
const emit = defineEmits([
  'setSeen',
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
    ? (mailboxForUnifiedFolder(route.params.folder, mailboxes.value.data as MailboxData[]) ?? '')
    : mailboxIdForParam(route.params.mailbox, mailboxes.value.data as MailboxData[]),
)
const threadID = computed(() => route.params.threadID as string)

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

const moreActions = computed((): Action[] => [
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
  {
    label: __('Mark as Unread (U)'),
    onClick: () => emit('setSeen', false),
    icon: MailIcon,
    condition: () => !inDrafts.value,
  },
])

const visibleActions = computed(() => moreActions.value.filter((action) => action.condition()))

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
