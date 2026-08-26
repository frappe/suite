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
		@set-selected="(selected: boolean) => emit('setSelected', selected)"
	>
		<template #sender><span v-html="highlight(header)" /></template>

		<template #badges>
			<!-- How many messages the thread holds — only worth saying once it holds more than one. -->
			<span
				v-if="messageCount > 1"
				class="text-ink-gray-5 shrink-0 text-xs"
				:aria-label="__('{0} messages', [messageCount])"
			>
				{{ messageCount }}
			</span>
			<Badge v-if="mail.draft" size="sm" :label="__('Draft')" theme="red" />
		</template>

		<template #subject><span v-html="highlight(mail.subject || __('[No subject]'))" /></template>
		<template #preview>
			<span v-html="highlight(mail.preview || __('— No message body —'))" />
		</template>

		<template #trailing="{ isHovered }">
			<MailRowActions
				:is-hovered
				:threads="[mail]"
				@set-seen="(seen: boolean) => emit('setSeen', seen)"
				@archive="emit('archiveThread')"
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
							<AttachmentCapsule
								:file-name="`+${String(attachments.length - 2)}`"
								class="mr-2"
							/>
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
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Download, Loader } from 'lucide-vue-next'
import { Badge, Popover, Tooltip } from 'frappe-ui'

import { getAttachmentUrl } from '@/apps/mail/resources'
import { downloadUrlAsFile, getFileIcon, getFormattedRecipients } from '@/apps/mail/utils'
import {
	threadAvatarLabel,
	threadDisplayName,
	threadParticipants,
} from '@/apps/mail/utils/participants'
import { useOwnEmails } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import AttachmentCapsule from '@/apps/mail/components/AttachmentCapsule.vue'
import AttachmentViewer from '@/apps/mail/components/AttachmentViewer.vue'
import MailRow from '@/apps/mail/components/MailRow.vue'
import MailRowActions from '@/apps/mail/components/MailRowActions.vue'

import type { Attachment, Thread } from '@/apps/mail/types'

const {
	mailbox,
	mail,
	isSelected,
	accountId,
	accountLabel,
	selectable = true,
	hideSender = false,
	selectionMode = false,
	threadRouteName = 'mail-mail',
	hideAvatar = false,
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
	// Mobile selection mode — forwarded to MailRow.
	selectionMode?: boolean
	// Which route the row links to. All Inboxes points at its own thread route so opening a
	// mail stays in the merged list instead of navigating into one account's mailbox.
	threadRouteName?: string
	// Forwarded to MailRow — see there.
	hideAvatar?: boolean
}>()

const emit = defineEmits([
	'setSeen',
	'archiveThread',
	'trashThread',
	'deleteThread',
	'setFlagged',
	'setSelected',
])

const route = useRoute()
const { mailboxIds } = userStore()
const ownEmails = useOwnEmails()

const to = computed(() => ({
	name: threadRouteName,
	params: {
		accountId: accountId || route.params.accountId,
		mailbox,
		threadID: mail.thread_id,
	},
	query: route.query,
}))

const mailboxesToShow = computed(() => mail.mailboxes.filter((m) => m.mailbox_id !== mailbox))

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
// Search results are the exception: they are single messages with no thread behind them and no
// participants to name, so there the message's own mailboxes still answer it — otherwise a mail you
// sent, found in search, would go by your own name rather than by who you sent it to.
const isOutgoing = computed(() => {
	if (mailbox === 'search')
		return mail.mailboxes.some(
			(m) => m.mailbox_id === mailboxIds.sent || m.mailbox_id === mailboxIds.drafts,
		)
	return mailbox === mailboxIds.sent || mailbox === mailboxIds.drafts
})

// Read off the conversation the row already carries; empty for a search result, which has none.
const participants = computed(() => threadParticipants(mail.messages, ownEmails.value))

const header = computed(() => {
	if (isOutgoing.value) return getFormattedRecipients(mail.recipients) || __('To:')
	return threadDisplayName(participants.value, mail)
})

// Gmail-style count of how many messages the conversation holds, shown once there's more than one.
const messageCount = computed(() => mail.messages?.length ?? 0)

const avatarLabel = computed(() => threadAvatarLabel(participants.value, mail))

// In search results, highlight the matched query term. Escape the text first (so any markup in the
// content is neutralized), then wrap matches in <mark> — the only HTML we inject — for safe v-html.
const searchTerm = computed(() =>
	mailbox === 'search' ? ((route.query.text as string) || '').trim() : '',
)
const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
	)
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const highlight = (text?: string) => {
	const escaped = escapeHtml(text ?? '')
	const term = searchTerm.value
	if (!term) return escaped
	return escaped.replace(
		new RegExp(`(${escapeRegExp(escapeHtml(term))})`, 'gi'),
		'<mark class="bg-surface-yellow-5 text-ink-gray-8">$1</mark>',
	)
}

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
