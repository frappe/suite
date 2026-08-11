<template>
	<!-- The list indents are ours rather than prose-sm's 22px: an outside marker is drawn in
	     that padding, and "10." is wider than it, so from the tenth item on the number was cut
	     off by the editor's own scroll container (it starts at x=0 — the body carries no
	     horizontal padding on desktop). Both lists move together so a document mixing them
	     keeps one indent. -->
	<TextEditor
		ref="textEditor"
		editor-class="prose-sm max-w-none [&_ol]:ps-7 [&_ul]:ps-7"
		:extensions="[CustomImageExtension, CustomParagraphExtension, ...MentionExtensions]"
		:content="mail.html_body.replaceAll('<div><br></div>', '<div></div>')"
		:upload-function
		class="flex flex-col max-sm:overflow-y-auto"
		:class="{ 'pointer-events-none opacity-50': !show, 'sm:h-[75vh]': !isInThread }"
		:style="isMobile && { height: editorHeight }"
		@change="
			(val: string) => {
				mail.html_body = val.replaceAll('<div></div>', '<div><br></div>')
				dropUnmentionedRecipients()
			}
		"
		@dragenter.prevent="handleDragEnter"
		@dragover.prevent="handleDragOver"
		@dragleave.prevent="handleDragLeave"
		@drop.prevent="handleDrop"
	>
		<template #top>
			<div
				class="flex flex-col gap-2.5 border-b pb-2.5 max-sm:px-3 max-sm:pt-2.5"
				:class="{ 'border-transparent': isDragging }"
			>
				<div v-if="!mailDetails?.type || isMobile" class="flex justify-between gap-2">
					<div class="flex items-center gap-2">
						<span class="text-ink-gray-4 text-sm">{{ __('From') }}</span>
						<Combobox
							v-model="mail.from_email"
							:options="
								identities.data.map((i: Identity) => ({
									label: `${i._name} <${i.email}>`,
									value: i.email,
								})) || []
							"
							:open-on-click="true"
							class="min-w-64"
						/>
					</div>
					<Button
						v-if="isInThread"
						variant="ghost"
						:disabled="isLoading || isDraftUpdated"
						@click="emit('popOut', mail)"
					>
						<template #icon>
							<component :is="ExternalLink" class="text-ink-gray-5 h-4 w-4" />
						</template>
					</Button>
				</div>
				<div class="flex items-start gap-2">
					<Dropdown v-if="isInThread && mailDetails?.type" :options="localDraftActions">
						<Button variant="ghost" :icon="TYPE_ICON_MAP[mailDetails.type]"> </Button>
					</Dropdown>
					<div class="flex flex-1 flex-col gap-2.5">
						<div class="flex gap-2">
							<Tooltip :text="__('Select from contacts')">
								<span
									class="text-ink-gray-4 cursor-pointer text-sm leading-7 hover:underline"
									@click="insertContacts('to')"
								>
									{{ __('To') }}
								</span>
							</Tooltip>
							<RecipientInput
								ref="toInput"
								v-model="mail.to"
								@show-cc-bcc="showCcBcc = true"
							/>
							<div class="flex gap-1.5">
								<Button
									v-if="!(mail.cc?.length || mail.bcc?.length)"
									variant="ghost"
									@click="toggleCcBcc"
								>
									<template #icon>
										<component
											:is="showCcBcc ? ChevronUp : ChevronDown"
											class="text-ink-gray-5 h-4 w-4"
										/>
									</template>
								</Button>
							</div>
						</div>
						<template v-if="showCcBcc">
							<div class="flex gap-2">
								<Tooltip :text="__('Select from contacts')">
									<span
										class="text-ink-gray-4 cursor-pointer text-sm leading-7 hover:underline"
										@click="insertContacts('cc')"
									>
										{{ __('Cc') }}
									</span>
								</Tooltip>
								<RecipientInput ref="ccInput" v-model="mail.cc" />
							</div>
							<div class="flex gap-2">
								<Tooltip :text="__('Select from contacts')">
									<span
										class="text-ink-gray-4 cursor-pointer text-sm leading-7 hover:underline"
										@click="insertContacts('bcc')"
									>
										{{ __('Bcc') }}
									</span>
								</Tooltip>
								<RecipientInput v-model="mail.bcc" />
							</div>
						</template>
					</div>
				</div>
				<label
					v-if="!mailDetails?.type || isMobile"
					class="flex cursor-text items-center gap-2"
				>
					<span class="text-ink-gray-4 text-sm">{{ __('Subject') }}</span>
					<input
						ref="subjectInput"
						v-model="mail.subject"
						class="flex-1 cursor-text border-none bg-inherit text-base focus-visible:!ring-0"
					/>
				</label>
			</div>
		</template>
		<template #editor="{ editor }">
			<div
				class="relative flex flex-1 cursor-text flex-col border-2 border-transparent py-2.5 text-sm max-sm:px-3 sm:overflow-y-auto"
				:class="{
					'max-h-96 min-h-32': isInThread,
					'!border-outline-gray-3 rounded border-dashed': isDragging,
				}"
				@click="editor.commands.focus('end')"
			>
				<div
					v-if="isDragging"
					class="bg-surface-gray-1/90 text-ink-gray-3 absolute inset-0 z-50 flex flex-col items-center justify-center space-y-1 rounded"
				>
					<UploadCloud class="stroke-1.5 h-12 w-12" />
					<p class="text-xl-semibold">{{ __('Drop files to upload') }}</p>
				</div>

				<EditorContent :editor :class="{ 'opacity-30': isDragging }" @click.stop />

				<div
					class="mt-auto cursor-default space-y-2.5 pt-2.5"
					:class="{ 'opacity-30': isDragging }"
					@click.stop
				>
					<!-- Show quoted content -->
					<Button
						v-if="mail?.quoted_content"
						label="&middot;&middot;&middot;"
						class="max-h-4 w-fit"
						@click="openQuotedContent"
					/>

					<!-- Attachments -->
					<a
						v-for="(file, index) in mail.attachments.filter(
							(file: Attachment) => file.disposition === 'attachment',
						)"
						:key="index"
						class="bg-surface-gray-2 text-ink-gray-6 flex cursor-pointer items-center rounded p-2.5"
						:href="file.file_url"
						target="_blank"
						@click="openAttachment(file.blob_id, file.type)"
					>
						<span class="mr-1 font-medium">
							{{ file.file_name || file.filename || file.name }}
						</span>
						<span class="mr-1 font-extralight">
							({{ formatBytes(file.file_size || file.size) }})
						</span>
						<FeatherIcon
							class="ml-auto h-3.5 w-3.5"
							name="x"
							@click.stop.prevent="mail.attachments.splice(index, 1)"
						/>
					</a>

					<div
						v-for="(fileUpload, id) in fileUploads.filter((fu) => fu.isUploading)"
						:key="id"
						class="bg-surface-gray-2 text-ink-gray-6 mb-2 rounded p-2.5 text-sm"
					>
						<div class="mb-1.5 flex items-center">
							<span class="mr-1 font-medium"> {{ fileUpload.name }} </span>
							<span class="font-extralight">
								({{ formatBytes(fileUpload.size) }})
							</span>
						</div>
						<Progress :value="fileUpload.progress" />
					</div>
				</div>
			</div>
		</template>
		<template #bottom>
			<ComposeMailToolbar
				:is-recipients-empty
				class="border-t"
				:class="{ 'border-transparent': isDragging }"
				@select-files="(files: File[]) => uploadFiles(files)"
				@append-emoji="(emoji: string) => appendEmoji(emoji)"
				@discard-mail="discardMail"
				@send-mail="sendMail"
				@schedule-send="openScheduleModal"
			/>
		</template>
	</TextEditor>

	<ContactsModal
		v-model="showContactsModal"
		@insert="(selections) => mail[insertContactsInto].push(...selections)"
	/>
	<ScheduleSendModal v-model="showScheduleModal" @confirm="scheduleSend" />
