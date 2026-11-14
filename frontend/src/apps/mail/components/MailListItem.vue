<template>
  <MailRow
    :to
    :is-selected
    :selectable
    :selection-mode
    :hide-avatar
    :unread="!mail.seen"
    :hide-sender
    :avatar-label="avatarLabel"
    :avatar-image="mail.user_image"
    :datetime="mail.received_at"
    :subject-italic="!mail.subject"
    :preview-italic="!preview"
    :account-label="accountLabel"
    :draggable
    :has-extra="hasExtra(true)"
    @set-selected="(selected: boolean) => emit('setSelected', selected)"
    @drag-start="(e: DragEvent) => emit('dragStart', e)"
    @drag-end="emit('dragEnd')"
  >
    <template #sender><HighlightedText :text="header" :term="searchTerm" /></template>

    <template #badges="{ isHovered }">
      <!-- How many messages the thread holds — only worth saying once it holds more than one. -->
      <span
        v-if="messageCount > 1"
        class="text-ink-gray-5 shrink-0 text-xs"
        :aria-label="__('{0} messages', [messageCount])"
      >
        {{ messageCount }}
      </span>
      <!-- The banner's icon, so an unknown sender reads the same in the row and in the thread. The
		       trigger is kept out of the focus order and drawn without an outline: a focusable one put a
		       focus ring on the row. After the message count. -->
      <Tooltip v-if="screened" :text="unknownSendersLabel">
        <span class="flex shrink-0 outline-none" tabindex="-1">
          <UserRoundSearch class="text-ink-gray-5 size-3.5" :aria-label="unknownSendersLabel" />
        </span>
      </Tooltip>
      <Badge v-if="mail.draft || liveDraft" size="sm" :label="__('Draft')" theme="red" />
      <Badge
        v-if="mail.snoozed_until"
        size="sm"
        theme="gray"
        :label="formatDateTime(mail.snoozed_until, 'ddd, MMM D, h:mm A')"
      />
      <!-- Back, and held near the top until the reader removes it: the word why, and the × that
           takes it off. Gone at rest so it holds no width, only the sender giving way; a screen
           with no hover keeps it. In the label because Badge's suffix box keeps its width when
           empty. The before: box is the tap target, so a tap doesn't land on the row: the button is
           left unpositioned so the sender's line can't clip it, and its flex centres it. -->
      <Badge v-if="mail.returned" size="sm" theme="amber">
        {{ returnedLabel }}
        <Tooltip :text="__('Remove from Reminders')">
          <button
            type="button"
            class="flex shrink-0 cursor-pointer items-center justify-center before:absolute before:size-8"
            :class="{ 'hidden [@media(hover:none)]:flex': !isHovered }"
            :aria-label="__('Remove from Reminders')"
            @click.stop.prevent="clear"
          >
            <X class="size-3" />
          </button>
        </Tooltip>
      </Badge>
      <!-- Sent mail waiting on an answer: the time it comes back if none arrives. -->
      <Tooltip
        v-if="mail.remind_at"
        :text="
          __('Reminder on {0} if nobody replies', [
            formatDateTime(mail.remind_at, 'ddd, MMM D, h:mm A'),
          ])
        "
      >
        <BellRing
          class="text-ink-gray-5 size-3.5 shrink-0"
          :aria-label="
            __('Reminder on {0} if nobody replies', [
              formatDateTime(mail.remind_at, 'ddd, MMM D, h:mm A'),
            ])
          "
        />
      </Tooltip>
    </template>

    <template #subject>
      <HighlightedText :text="mail.subject || __('[No subject]')" :term="searchTerm" />
    </template>
    <template #preview>
      <HighlightedText :text="preview || __('— No message body —')" :term="searchTerm" />
    </template>

    <template #trailing="{ isHovered }">
      <MailRowActions
        :is-hovered
        :threads="[mail]"
        :drafts
        :unarchive
        :pinnable
        @set-pinned="(pinned: boolean) => emit('setPinned', pinned)"
        @set-seen="(seen: boolean) => emit('setSeen', seen)"
        @archive="emit('archiveThread')"
        @unarchive="emit('unarchiveThread')"
        @trash="emit('trashThread')"
        @delete="emit('deleteThread')"
        @set-flagged="(flagged: boolean) => emit('setFlagged', flagged)"
      />
    </template>

    <template #extra="{ isFullWidth }">
      <!-- One family of chips, an even gap apart: files outlined, folders on the muted surface. -->
      <div
        v-if="hasExtra(isFullWidth)"
        class="flex items-center gap-1.5"
        :class="{ 'min-w-fit': isFullWidth }"
      >
        <Tooltip
          v-for="(attachment, idx) in attachments.slice(0, 2)"
          :key="idx"
          :text="attachment.filename"
        >
          <AttachmentCapsule
            :file-name="attachment.filename"
            :blob-i-d="attachment.blob_id"
            :type="attachment.type"
            :account="accountId"
            compact
            :class="isFullWidth ? 'max-w-36' : 'max-w-44 sm:max-w-20'"
            @click.stop.prevent="openAttachment(idx)"
          />
        </Tooltip>
        <Popover v-if="attachments.length > 2" side="bottom">
          <template #trigger>
            <Tooltip :text="__('View remaining attachments')">
              <AttachmentCapsule :file-name="`+${String(attachments.length - 2)}`" compact />
            </Tooltip>
          </template>
          <template #default>
            <div class="max-h-80 overflow-y-auto p-1">
              <Tooltip
                v-for="(attachment, idx) in attachments.slice(2)"
                :key="idx"
                :text="attachment.filename"
              >
                <div
                  class="group/capsule hover:bg-surface-gray-1 flex max-w-60 cursor-pointer space-x-2 truncate rounded-4 px-2 py-1.5"
                  @click.stop.prevent="openAttachment(idx + 2)"
                >
                  <div class="text-ink-gray-4">
                    <Loader
                      v-if="currentlyDownloading.includes(attachment.blob_id)"
                      class="h-4 w-4 shrink-0 animate-spin"
                    />
                    <template v-else>
                      <component
                        :is="getFileIcon(attachment.type)"
                        class="h-4 w-4 shrink-0 sm:group-hover/capsule:hidden"
                      />
                      <button
                        class="hidden sm:group-hover/capsule:block"
                        @click.stop.prevent="downloadAttachment(attachment)"
                      >
                        <Download class="hover:text-ink-gray-8 h-4 w-4 shrink-0" />
                      </button>
                    </template>
                  </div>
                  <span class="truncate text-sm">{{ attachment.filename }}</span>
                </div>
              </Tooltip>
            </div>
          </template>
        </Popover>
        <template v-if="isFullWidth && mailboxesToShow.length">
          <Badge
            v-for="m in mailboxesToShow"
            :key="m.mailbox_id"
            size="lg"
            variant="subtle"
            :class="CHIP_CLASS"
            :label="m.mailbox_name"
          />
          <Badge
            v-if="moreMailboxes"
            size="lg"
            variant="subtle"
            :class="CHIP_CLASS"
            :label="`+${moreMailboxes}`"
          />
        </template>
      </div>
      <template v-if="!isFullWidth && mailboxesToShow.length">
        <Badge
          v-for="m in mailboxesToShow"
          :key="m.mailbox_id"
          size="lg"
          variant="subtle"
          :class="['mr-1.5', CHIP_CLASS]"
          :label="m.mailbox_name"
        />
        <Badge
          v-if="moreMailboxes"
          size="lg"
          variant="subtle"
          :class="['mr-1.5', CHIP_CLASS]"
          :label="`+${moreMailboxes}`"
        />
      </template>
    </template>

    <AttachmentViewer
      v-model="showAttachmentViewer"
      :attachments="mail.attachments"
      :initial-index="attachmentIndex"
      :account="accountId"
    />
  </MailRow>
