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
    :preview-italic="!mail.preview"
    :account-label="accountLabel"
    :draggable
    @set-selected="(selected: boolean) => emit('setSelected', selected)"
    @drag-start="(e: DragEvent) => emit('dragStart', e)"
    @drag-end="emit('dragEnd')"
  >
    <template #sender><HighlightedText :text="header" :term="searchTerm" /></template>

    <template #badges>
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
      <Badge v-if="mail.draft" size="sm" :label="__('Draft')" theme="red" />
    </template>

    <template #subject>
      <HighlightedText :text="mail.subject || __('[No subject]')" :term="searchTerm" />
    </template>
    <template #preview>
      <HighlightedText :text="mail.preview || __('— No message body —')" :term="searchTerm" />
    </template>

    <template #trailing="{ isHovered }">
      <MailRowActions
        :is-hovered
        :threads="[mail]"
        :drafts
        :unarchive
        @set-seen="(seen: boolean) => emit('setSeen', seen)"
        @archive="emit('archiveThread')"
        @unarchive="emit('unarchiveThread')"
        @trash="emit('trashThread')"
        @delete="emit('deleteThread')"
        @set-flagged="(flagged: boolean) => emit('setFlagged', flagged)"
      />
    </template>

    <template #extra="{ isFullWidth }">
      <div
        v-if="
          attachments.length ||
          mail.draft ||
          ['starred', 'search'].includes(mailbox) ||
          (isFullWidth && mailboxesToShow.length)
        "
        class="flex items-center"
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
            class="mr-2"
            :class="isFullWidth ? 'max-w-32' : 'max-w-44 sm:max-w-20'"
            @click.stop.prevent="openAttachment(idx)"
          />
        </Tooltip>
        <Popover v-if="attachments.length > 2" side="bottom">
          <template #trigger>
            <Tooltip :text="__('View remaining attachments')">
              <AttachmentCapsule :file-name="`+${String(attachments.length - 2)}`" class="mr-2" />
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
          <div
            v-for="m in mailboxesToShow"
            :key="m.mailbox_id"
            class="bg-surface-gray-3 inline-flex rounded-4 p-1.5 text-xs"
          >
            {{ m.mailbox_name }}
          </div>
          <div v-if="moreMailboxes" class="bg-surface-gray-3 inline-flex rounded-4 p-1.5 text-xs">
            +{{ moreMailboxes }}
          </div>
        </template>
      </div>
      <template v-if="!isFullWidth && mailboxesToShow.length">
        <div
          v-for="m in mailboxesToShow"
          :key="m.mailbox_id"
          class="bg-surface-gray-3 mr-1.5 inline-flex rounded-4 p-1.5 text-xs"
        >
          {{ m.mailbox_name }}
        </div>
        <div
          v-if="moreMailboxes"
          class="bg-surface-gray-3 mr-1.5 inline-flex rounded-4 p-1.5 text-xs"
        >
          +{{ moreMailboxes }}
        </div>
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
import { Download, Loader, UserRoundSearch } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import AttachmentCapsule from '@/apps/mail/components/AttachmentCapsule.vue'
import AttachmentViewer from '@/apps/mail/components/AttachmentViewer.vue'
import MailRow from '@/apps/mail/components/MailRow.vue'
import MailRowActions from '@/apps/mail/components/MailRowActions.vue'
import { useScreener } from '@/apps/mail/composables/useScreener'
import { getAttachmentUrl } from '@/apps/mail/resources'
import { userStore } from '@/apps/mail/stores/user'
import type { Attachment, Thread } from '@/apps/mail/types'
import { downloadUrlAsFile, getFileIcon, getFormattedRecipients } from '@/apps/mail/utils'
import { useOwnEmails } from '@/apps/mail/utils/composables'
import { mailCopies } from '@/apps/mail/utils/mailCopies'
import {
  threadAvatarLabel,
  threadDisplayName,
  threadParticipants,
} from '@/apps/mail/utils/participants'
import { isReceived, receivedFolders, searchFolders } from '@/apps/mail/utils/receivedMail'
import { mailboxParam, UNIFIED_THREAD_ROUTE } from '@/apps/mail/utils/unifiedFolders'
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
}>()

const emit = defineEmits([
  'setSeen',
  'archiveThread',
  'unarchiveThread',
  'trashThread',
  'deleteThread',
  'setFlagged',
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

// An account's thread route names its folder by slug (see utils/unifiedFolders); the merged
// folder's needs none, since its own folder param already says which one.
const to = computed(() => ({
  name: threadRouteName,
  params: {
    accountId: accountId || route.params.accountId,
    ...(threadRouteName === UNIFIED_THREAD_ROUTE
      ? {}
      : { mailbox: mailboxParam(mailbox, mailboxes.data) }),
    threadID: mail.thread_id,
  },
  query: route.query,
}))

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
  mailbox === 'search' ? ((route.query.text as string) || '').trim() : '',
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