</template>

<script setup lang="ts">
import {
	computed,
	inject,
	nextTick,
	onMounted,
	onUnmounted,
	reactive,
	ref,
	useTemplateRef,
	watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EditorContent } from '@tiptap/vue-3'
import { watchDebounced } from '@vueuse/core'
import {
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Forward,
	Reply,
	ReplyAll,
	UploadCloud,
} from 'lucide-vue-next'
import {
	Button,
	Combobox,
	Dropdown,
	FeatherIcon,
	ImageExtension,
	Progress,
	TextEditor,
	Tooltip,
	createResource,
	useFileUpload,
} from 'frappe-ui'
import { Mention } from 'frappe-ui/editor'

import { getAttachmentUrl } from '@/apps/mail/resources'
import {
	formatBytes,
	isOverlayPresent,
	processInlineImages,
	raiseToast,
	randomString,
} from '@/apps/mail/utils'
import { useScreenSize, useVisualViewport } from '@/apps/mail/utils/composables'
import { createMentionSuggestion } from '@/apps/mail/utils/mentionSuggestion'
import { CustomParagraphExtension } from '@/apps/mail/utils/text-editor'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'
import ComposeMailToolbar from '@/apps/mail/components/ComposeMailToolbar.vue'

import type { Attachment, ComposeMailData, File as FileDoc, Identity, UserResource } from '@/apps/mail/types'
import type { MentionCandidate } from '@/apps/mail/utils/mentionSuggestion'

