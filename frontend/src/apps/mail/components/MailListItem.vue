<template>
	<MailRow
		:to
		:is-selected
		:selectable
		:selection-mode
		:unread="!mail.seen"
		:hide-sender
		:avatar-label="getSenderInitial(mail)"
		:avatar-image="mail.user_image"
		:datetime="mail.received_at"
		:subject-italic="!mail.subject"
		:preview-italic="!mail.preview"
		@set-selected="(selected: boolean) => emit('setSelected', selected)"
	>
		<template #sender><span v-html="highlight(header)" /></template>

		<template #badges>
			<!-- All Inboxes: which account received this mail. -->
			<div v-if="accountLabel" class="text-ink-gray-4 flex shrink-0 items-center gap-1 text-xs">
				<span aria-hidden="true">·</span>
				<span>{{ __('in {0}', [accountLabel]) }}</span>
			</div>
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
						class="mr-2"
						:class="isFullWidth ? 'max-w-32' : 'max-w-44 sm:max-w-20'"
						@click.stop.prevent="openAttachment(idx)"
					/>
				</Tooltip>
				<Popover v-if="attachments.length > 2" placement="bottom">
					<template #target="{ togglePopover }">
						<Tooltip :text="__('View remaining attachments')">
							<AttachmentCapsule
								:file-name="`+${String(attachments.length - 2)}`"
								class="mr-2"
								@click.stop.prevent="togglePopover()"
							/>
						</Tooltip>
					</template>
					<template #body-main>
						<div class="max-h-80 overflow-y-auto p-1">
							<Tooltip
								v-for="(attachment, idx) in attachments.slice(2)"
								:key="idx"
								:text="attachment.filename"
							>
								<div
									class="group/capsule hover:bg-surface-gray-1 flex max-w-60 cursor-pointer space-x-2 truncate rounded px-2 py-1.5"
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
						class="bg-surface-gray-3 inline-flex rounded p-1.5 text-xs"
					>
						{{ m.mailbox_name }}
					</div>
				</template>
			</div>
			<template v-if="!isFullWidth && mailboxesToShow.length">
				<div
					v-for="m in mailboxesToShow"
					:key="m.mailbox_id"
					class="bg-surface-gray-3 mr-1.5 inline-flex rounded p-1.5 text-xs"
				>
					{{ m.mailbox_name }}
				</div>
			</template>
		</template>

		<AttachmentViewer
			v-model="showAttachmentViewer"
			:attachments="mail.attachments"
			:initial-index="attachmentIndex"
		/>
	</MailRow>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Download, Loader } from 'lucide-vue-next'
import { Badge, Popover, Tooltip } from 'frappe-ui'

import { getAttachmentUrl } from '@/apps/mail/resources'
import { downloadUrlAsFile, getFileIcon, getFormattedRecipients, getSenderInitial } from '@/apps/mail/utils'
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

const to = computed(() => ({
	name: 'mail-mail',
	params: {
		accountId: accountId || route.params.accountId,
		mailbox,
		threadID: mail.thread_id,
	},
	query: route.query,
}))

const mailboxes = computed(() => mail.mailboxes.map((m) => m.mailbox_id))

const mailboxesToShow = computed(() => mail.mailboxes.filter((m) => m.mailbox_id !== mailbox))

const attachments = computed(
	() => mail.attachments.filter((m) => m.filename && m.disposition === 'attachment') || [],
)

const header = computed(() => {
	const isOutgoing =
		mailboxes.value.includes(mailboxIds.sent) || mailboxes.value.includes(mailboxIds.drafts)

	return isOutgoing
		? getFormattedRecipients(mail.recipients) || __('To:')
		: mail.from_name || mail.from_email
})

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
		const url = await getAttachmentUrl(attachment.blob_id, attachment.type)
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