</template>

<script setup lang="ts">
import { Badge, Popover, Tooltip } from 'frappe-ui'
import { BellRing, Download, Loader, UserRoundSearch, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import AttachmentCapsule from '@/apps/mail/components/AttachmentCapsule.vue'
import AttachmentViewer from '@/apps/mail/components/AttachmentViewer.vue'
import MailRow from '@/apps/mail/components/MailRow.vue'
import MailRowActions from '@/apps/mail/components/MailRowActions.vue'
import { useClearReturned } from '@/apps/mail/composables/useClearReturned'
import { useScreener } from '@/apps/mail/composables/useScreener'
import { getAttachmentUrl } from '@/apps/mail/resources'
import { userStore } from '@/apps/mail/stores/user'
import type { Attachment, Thread } from '@/apps/mail/types'
import { downloadUrlAsFile, getFileIcon, getFormattedRecipients } from '@/apps/mail/utils'
import { useOwnEmails } from '@/apps/mail/utils/composables'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import { draftInList } from '@/apps/mail/utils/draftsInList'
import { mailCopies } from '@/apps/mail/utils/mailCopies'
import {
  threadAvatarLabel,
  threadDisplayName,
  threadParticipants,
} from '@/apps/mail/utils/participants'
import { isReceived, receivedFolders, searchFolders } from '@/apps/mail/utils/receivedMail'
import { returnedReason } from '@/apps/mail/utils/snoozeTimes'
import { threadLink } from '@/apps/mail/utils/unifiedFolders'
import HighlightedText from '@/components/HighlightedText.vue'

const {
  mailbox,
  mail,
  isSelected,
  accountId,
  accountLabel,
  selectable = true,
  hideSender = false,
  drafts = false,
  unarchive = false,
  selectionMode = false,
  threadRouteName = 'mail-mail',
  hideAvatar = false,
  outgoing,
  screened = false,
  pinnable = false,
} = defineProps<{
  mailbox: string
  mail: Thread
  isSelected: boolean
  // Set by the All Inboxes view: the row's owning account (overrides the route's accountId in the
  // thread link) and a short label chip identifying which account the mail belongs to.
  accountId?: string
  accountLabel?: string
  // When false, the desktop selection checkbox is replaced by the sender avatar (the All Inboxes
  // view has no cross-account bulk selection).
  selectable?: boolean
  // Set on the members of an expanded stack, whose stack row already names the sender.
  hideSender?: boolean
  // The list is Drafts, so the row's bin discards (see MailRowActions).
  drafts?: boolean
  // The list is Archive and can take the row back to the Inbox (see MailRowActions).
  unarchive?: boolean
  // Whether the row can be dragged onto a folder; the view decides, since only it
  // knows whether a selection is riding along.
  draggable?: boolean
  // Mobile selection mode — forwarded to MailRow.
  selectionMode?: boolean
  // Which route the row links to. The unified folder view points at its own thread route so
  // opening a mail stays in the merged list instead of navigating into one account's mailbox.
  threadRouteName?: string
  // Forwarded to MailRow — see there.
  hideAvatar?: boolean
  // Set by the unified folder view, whose rows come from several accounts: the active account's
  // Sent and Drafts ids can't say whether a row from another account is outgoing, so the view —
  // which knows the folder — says it instead.
  outgoing?: boolean
  // A screened thread mixed into the inbox: an ordinary row, marked with the New sender icon.
  screened?: boolean
  // The list's folder takes pins (see MailRowActions).
  pinnable?: boolean
}>()

const emit = defineEmits([
  'setSeen',
  'archiveThread',
  'unarchiveThread',
  'trashThread',
  'deleteThread',
  'setFlagged',
  'setPinned',
  'setSelected',
  'dragStart',
  'dragEnd',
])

const route = useRoute()
const { mailboxes, mailboxIds } = userStore()
const screener = useScreener()

// One sender or several: the row says which, the open thread says who.
const unknownSendersLabel = computed(() =>
  screener.waitingSenders(mail).length > 1 ? __('Unknown senders') : __('Unknown sender'),
)
const ownEmails = useOwnEmails()

// A reply being written inline in this conversation, saved since the list last read it.
const liveDraft = computed(() => draftInList(String(accountId || route.params.accountId), mail))
const preview = computed(() => liveDraft.value?.preview ?? mail.preview)
// Why it is back near the top: your own mail nobody answered, or a snooze come due.
const returnedLabel = computed(() => returnedReason(!!mail.no_reply))
const { clearReturned } = useClearReturned()
const clear = () => clearReturned([mail], accountId || String(route.params.accountId))

// An account's thread route names its folder by slug (see utils/unifiedFolders); the merged
// folder's needs none, since its own folder param already says which one.
const to = computed(() =>
  threadLink({
    routeName: threadRouteName,
    accountId: accountId || route.params.accountId,
    mailbox,
    mailboxes: mailboxes.data,
    threadId: mail.thread_id,
    query: route.query,
  }),
)

// Where else the conversation is filed. A row stands for one of its messages, which in Sent is your
// reply — never archived or filed away — so there and in Starred it says where the mail you received
// is instead, apart from the Inbox, the usual place.
// A search has no folder of its own, so its rows say where the conversation is, the Inbox included.
const allMailboxesToShow = computed(() => {
  const messages = mail.messages?.length ? mail.messages : [mail]
  if (mailbox === 'search')
    return searchFolders(messages, {
      sent: mail.sent ?? mailboxIds.sent,
      drafts: mailboxIds.drafts,
    })
  return mailbox === mailboxIds.sent || mailbox === 'starred'
    ? receivedFolders(messages, mailboxIds, mailbox)
    : // Sent and Drafts are where your own mail lives, not where anything was filed: never a tag.
      mail.mailboxes.filter(
        (m) => ![mailbox, mailboxIds.sent, mailboxIds.drafts].includes(m.mailbox_id),
      )
})
// Two at most, the rest counted.
const mailboxesToShow = computed(() => allMailboxesToShow.value.slice(0, 2))
// Chips to show under the preview: attachments, and the folders the conversation is filed in (the
// wide layout only). Nothing else goes there, so a row without either keeps its single line.
const hasExtra = (isFullWidth: boolean) =>
  !!attachments.value.length || (isFullWidth && !!mailboxesToShow.value.length)
// Badge has no 28px size, and a folder chip matches the height of the attachment capsule beside it.
const CHIP_CLASS = '!h-7 !gap-1.5 !px-2.5'
const moreMailboxes = computed(() => allMailboxesToShow.value.length - mailboxesToShow.value.length)

const attachments = computed(
  () => mail.attachments.filter((m) => m.filename && m.disposition === 'attachment') || [],
)

// Sent and Drafts are about who the mail is going to, so those rows name the recipients. Everywhere
// else the row names the thread's participants.
//
// In a mailbox it is the VIEW that decides this, not whether the thread happens to hold a sent
// message: a thread you have answered carries a sent copy wherever it sits, so testing the row's
// mailboxes named recipients all over Inbox and Archive. Worse, those mailboxes come from the
// thread's message in the current mailbox while `recipients` comes from its latest message anywhere
// — on an archived thread whose newest mail is an incoming reply, the row took "outgoing" from its
// own sent copy and then named that reply's recipient: you.
//
// Search results are the exception: a row there is described by the conversation's newest match,
// so it is that message that answers — a mail you sent, found in search, goes by who you sent it to.
// The exact copy that matched: a mail sent to yourself is one message with two copies, and the one
// in Sent is yours though the copy delivery filed stands for it in the thread.
const match = computed(() =>
  mail.match_id
    ? mail.messages?.flatMap(mailCopies).find((copy) => copy.id === mail.match_id)
    : undefined,
)
const isOutgoing = computed(() => {
  if (outgoing !== undefined) return outgoing
  if (mailbox === 'search')
    return !!match.value && !isReceived(match.value, mail.sent ?? mailboxIds.sent)
  return mailbox === mailboxIds.sent || mailbox === mailboxIds.drafts
})

// Read off the conversation the row carries. A search result names its match's sender instead.
const participants = computed(() =>
  mailbox === 'search' ? [] : threadParticipants(mail.messages, ownEmails.value),
)

const header = computed(() => {
  if (isOutgoing.value) return getFormattedRecipients(mail.recipients) || __('To:')
  return threadDisplayName(participants.value, mail)
})

// Gmail-style count of how many messages the conversation holds, shown once there's more than one.
const messageCount = computed(() => mail.messages?.length ?? 0)

const avatarLabel = computed(() => threadAvatarLabel(participants.value, mail))

// In search results, the words the row was found by are marked.
const searchTerm = computed(() =>
  mailbox === 'search'
    ? (
        ((Array.isArray(route.query.text) ? route.query.text[0] : route.query.text) ?? '') ||
        ''
      ).trim()
    : '',
)

const showAttachmentViewer = ref(false)
const attachmentIndex = ref(0)

const openAttachment = (idx: number) => {
  attachmentIndex.value = idx
  showAttachmentViewer.value = true
}

// attachment

const currentlyDownloading = ref<string[]>([])

const downloadAttachment = async (attachment: Attachment) => {
  currentlyDownloading.value.push(attachment.blob_id)
  try {
    const url = await getAttachmentUrl(attachment.blob_id, attachment.type, accountId)
    if (url) downloadUrlAsFile(url, attachment.filename || 'attachment')
  } catch {
    // the resource's onError already raised a toast; just stop spinning
  } finally {
    currentlyDownloading.value = currentlyDownloading.value.filter(
      (id) => id !== attachment.blob_id,
    )
  }
}
</script>