import RecipientInput from './Controls/RecipientInput.vue'
import ContactsModal from './Modals/ContactsModal.vue'
import ScheduleSendModal from './Modals/ScheduleSendModal.vue'

const show = defineModel<boolean>()

const {
	reloadMails,
	mailDetails,
	isInThread = false,
} = defineProps<{
	reloadMails: () => void
	mailDetails?: ComposeMailData
	isInThread?: boolean
}>()

const emit = defineEmits(['discardMail', 'reply', 'replyAll', 'forward', 'popOut'])

const router = useRouter()
const route = useRoute()
// The editor sends as the enclosing pane's account (the thread's owning account in
// All Inboxes, the active one everywhere else): identities, the account's default
// outgoing email and every create/draft call resolve through this scope.
const scope = injectAccountScope()
const { accountId: scopeAccountId, identities, mailboxIds } = scope

const viewSentMessage = (threadID: string) =>
	router.push({
		name: 'mail-mail',
		params: { accountId: scopeAccountId.value, mailbox: mailboxIds.value.sent, threadID },
	})

const getIdentity = (email: string) =>
	identities.value.data?.find((identity: Identity) => identity.email === email)

// Editor

const { isMobile } = useScreenSize()

const textEditor = useTemplateRef('textEditor')
const toInput = useTemplateRef('toInput')
const ccInput = useTemplateRef('ccInput')
const subjectInput = useTemplateRef<HTMLInputElement>('subjectInput')

const showContactsModal = ref(false)
const insertContactsInto = ref('')

const insertContacts = (insertInto: string) => {
	insertContactsInto.value = insertInto
	showContactsModal.value = true
}

const showCcBcc = ref(!!mailDetails?.cc?.length || !!mailDetails?.bcc?.length)
const toggleCcBcc = () => {
	showCcBcc.value = !showCcBcc.value
	if (showCcBcc.value) nextTick(() => ccInput.value?.setFocus())
}

const appendEmoji = (emoji: string) => {
	textEditor.value.editor.commands.insertContent(emoji)
	textEditor.value.editor.commands.focus()
}

const editorHeight = useVisualViewport(
	(viewport) => `${viewport.height - viewport.offsetTop - 113}px`,
)

// Mentions

// Picking a mention adds that person to To — reaching back up to the recipient fields
// is the trip the shortcut exists to save. Only the pick adds, so a mention arriving
// with pasted or forwarded content doesn't quietly address the mail to anyone.
//
// Recipients this composer added that way, and only those: deleting the mention takes
// them back out again, while someone typed into To by hand and then mentioned stays
// put — the mention didn't put them there and doesn't get to remove them.
const mentionedRecipients = new Set<string>()

