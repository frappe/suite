<template>
  <Button
    v-for="action in shown(mail).filter((d) => !d.star)"
    :key="action.label"
    variant="ghost"
    :tooltip="action.label"
    @click.stop="action.onClick"
  >
    <template #icon>
      <component :is="action.icon" class="text-ink-gray-5 icon" />
    </template>
  </Button>

  <!-- .stop lives on the wrapper: AdaptiveDropdown's mobile trigger opens via
	     the click bubbling to its own span, so stopping on the Button itself
	     would keep the sheet from opening. -->
  <div v-if="!mail.draft && !isCollapsed" class="flex" @click.stop>
    <AdaptiveDropdown :options="moreActions(mail)">
      <Button variant="ghost" :tooltip="__('More')">
        <template #icon>
          <Ellipsis class="text-ink-gray-5 icon" />
        </template>
      </Button>
    </AdaptiveDropdown>
  </div>

  <!-- The star last, past More: it says whether the message is marked as much as it acts, and the
	     edge is where every list and folded row keeps it. -->
  <Button
    v-for="action in shown(mail).filter((d) => d.star)"
    :key="action.label"
    variant="ghost"
    :tooltip="action.label"
    @click.stop="action.onClick"
  >
    <template #icon>
      <component :is="action.icon" class="text-ink-gray-5 icon" />
    </template>
  </Button>
</template>

<script lang="ts" setup>
import { Button, toast } from 'frappe-ui'
import {
  Ban,
  CircleAlert,
  CircleCheck,
  Code,
  Download,
  Ellipsis,
  ExternalLink,
  Forward,
  ListFilter,
  LockOpen,
  Mail as MailIcon,
  Reply,
  ReplyAll,
  ShieldCheck,
  SquarePen,
  Star,
  Trash2,
} from 'lucide-vue-next'
import { computed, h, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, client, type InputOf } from '@/api'
import { useScreener } from '@/apps/mail/composables/useScreener'
import { FLAGGED_STAR_STYLE } from '@/apps/mail/constants'
import type { ComposeMailData, Identity, Mail, ScreenedAddress } from '@/apps/mail/types'
import {
  downloadUrlAsFile,
  matchesScreenedValue,
  raiseError,
  raiseOptimisticToast,
  raiseToast,
} from '@/apps/mail/utils'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'
import { useFilterBySender, useScreenSize, useUndo } from '@/apps/mail/utils/composables'
import { mailCopyIds } from '@/apps/mail/utils/mailCopies'
import { isReceived } from '@/apps/mail/utils/receivedMail'
import { UNIFIED_ROUTE, UNIFIED_THREAD_ROUTE } from '@/apps/mail/utils/unifiedFolders'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'

const {
  mailbox,
  mail,
  draftMail,
  isCollapsed,
  showReplyAll,
  popOutDraft,
  reply,
  replyAll,
  forward,
  reloadMails,
  dropMail,
  thread,
  hideStar = false,
} = defineProps<{
  mailbox: string
  mail: Mail
  draftMail?: ComposeMailData
  isCollapsed: boolean
  showReplyAll: boolean
  popOutDraft: (mail: ComposeMailData) => void
  reply: (mail: Mail) => void
  replyAll: (mail: Mail) => void
  forward: (mail: Mail) => void
  reloadMails: (isUndo?: boolean) => void
  /** Takes the message out of the pane ahead of the server; returns what puts it back. */
  dropMail: (mailId: string) => () => void
  thread: Mail[]
  /** The host draws the star itself — a folded row, which keeps it at its far right. */
  hideStar?: boolean
}>()
const emit = defineEmits(['setFlagged', 'syncUnseen', 'moveMail', 'markMailSpam', 'deleteMail'])
const { isMobile } = useScreenSize()
const route = useRoute()
const router = useRouter()
// Everything account-scoped resolves through the enclosing pane's scope — the
// thread's owning account in All Inboxes, the active account otherwise. The
// computed refs read live, so makeParams always sees the pane's current account.
const {
  accountId: scopeAccountId,
  mailboxIds,
  identities,
  screenedAddresses,
} = injectAccountScope()
const { setUndoAction, undo } = useUndo()
const screener = useScreener()
const { filterBySender } = useFilterBySender()
const user = inject('$user')

// A sender is "blocked" when screened with the Spam action (their mail goes to Junk) — either by their
// exact address or by a '@domain' entry covering them.
const isSenderBlocked = (email: string) =>
  screenedAddresses.value.data?.some(
    (a: ScreenedAddress) => a.action === 'Spam' && matchesScreenedValue(email, a.email),
  )
// A message alone in its thread has the star beside the subject (MailThread), which stars that same
// message: a second one a line below would only repeat it.
const isAlone = computed(() => thread.filter((m) => !m.draft).length <= 1)
const shown = (mail: Mail) =>
  primaryActions(mail).filter((action) => action.condition !== false && !isCollapsed)
