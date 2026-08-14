<template>
	<!-- The list indents are ours rather than prose-sm's 22px: an outside marker is drawn in
	     that padding, and "10." is wider than it, so from the tenth item on the number was cut
	     off by the editor's own scroll container (it starts at x=0 — the body carries no
	     horizontal padding on desktop). Both lists move together so a document mixing them
	     keeps one indent. -->
	<!-- 75vh is a modal's height — it has the screen to itself. Docked, the composer sits beside
	     the mail it is being written about, so it takes a fixed 30rem and leaves the rest of the
	     list visible; the panel's own max-h still clips it on a short viewport. In a thread the
	     height is the thread's. -->
	<TextEditor
		ref="textEditor"
		editor-class="prose-sm max-w-none [&_ol]:ps-7 [&_ul]:ps-7"
		:extensions="[CustomImageExtension, CustomParagraphExtension, ...mentionExtensions]"
		:content="editorContent"
		:upload-function="uploadFunction"
		class="flex flex-col"
		:class="[
			{ 'pointer-events-none opacity-50': !show },
			isInThread ? '' : docked ? 'sm:h-[30rem]' : 'sm:h-[75vh]',
		]"
		@change="onEditorChange"
		@dragenter.prevent="handleDragEnter"
		@dragover.prevent="handleDragOver"
		@dragleave.prevent="handleDragLeave"
		@drop.prevent="handleDrop"
	>
		<template #top>
			<div
				class="flex flex-col gap-2.5 border-b pb-2.5 max-sm:px-3 max-sm:pt-2.5"
				:class="[
					isDragging ? 'border-transparent' : '',
					// Bleed the rule to its container's edges while the fields stay on the content
					// axis: every host pads this block, so without cancelling that the separator
					// stops short of both sides and reads as underlining the fields rather than
					// dividing the composer. The amount is whichever host it is — the message card
					// in a thread pads by 5, the Dialog's body wrapper and ComposeDock by 6.
					isInThread ? 'sm:-mx-5 sm:px-5' : 'sm:-mx-6 sm:px-6',
				]"
			>
				<!-- A reply inside a thread leaves From and Subject out: the conversation around it
				     says both. Detached into a window there is no conversation around it, so a
				     popped-out reply shows them like any other composer. -->
				<div
					v-if="!isInThread || !mailDetails?.type || isMobile"
					class="flex justify-between gap-2"
				>
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
					v-if="!isInThread || !mailDetails?.type || isMobile"
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
		<!-- Last child of the scroller, so `sticky bottom-0` (mobile, in the toolbar itself) pins it to
		     the bottom of the scrollport while the fields and body scroll under it. The sheet ends where
		     the keyboard begins, so that bottom edge is the top of the keyboard. -->
		<template #bottom>
			<ComposeMailToolbar
				:is-recipients-empty
				class="border-t"
				:class="[
					isDragging ? 'border-transparent' : '',
					// Same bleed as the field block above, so both rules span the same width.
					isInThread ? 'sm:-mx-5 sm:px-5' : 'sm:-mx-6 sm:px-6',
				]"
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
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
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
	Progress,
	TextEditor,
	Tooltip,
	useFileUpload,
} from 'frappe-ui'

import { formatBytes, isOverlayPresent, raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { useComposeMail } from '@/apps/mail/composables/useComposeMail'
import {
	CustomImageExtension,
	CustomParagraphExtension,
	uploadFunction,
} from '@/apps/mail/utils/text-editor'
import ComposeMailToolbar from '@/apps/mail/components/ComposeMailToolbar.vue'

import type { Attachment, ComposeMailData, File as FileDoc, Identity } from '@/apps/mail/types'

import RecipientInput from './Controls/RecipientInput.vue'
import ContactsModal from './Modals/ContactsModal.vue'
import ScheduleSendModal from './Modals/ScheduleSendModal.vue'

const show = defineModel<boolean>()

const {
	reloadMails,
	mailDetails,
	isInThread = false,
	docked = false,
} = defineProps<{
	reloadMails: () => void
	mailDetails?: ComposeMailData
	isInThread?: boolean
	// Docked composer: shorter than a modal, which has the screen to itself.
	docked?: boolean
}>()

const emit = defineEmits(['discardMail', 'discardStarted', 'reply', 'replyAll', 'forward', 'popOut'])

const { isMobile } = useScreenSize()

const textEditor = useTemplateRef('textEditor')
const toInput = useTemplateRef('toInput')
const ccInput = useTemplateRef('ccInput')
const subjectInput = useTemplateRef<HTMLInputElement>('subjectInput')

// What the composition *is* — draft state, autosave, send, schedule, discard, attachments, mentions
// — lives in the composable, shared with the phone composer (ComposeView). Only what is particular
// to this dialog stays here: the contact picker, drag-and-drop, and the in-thread draft actions.
const {
	mail,
	identities,
	isLoading,
	isDraftUpdated,
	isRecipientsEmpty,
	updateOriginalMail,
	saveDraft,
	sendMail,
	discardMail,
	onClosed,
	showScheduleModal,
	openScheduleModal,
	scheduleSend,
	openQuotedContent,
	openAttachment,
	mentionExtensions,
	appendEmoji,
	editorContent,
	onEditorChange,
} = useComposeMail({
	mailDetails,
	isInThread,
	reloadMails,
	close: () => (show.value = false),
	isOpen: () => !!show.value,
	onDiscardUnsaved: () => emit('discardMail'),
	onDiscardStarted: () => emit('discardStarted'),
	host: () => textEditor.value,
	// The dialog holds the rest of the page inert, so the mention dropdown has to render inside it
	// rather than at <body>, where it would be unreachable.
	mentionContainer: () =>
		(textEditor.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>('[role="dialog"]') ??
		null,
})

// The composer stays mounted when it closes, so the in-flight flags have to be cleared on the way out.
watch(show, (open) => !open && onClosed())

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

// Start where there is still something to write: the body on a reply (recipients and subject come
// with the thread), the subject when the draft arrived addressed but unnamed — a `mailto:` link, or
// a calendar invite's participants — and the To field otherwise. The delay is the dialog's: focusing
// during its transition doesn't take.
onMounted(() => {
	updateOriginalMail()
	if (mailDetails?.in_reply_to) return textEditor.value.editor.commands.focus()

	// Deferred, and the choice made from inside: TextEditor renders nothing until it has built its
	// editor on its own mounted hook, so neither field exists yet at this point.
	setTimeout(() => {
		if (!isRecipientsEmpty.value && !mail.subject && subjectInput.value) subjectInput.value.focus()
		else toInput.value?.setFocus()
	}, 50)
})

onUnmounted(() => saveDraft())

// `mail` is exposed so the window around this one can read the draft — the minimised bar names
// itself after the subject, which only exists in here.
defineExpose({ mail, sendMail, discardMail, openScheduleModal })

// Local draft actions

const localDraftActions = computed(() => [
	{
		group: '',
		items: [
			{ label: __('Reply'), icon: Reply, onClick: () => emit('reply') },
			{ label: __('Reply All'), icon: ReplyAll, onClick: () => emit('replyAll') },
			{ label: __('Forward'), icon: Forward, onClick: () => emit('forward') },
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