const addMentionedRecipient = ({ email, display_name, image }: MentionCandidate) => {
	if ([...mail.to, ...mail.cc, ...mail.bcc].some((r) => r.email === email)) return

	mail.to.push({ email, display_name, image })
	mentionedRecipients.add(email)
}

const dropUnmentionedRecipients = () => {
	const editor = textEditor.value?.editor
	if (!editor || !mentionedRecipients.size) return

	const mentioned = new Set<string>()
	editor.state.doc.descendants((node) => {
		if (node.type.name === 'mention' && node.attrs.id) mentioned.add(node.attrs.id)
	})

	for (const email of mentionedRecipients) {
		// Still named somewhere in the body — mentioning someone twice and deleting one
		// of the two keeps them addressed.
		if (mentioned.has(email)) continue

		mail.to = mail.to.filter((recipient) => recipient.email !== email)
		mentionedRecipients.delete(email)
	}
}

const MentionExtensions = [
	// The inline node. Its own `@` suggester stays inert with no item source of its
	// own — the search below is the one wired up.
	Mention,
	createMentionSuggestion({
		account: () => scopeAccountId.value,
		onSelect: addMentionedRecipient,
		// Null in a thread or the mobile sheet, where nothing is holding the rest of
		// the page inert and the default <body> is fine.
		container: () =>
			(textEditor.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>(
				'[role="dialog"]',
			) ?? null,
	}),
]

// Setup & hooks

const user = inject('$user') as UserResource

const getDefaultFromEmail = () => {
	const identityEmails = identities.value.data?.map((i: Identity) => i.email) ?? []
	// The default outgoing email is per-account; pick the scope account's.
	const defaultOutgoingEmail = scope.account.value?.default_outgoing_email

	return (
		identityEmails.find((e) => e === mailDetails?.from_email) ??
		identityEmails.find((e) => e === defaultOutgoingEmail) ??
		identityEmails[0] ??
		user.data.name
	)
}

const mail = reactive<ComposeMailData>({
	name: mailDetails?.name || '',
	id: mailDetails?.id || '',
	from_email: getDefaultFromEmail(),
	to: mailDetails?.to || [],
	cc: mailDetails?.cc || [],
	bcc: mailDetails?.bcc || [],
	attachments: mailDetails?.attachments || [],
	subject: mailDetails?.subject || '',
	html_body: mailDetails?.html_body || '',
	quoted_content: mailDetails?.quoted_content || '',
	in_reply_to: mailDetails?.in_reply_to || '',
	in_reply_to_id: mailDetails?.in_reply_to_id || '',
	forwarded_from_id: mailDetails?.forwarded_from_id || '',
})

const originalMail = ref<ComposeMailData>()
const updateOriginalMail = () => (originalMail.value = JSON.parse(JSON.stringify(mail)))
const isDraftUpdated = computed(() => JSON.stringify(mail) !== JSON.stringify(originalMail.value))

// Start where there is still something to write: the body on a reply (recipients and
// subject come with the thread), the subject when the draft arrived addressed but
// unnamed — a `mailto:` link, or a calendar invite's participants — and the To field
// otherwise. The delay is the dialog's: focusing during its transition doesn't take.
onMounted(() => {
	updateOriginalMail()
	if (mailDetails?.in_reply_to) return textEditor.value.editor.commands.focus()

	// Deferred, and the choice made from inside: TextEditor renders nothing until it has
	// built its editor on its own mounted hook, so neither field exists yet at this point.
	setTimeout(() => {
		if (!isRecipientsEmpty.value && !mail.subject && subjectInput.value)
			subjectInput.value.focus()
		else toInput.value?.setFocus()
	}, 50)
})

onUnmounted(() => saveDraft())

watchDebounced(mail, () => saveDraft(), { debounce: 2000 })

// Actions

const isSavingDraft = ref(false)

const saveDraft = async () => {
	if (!isDraftUpdated.value || isLoading.value || isDiscarding.value) return

	isSavingDraft.value = true
	if (mail.id) await updateDraft.submit({ submit: false })
	else if (!isMailEmpty.value) await createMail.submit({ save_as_draft: true })
	isSavingDraft.value = false
}

// Mirrors UNDO_SEND_WINDOW_SECONDS in api/mail.py; the server holds delivery a few
// seconds longer than this so a last-moment Undo still lands in time.
const UNDO_SEND_WINDOW_MS = 10000

// A plain Send holds delivery for the undo window ('undo'); the Schedule send flow
// passes an explicit time ('scheduled'). Both come back with status 'Scheduled', so
// the toast has to know which one it is confirming.
const sendMode = ref<'undo' | 'scheduled'>('undo')

const sendMail = async (sendAt?: string) => {
	if (deleteMail.loading) return

	if (isRecipientsEmpty.value)
		return raiseToast(__('Please add at least one recipient.'), 'error')

	sendMode.value = sendAt ? 'scheduled' : 'undo'
	isSavingDraft.value = false
	show.value = false
	if (createMail.loading) await createMail.promise
	if (updateDraft.loading) await updateDraft.promise

	if (mail.id) updateDraft.submit({ submit: true, send_at: sendAt, undo_send: !sendAt })
	else createMail.submit({ save_as_draft: false, send_at: sendAt, undo_send: !sendAt })
}

// Undo send: Send actually scheduled delivery a few seconds out (server-side hold), so
// undoing is just cancelling that schedule — the message lands back in Drafts.

const undoSend = createResource({
	url: 'suite.mail.api.mail.cancel_scheduled_mail',
	makeParams: ({ name }: { name: string }) => ({ account: scopeAccountId.value, name }),
	onSuccess: () => {
		reloadMails()
		raiseToast(__('Sending undone. The message is back in your drafts.'))
	},
	onError: (error) => raiseToast(error.message, 'error'),
})

// Schedule send (FUTURERELEASE)

const showScheduleModal = ref(false)

const openScheduleModal = () => {
	if (isRecipientsEmpty.value)
		return raiseToast(__('Please add at least one recipient.'), 'error')

	showScheduleModal.value = true
}

const scheduleSend = (sendAt: string) => sendMail(sendAt)

const isDiscarding = ref(false)

const discardMail = async () => {
	if (deleteMail.loading) return

	isDiscarding.value = true
	show.value = false
	if (createMail.loading) await createMail.promise
	if (updateDraft.loading) await updateDraft.promise
	if (mail.id) deleteMail.submit()
	else emit('discardMail')
}

watch(show, (val) => {
	if (val) return
	isDiscarding.value = false
	isSavingDraft.value = false
})

defineExpose({ sendMail, discardMail, openScheduleModal })

const onMailUpdateSuccess = ({
	name,
	id,
	status,
	error,
	thread_id,
}: {
	name: string
	id: string
	status: string
	error: string
	thread_id?: string
}) => {
	if (id) mail.id = id
	updateOriginalMail()
	if (error) return raiseToast(error, 'error')
	if (isDiscarding.value) return

	if (!isInThread || status === 'Submitted' || status === 'Scheduled') reloadMails()
	if (show.value) return

	if (status === 'Drafted' && isSavingDraft.value) raiseToast(__('Draft saved.'))
	else if (status === 'Submitted')
		raiseToast(
			__('Message sent.'),
			'success',
			// No View action when the sent mail's thread is already open in front of the user.
			thread_id && route.params.threadID !== thread_id
				? { label: __('View'), onClick: () => viewSentMessage(thread_id) }
				: undefined,
		)
	else if (status === 'Scheduled' && sendMode.value === 'undo')
		raiseToast(
			__('Message sent.'),
			'success',
			{ label: __('Undo'), onClick: () => undoSend.submit({ name }) },
			UNDO_SEND_WINDOW_MS,
		)
	else if (status === 'Scheduled')
		raiseToast(__('Send scheduled.'), 'success', {
			label: __('View'),
			onClick: () =>
				router.push({
					name: 'mail-scheduled',
					params: { accountId: scopeAccountId.value },
				}),
		})
}

// Resources

const createMail = createResource({
	url: 'suite.mail.api.mail.create_mail',
	makeParams: ({
		save_as_draft,
		send_at,
		undo_send,
	}: {
		save_as_draft: boolean
		send_at?: string
		undo_send?: boolean
	}) => ({
		account: scopeAccountId.value,
		...mail,
		...processInlineImages(mail, { sending: !save_as_draft }),
		from_name: getIdentity(mail.from_email!)._name,
		save_as_draft,
		send_at,
		undo_send,
	}),
	onSuccess: onMailUpdateSuccess,
	onError: (error) => raiseToast(error.message, 'error'),
})

const updateDraft = createResource({
	url: 'suite.mail.api.mail.update_draft_mail',
	makeParams: ({
		submit,
		send_at,
		undo_send,
	}: {
		submit: boolean
		send_at?: string
		undo_send?: boolean
	}) => ({
		account: scopeAccountId.value,
		...mail,
		...processInlineImages(mail, { sending: submit }),
		from_name: getIdentity(mail.from_email!)._name,
		submit,
		send_at,
		undo_send,
	}),
	onSuccess: onMailUpdateSuccess,
	onError: (error) => raiseToast(error.message, 'error'),
})

const deleteMail = createResource({
	url: 'suite.mail.api.mail.delete_mail',
	makeParams: () => ({ account: scopeAccountId.value, id: mail.id }),
	onSuccess: () => {
		reloadMails()
		raiseToast(__('Draft discarded.'))
	},
	onError: (error) => raiseToast(error.message, 'error'),
})

const isLoading = computed(() => createMail.loading || updateDraft.loading || deleteMail.loading)

// Local draft actions

const localDraftActions = computed(() => [
	{
		group: '',
		items: [
			{ label: __('Reply'), icon: Reply, onClick: () => emit('reply') },
			{
				label: __('Reply All'),
				icon: ReplyAll,
				onClick: () => emit('replyAll'),
			},
			{
				label: __('Forward'),
				icon: Forward,
				onClick: () => emit('forward'),
			},
		],
	},
	{
		group: '',
		items: [
			{
				label: __('Pop Out'),
				icon: ExternalLink,
				onClick: () => emit('popOut', mail),
				condition: () => !isLoading.value,
			},
		],
	},
])

// Mail content

const isRecipientsEmpty = computed(() => [mail.to, mail.cc, mail.bcc].every((d) => !d.length))

const isBodyEmpty = computed(() => {
	if (!mail.html_body) return true

	const element = document.createElement('div')
	element.innerHTML = mail.html_body

	const hasText = element.textContent?.trim()
	const hasMedia = element.querySelector('img, video, svg') !== null

	return !hasText && !hasMedia
})

const isMailEmpty = computed(() => {
	const isSubjectEmpty = !mail.subject
	const isQuotedContentEmpty = !mail.quoted_content
	const isAttachmentsEmpty = !mail.attachments?.length

	return (
		isSubjectEmpty &&
		isQuotedContentEmpty &&
		isRecipientsEmpty.value &&
		isAttachmentsEmpty &&
		isBodyEmpty.value
	)
})

const openQuotedContent = () => {
	mail.html_body += `<br>${mail.quoted_content}`
	mail.quoted_content = ''
}

const buildSignature = (email?: string) => {
	const identity = getIdentity(email!)
	return identity?.text_signature
		? `<div><br></div><div><br></div>${identity.html_signature}`
		: ''
}

const bodyText = (html: string) => {
	const element = document.createElement('div')
	element.innerHTML = html || ''
	return element.textContent?.trim() ?? ''
}

// Swap the signature when the From identity changes — but only while the body is still the
// auto-inserted signature (or empty), so a message the user has written isn't overwritten.
// Compared by text so the editor's HTML normalization doesn't defeat the match.
watch(
	() => mail.from_email,
	(val, oldVal) => {
		if (isBodyEmpty.value || bodyText(mail.html_body) === bodyText(buildSignature(oldVal))) {
			mail.html_body = buildSignature(val)
		}
	},
	{ immediate: true },
)

// Attachments

const openAttachment = async (blob_id?: string, type?: string) => {
	if (!blob_id) return

	// Opened up front, while the click's user activation is still live: Safari blocks
	// window.open() once the gesture has expired, which it has by the time the
	// attachment has been fetched. A null tab means the popup blocker got it —
	// retrying after the fetch would hit the same block, so just say so.
	const tab = window.open('', '_blank')
	if (!tab) return raiseToast(__('Allow popups to open attachments.'), 'error')

	try {
		tab.location.href = await getAttachmentUrl(blob_id, type, scopeAccountId.value)
	} catch {
		tab.close()
	}
}

// Custom Extensions

const uploadFunction = async (file: File) => {
	const fileUpload = useFileUpload()
	return fileUpload.upload(file, {
		private: true,
		folder: 'Home/Frappe Mail',
		upload_endpoint: '/api/method/suite.mail.api.mail.upload_file',
	})
}

const CustomImageExtension = ImageExtension.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			'data-cid': {
				default: null,
				parseHTML: (element) => element.getAttribute('data-cid'),
				renderHTML: (attributes) => {
					const src = attributes.src || ''
					if (
						!attributes['data-cid'] &&
						(src.startsWith('/files') || src.startsWith('/private/files'))
					)
						attributes['data-cid'] = randomString(10)
					return { 'data-cid': attributes['data-cid'] }
				},
			},
		}
	},
}).configure({
	HTMLAttributes: { width: '600', style: 'max-width:100%; height:auto' },
	uploadFunction,
})