const primaryActions = (mail: Mail): MailAction[] => [
  {
    label: __('Unstar'),
    star: true,
    onClick: () => emit('setFlagged', mailCopyIds(mail), false),
    icon: () =>
      h(Star, {
        style: FLAGGED_STAR_STYLE,
      }),
    condition:
      !!mail.flagged &&
      mailbox !== mailboxIds.value.trash &&
      !isMobile.value &&
      !isAlone.value &&
      !hideStar,
  },
  {
    label: __('Star'),
    star: true,
    onClick: () => emit('setFlagged', mailCopyIds(mail), true),
    icon: Star,
    condition:
      !mail.flagged &&
      !mail.draft &&
      mailbox !== mailboxIds.value.trash &&
      !isMobile.value &&
      !isAlone.value &&
      !hideStar,
  },
  {
    label: __('Edit Draft'),
    onClick: () => popOutDraft(draftMail!),
    icon: SquarePen,
    condition: !!mail.draft && isMobile.value,
  },
  {
    label: showReplyAll ? __('Reply All') : __('Reply'),
    onClick: () => (showReplyAll ? replyAll(mail) : reply(mail)),
    icon: showReplyAll ? ReplyAll : Reply,
    condition: !mail.draft && !isMobile.value,
  },
]
interface MailAction {
  label: string
  onClick: () => void
  icon: typeof SquarePen
  condition?: boolean | (() => boolean)
  /** Drawn last, after More (see the template). */
  star?: boolean
}
interface GroupedAction {
  group: string
  // `options`, not `items`: a menu group keyed on `items` renders nothing.
  options: MailAction[]
}
const moreActions = (mail: Mail): GroupedAction[] => [
  {
    group: '',
    options: [
      {
        label: __('Reply'),
        onClick: () => setTimeout(() => reply(mail), 300),
        icon: Reply,
        condition: () => !mail.draft,
      },
      {
        label: __('Reply All'),
        onClick: () => setTimeout(() => replyAll(mail), 300),
        icon: ReplyAll,
        condition: () => showReplyAll,
      },
      {
        label: __('Forward'),
        onClick: () => setTimeout(() => forward(mail), 300),
        icon: Forward,
        condition: () => !mail.draft,
      },
    ],
  },
  {
    group: '',
    options: [
      {
        label: __('Unstar'),
        onClick: () => emit('setFlagged', mailCopyIds(mail), false),
        icon: () =>
          h(Star, {
            style: FLAGGED_STAR_STYLE,
          }),
        condition: () => !!mail.flagged && mailbox !== mailboxIds.value.trash,
      },
      {
        label: __('Star'),
        onClick: () => emit('setFlagged', mailCopyIds(mail), true),
        icon: Star,
        condition: () => !mail.flagged && !mail.draft && mailbox !== mailboxIds.value.trash,
      },
      {
        label: __('Mark as Junk'),
        onClick: () => emit('markMailSpam', mail, true),
        icon: CircleAlert,
        // Only mail you received is junked: your own sent message stays in Sent (see receivedMail).
        condition: () =>
          mailbox !== mailboxIds.value.drafts &&
          mail.junk === 0 &&
          isReceived(mail, mailboxIds.value.sent),
      },
      {
        label: __('Mark as Not Junk'),
        onClick: () => emit('markMailSpam', mail, false),
        icon: CircleCheck,
        condition: () => mail.junk === 1,
      },
      {
        label: __('Move to Trash'),
        onClick: () => emit('moveMail', mail, mailboxIds.value.trash),
        icon: Trash2,
        condition: () => mailbox !== mailboxIds.value.trash,
      },
      {
        label: __('Delete Message'),
        onClick: () => emit('deleteMail', mail),
        icon: Trash2,
        condition: () => mailbox === mailboxIds.value.trash,
      },
      {
        label: thread.length === 1 ? __('Mark as Unread') : __('Mark Unread from Here'),
        onClick: () => handleMarkUnreadFromHere(),
        icon: MailIcon,
        condition: () => !mail.draft,
      },
      {
        label: __("Filter Sender's Messages"),
        onClick: () => filterBySender(mail.from_email),
        icon: ListFilter,
        condition: () => !mail.draft && !!mail.from_email,
      },
      {
        label: __('Block Sender'),
        onClick: () => handleBlockAddress(true),
        icon: Ban,
        condition: () =>
          !(identities.value.data ?? []).some((i: Identity) => i.email === mail.from_email) &&
          !isSenderBlocked(mail.from_email),
      },
      {
        label: __('Unblock Sender'),
        onClick: () => handleBlockAddress(false),
        icon: LockOpen,
        condition: () => isSenderBlocked(mail.from_email),
      },
      {
        label: __('Mark Domain as Trusted'),
        onClick: () => trustDomain(),
        icon: ShieldCheck,
        condition: () => !mail.draft && !!mail.from_email && !isDomainTrusted(mail.from_email),
      },
    ],
  },
  {
    group: '',
    options: [
      {
        label: __('Download Email'),
        onClick: () => downloadEmail(),
        icon: Download,
        condition: () => !mail.draft,
      },
      {
        label: __('See MIME Message'),
        onClick: () => window.open(`/mail/mime-message/${mail.name}`, '_blank')?.focus(),
        icon: Code,
        condition: () => !mail.draft,
      },
      {
        label: __('View in Desk'),
        onClick: () => window.open(`/app/mail-message/${mail.name}`, '_blank')?.focus(),
        icon: ExternalLink,
        condition: () => user.data.is_system_manager,
      },
    ],
  },
]
async function downloadEmail() {
  try {
    const blob = await client.query(api.mail.messages.download, {
      name: mail.name,
    })
    const url = URL.createObjectURL(blob)
    downloadUrlAsFile(url, `${mail.subject || mail.name}.eml`)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    raiseError(error)
  }
}
// Done on the click: the rows read unread at once (see the client policy), the toast says so and
// the thread is left, while the request goes. A refusal says why and the server keeps the mail read.
function setMailsSeenSubmit({ ids }: { ids: string[] }) {
  const input: InputOf<typeof api.mail.messages.seen> = {
    account: scopeAccountId.value,
    ids,
    seen: false,
  }
  const shown = raiseToast(
    __('{0} marked as unread.', [ids.length === 1 ? __('Mail') : __('Mails')]),
  )
  // Through the client, not a mutation of this menu's: the thread is left at once, and a write of
  // the menu's own would be canceled as it goes.
  client.mutation(api.mail.messages.seen, input).catch(() => toast.dismiss(shown))
  // Leaving the thread is the point — staying would mark it read again. Return to whichever
  // list we came from: hardcoding the mailbox route threw the unified folder out of the merged view
  // and into the owning account's mailbox, which read as the page reloading.
  router.push(
    route.name === UNIFIED_THREAD_ROUTE
      ? { name: UNIFIED_ROUTE, params: { folder: route.params.folder }, query: route.query }
      : {
          name: 'mail-mailbox',
          params: {
            accountId: route.params.accountId,
            mailbox,
          },
          query: route.query,
        },
  )
  emit('syncUnseen', ids)
}
const handleMarkUnreadFromHere = () => {
  const idx = thread.indexOf(mail)
  if (idx === -1) return
  const ids = thread
    .slice(idx)
    .filter((m: Mail) => !m.draft)
    .flatMap(mailCopyIds)
  if (ids.length)
    setMailsSeenSubmit({
      ids,
    })
}