const TYPE_ICON_MAP = {
	reply: Reply,
	replyAll: ReplyAll,
	forward: Forward,
}

// Shortcuts

const handleKeydown = (e: KeyboardEvent) => {
	if (!show.value || (isInThread && isOverlayPresent())) return

	handleSendShortcut(e)
	handleDiscardShortcut(e)
}

const handleSendShortcut = (e: KeyboardEvent) => {
	if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
		e.preventDefault()
		sendMail()
	}
}

const handleDiscardShortcut = (e: KeyboardEvent) => {
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
		e.preventDefault()
		discardMail()
	}
}

onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))

// Drag and drop file upload

const isDragging = ref(false)
let dragCounter = 0

const handleDragEnter = (e: DragEvent) => {
	e.preventDefault()
	dragCounter++
	if (e.dataTransfer?.types.includes('Files')) isDragging.value = true
}

const handleDragOver = (e: DragEvent) => {
	e.preventDefault()
	if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

const handleDragLeave = (e: DragEvent) => {
	e.preventDefault()
	dragCounter--
	if (dragCounter === 0) isDragging.value = false
}

const handleDrop = (e: DragEvent) => {
	e.preventDefault()
	isDragging.value = false
	dragCounter = 0

	const files = Array.from(e.dataTransfer?.files ?? [])
	uploadFiles(files)
}

const fileUploads = ref<ReturnType<typeof useFileUpload>[]>([])

const uploadFiles = async (files: File[]) => {
	if (!files.length) return

	const results = await Promise.allSettled(files.map(uploadFile))
	results.forEach((res, i) => {
		if (res.status === 'rejected')
			raiseToast(__('Failed to upload {0}', [files[i].name]), 'error')
	})
}

const uploadFile = async (file: File) => {
	const fileUpload = useFileUpload()
	fileUploads.value.push({ name: file.name, size: file.size, ...fileUpload })

	const doc = (await fileUpload.upload(file, {
		private: true,
		folder: 'Home/Frappe Mail',
		upload_endpoint: '/api/method/suite.mail.api.mail.upload_file',
	})) as FileDoc

	attachDoc(doc)
}

const attachDoc = (doc: FileDoc) =>
	mail.attachments.push({
		file_name: doc.file_name,
		file_url: doc.file_url,
		file_size: doc.file_size,
		disposition: 'attachment',
	})
</script>