// The sender's domain as a screened value ('@example.com'). "Trusted" = an
// Accepted '@domain' entry — the same state that lets remote images load.
const senderDomain = (email: string) => `@${(email ?? '').trim().toLowerCase().split('@').pop()}`
const isDomainTrusted = (email: string) =>
  !!screenedAddresses.value.data?.some(
    (a: ScreenedAddress) =>
      a.action === 'Accepted' && a.email.trim().toLowerCase() === senderDomain(email),
  )
// Said on the click; a refusal takes the toast down and says why.
const trustDomain = () => {
  const shown = raiseToast(__('Domain marked as trusted.'))
  client
    .mutation(api.mail.screening.set, {
      account: scopeAccountId.value,
      emails: [senderDomain(mail.from_email)],
      action: 'Accepted',
    })
    .catch((error) => {
      toast.dismiss(shown)
      raiseError(error)
    })
}
const handleBlockAddress = (block: boolean) => (block ? blockSender() : unblockSender())

const unblockSender = (isUndo = false) => {
  const forward = client.mutation(
    api.mail.screening.remove,
    { account: scopeAccountId.value, emails: [mail.from_email] },
    { silent: true },
  )
  if (isUndo) return raiseOptimisticToast(forward, __('Sender blocked.'))
  setUndoAction(() => {
    const back = client.mutation(
      api.mail.screening.set,
      { account: scopeAccountId.value, emails: [mail.from_email], action: 'Spam' },
      { silent: true },
    )
    raiseOptimisticToast(back, __('Sender blocked.'))
  })
  raiseOptimisticToast(forward, __('Sender unblocked.'), undo)
}

// Blocking sends the sender's future mail to Junk, and this message with it — they were blocked while
// it was being read. The rest of their mail stays put; the toast offers to move what is in the Inbox.
const blockSender = () => {
  const account = scopeAccountId.value
  const from_emails = [mail.from_email]
  const ids = mailCopyIds(mail)
  // The message leaves at once, as a junked one does: waiting for the server let the refreshed block
  // list mark it blocked while it was still on screen.
  const putBack = dropMail(mail.id)
  // Said on the click, as the message leaves on it (see raiseBlocked).
  const landed = client
    .mutation(api.mail.screening.block, { account, from_emails, ids })
    .then((blocked) => blocked.inbox)
  void landed.catch((error) => {
    putBack()
    raiseError(error)
  })
  screener.raiseBlocked(
    from_emails,
    () => {
      putBack()
      const back = Promise.all([
        client.mutation(
          api.mail.screening.remove,
          { account, emails: from_emails },
          { silent: true },
        ),
        client.mutation(api.mail.messages.spam, { account, ids, spam: false }, { silent: true }),
      ]).then(() => reloadMails(true))
      raiseOptimisticToast(back, __('Sender unblocked.'))
    },
    landed,
    account,
  )
}
</script>
