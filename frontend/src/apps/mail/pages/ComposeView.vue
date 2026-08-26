<template>
	<!--
	  Mobile compose: a header pinned to the top, and one scrolling region filling everything from
	  under it down to the keyboard. Nothing else.

	  The page is `fixed` and sized to the *visible* area rather than left in flow, because in flow it
	  could be moved by things it doesn't control — the suite shell's `<main>` is itself a scroller,
	  and iOS pans the visible area to reveal a focused field. Either one carried the header off the
	  top of the screen. `sticky` on the header couldn't help: it resolves against `<main>` and rides
	  up out of it too. `100dvh` can't size this either — dvh answers to browser chrome, not to the
	  keyboard — so the height is measured.

	  `top` follows how far iOS has panned, so the page lands back on the visible area once a pan
	  settles; without it the header ends up under the status bar and stays there.

	  Being fixed is what made the old compose sheet pan in the first place, but only because there
	  was nothing inside it for iOS to scroll instead. There is now — and `focusWithoutReveal` below
	  takes focus into its own hands so iOS never starts the pan to begin with.
	-->
	<div
		class="bg-surface-base fixed inset-x-0 z-30 flex flex-col overflow-hidden"
		:style="{ top: `${keyboardTop}px`, height: `${viewportHeight}px` }"
	>
		<header
			class="bg-surface-base z-20 flex shrink-0 items-center gap-1 border-b pb-2.5 pl-2 pr-4 pt-[calc(env(safe-area-inset-top)+0.875rem)]"
		>
			<Button variant="ghost" :label="__('Close')" @click="closeCompose">
				<template #icon>
					<X class="text-ink-gray-5 size-5" />
				</template>
			</Button>
			<h2 class="text-ink-gray-8 flex-1 text-base font-medium">{{ __('Compose Mail') }}</h2>
			<AdaptiveDropdown :options="ACTIONS">
				<Button variant="ghost" :label="__('More actions')">
					<template #icon>
						<EllipsisVertical class="text-ink-gray-5 size-5" />
					</template>
				</Button>
			</AdaptiveDropdown>
			<Button
				variant="ghost"
				class="ml-2"
				:label="__('Send')"
				:disabled="isRecipientsEmpty || isUploading"
				@click="sendMail()"
			>
				<template #icon>
					<SendHorizontal class="text-ink-gray-5 size-5" />
				</template>
			</Button>
		</header>

		<!-- flex-1 so the body claims the rest of the page: a tap anywhere in the empty space below
		     the last line lands in the message, which is where someone tapping there meant to type. -->
		<TextEditor
			ref="textEditor"
			editor-class="prose-sm max-w-none [&_ol]:ps-7 [&_ul]:ps-7"
			:extensions="[imageExtension, CustomParagraphExtension, ...mentionExtensions]"
			:content="editorContent"
			:upload-function="uploadInlineImage"
			class="flex min-h-0 flex-1 flex-col"
			@change="onEditorChange"
		>
			<!--
			  The one scrolling region: fields and body as a single column, so they move together and
			  the recipients scroll away to make room once you're writing. It runs to the bottom of the
			  page, which is the top of the keyboard.
			-->
			<template #editor="{ editor }">
				<div
					ref="scroller"
					class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
					@pointerdown="focusWithoutReveal"
					@focusin="onFocusIn"
				>
					<!-- Each row is a label + control on one line, tap target spanning the full width —
					     on a phone the label is a hit area, not decoration. Stopped, so tapping a field
					     doesn't also run the body's focus-at-end below. -->
					<!-- `border-b` as well as `divide-y`: divide-y only draws between the rows, leaving
					     the subject running straight into the message with no line between them. -->
					<div class="flex flex-col divide-y border-b" @click.stop>
						<div class="flex min-h-13 items-center gap-2 px-4 py-2">
							<span class="text-ink-gray-4 shrink-0 text-sm">{{ __('From') }}</span>
							<!-- Button trigger, not the default input one: you pick an identity here, you don't
							     type one. It also makes the control content-sized — a text input carries a
							     fixed intrinsic width of its own, so sizing to content around one cut the
							     address off rather than fitting it. min-w-0 keeps a long address shrinking
							     inside the row instead of pushing it wide. -->
							<Combobox
								v-model="mail.from_email"
								:options="identityOptions"
								trigger="button"
								class="min-w-0"
							/>
						</div>

						<!-- Each recipient row is a column: the field on top, and under it the target the
						     input teleports its suggestions into. That target spans the row rather than
						     the field, which is what lets the list reach both edges of the page. -->
						<div class="flex flex-col">
							<!-- items-start, so a wrapped recipient list grows downwards past a label that
							     stays on the first line. py-3 rather than the other rows' py-2 keeps the
							     single-line height at min-h-13 without centring doing it. The label centres
							     itself against a chip's height, not its own line box. -->
							<div class="flex min-h-13 items-start gap-2 px-4 py-3">
								<span class="text-ink-gray-4 flex min-h-7 shrink-0 items-center text-sm">{{
									__('To')
								}}</span>
								<RecipientInput
									ref="toInput"
									v-model="mail.to"
									:suggestions-to="toSuggestions"
									class="min-w-0 flex-1"
								/>
								<Button variant="ghost" :label="__('Cc and Bcc')" @click="showCcBcc = !showCcBcc">
									<template #icon>
										<component
											:is="showCcBcc ? ChevronUp : ChevronDown"
											class="text-ink-gray-5 h-4 w-4"
										/>
									</template>
								</Button>
							</div>
							<div ref="toSuggestions" />
						</div>

						<template v-if="showCcBcc">
							<div class="flex flex-col">
								<div class="flex min-h-13 items-start gap-2 px-4 py-3">
									<span class="text-ink-gray-4 flex min-h-7 shrink-0 items-center text-sm">{{
										__('Cc')
									}}</span>
									<RecipientInput
										ref="ccInput"
										v-model="mail.cc"
										:suggestions-to="ccSuggestions"
										class="min-w-0 flex-1"
									/>
								</div>
								<div ref="ccSuggestions" />
							</div>
							<div class="flex flex-col">
								<div class="flex min-h-13 items-start gap-2 px-4 py-3">
									<span class="text-ink-gray-4 flex min-h-7 shrink-0 items-center text-sm">{{
										__('Bcc')
									}}</span>
									<RecipientInput
										v-model="mail.bcc"
										:suggestions-to="bccSuggestions"
										class="min-w-0 flex-1"
									/>
								</div>
								<div ref="bccSuggestions" />
							</div>
						</template>

						<label class="flex min-h-13 cursor-text items-center gap-2 px-4 py-2">
							<span class="text-ink-gray-4 shrink-0 text-sm">{{ __('Subject') }}</span>
							<input
								ref="subjectInput"
								v-model="mail.subject"
								class="text-ink-gray-8 min-w-0 flex-1 border-none bg-inherit p-0 text-base focus-visible:!ring-0"
							/>
						</label>
					</div>

					<!-- flex-1 so the body claims the rest of the scroller: a tap anywhere in the empty
					     space below the last line lands in the message. -->
					<div
						class="flex flex-1 cursor-text flex-col px-4 py-3 text-sm"
						@click="editor.commands.focus('end')"
					>
						<!-- Stopped here, or the wrapper's focus('end') would fire for taps on the text
						     as well and yank the caret to the last line every time. Only taps on the
						     empty space around the message mean "start typing at the end". -->
						<EditorContent :editor @click.stop />

						<div class="mt-auto cursor-default space-y-2.5 pt-2.5" @click.stop>
							<Button
								v-if="mail.quoted_content"
								label="&middot;&middot;&middot;"
								class="max-h-4 w-fit"
								@click="openQuotedContent"
							/>

							<a
								v-for="(file, index) in attachments"
								:key="index"
								class="bg-surface-gray-2 text-ink-gray-6 flex cursor-pointer items-center rounded-4 p-2.5"
								:href="file.file_url"
								target="_blank"
								@click="openAttachment(file.blob_id, file.type)"
							>
								<span class="mr-1 truncate font-medium">
									{{ file.file_name || file.filename || file.name }}
								</span>
								<span class="mr-1 shrink-0 font-extralight">
									({{ formatBytes(file.file_size || file.size) }})
								</span>
								<FeatherIcon
									class="ml-auto h-3.5 w-3.5 shrink-0"
									name="x"
									@click.stop.prevent="removeAttachment(index)"
								/>
							</a>
						</div>
					</div>
				</div>
			</template>
			<!--
			  The formatting toolbar, last in the column and `shrink-0`, so it sits on the page's bottom
			  edge — and that edge is the top of the keyboard, since the page is sized to the visible
			  area. No sticky, no fixed, no measuring: it is simply the last thing in the box.

			  It lives in #bottom because TextEditorFixedMenu reaches for the editor its parent
			  TextEditor provides, and outside the scroller above so the scrollbar stops at it rather
			  than running on underneath.
			-->
			<template #bottom>
				<div
					v-if="isBodyFocused"
					class="bg-surface-base z-20 shrink-0 border-t pb-[env(safe-area-inset-bottom)]"
				>
					<!-- The formatting buttons come from frappe-ui's TextEditorMenu at desktop scale: a
					     16px icon in 4px of padding, a 24px target for a thumb. Sized up from here with
					     arbitrary variants, the markup being the menu's rather than ours — and on this
					     row only, so the same menu keeps its desktop size in the composer dialog.

					     `items-center` is not optional once the buttons are taller than their contents:
					     the menu's buttons are `flex` with no cross-axis alignment, so the default
					     stretch left everything sitting at the top of the new height. It showed worst on
					     H₂, which is text rather than an icon and so a different height again. -->
					<div
						class="flex items-center gap-1 overflow-x-auto px-2 py-1 [&_button]:min-h-9 [&_button]:min-w-9 [&_button]:items-center [&_button]:justify-center [&_svg]:size-4"
					>
						<TextEditorFixedMenu :buttons class="!bg-inherit" />
						<Button variant="ghost" :label="__('Attach files')" @click="fileInput?.click()">
							<template #icon>
								<Paperclip class="icon" />
							</template>
						</Button>
						<input
							ref="fileInput"
							type="file"
							class="hidden"
							multiple
							@change="onFilesSelected"
						/>
					</div>
				</div>
			</template>
		</TextEditor>

		<ScheduleSendModal v-model="showScheduleModal" @confirm="scheduleSend" />
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { EditorContent } from '@tiptap/vue-3'
import {
	CalendarClock, ChevronDown, ChevronUp, EllipsisVertical, Paperclip, SendHorizontal, Trash2, X, } from 'lucide-vue-next'
import { Button, Combobox } from 'frappe-ui'
import { Icon as FeatherIcon, TextEditor, TextEditorFixedMenu } from 'frappe-ui/experimental'

import { formatBytes, raiseToast } from '@/apps/mail/utils'
import { useKeyboardInsets, useTextEditorButtons } from '@/apps/mail/utils/composables'
import { CustomImageExtension, CustomParagraphExtension, uploadFunction } from '@/apps/mail/utils/text-editor'
import { takePendingCompose } from '@/apps/mail/composables/composeHandoff'
import { useComposeMail } from '@/apps/mail/composables/useComposeMail'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import RecipientInput from '@/apps/mail/components/Controls/RecipientInput.vue'
import ScheduleSendModal from '@/apps/mail/components/Modals/ScheduleSendModal.vue'

import type { Attachment, Identity } from '@/apps/mail/types'

const router = useRouter()

const textEditor = useTemplateRef<{ $el?: HTMLElement; editor?: any }>('textEditor')
const toInput = useTemplateRef<{ setFocus: () => void }>('toInput')
const ccInput = useTemplateRef<{ setFocus: () => void }>('ccInput')
const subjectInput = useTemplateRef<HTMLInputElement>('subjectInput')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const scroller = useTemplateRef<HTMLElement>('scroller')
const pendingUploads = ref(0)
const isUploading = computed(() => pendingUploads.value > 0)

const uploadInlineImage = async (file: File) => {
	pendingUploads.value++
	try {
		return await uploadFunction(file)
	} finally {
		pendingUploads.value--
	}
}
const imageExtension = CustomImageExtension.configure({ uploadFunction: uploadInlineImage })

// Where each recipient input teleports its suggestion list, so the list spans the page rather than
// the field's own column.
const toSuggestions = useTemplateRef<HTMLElement>('toSuggestions')
const ccSuggestions = useTemplateRef<HTMLElement>('ccSuggestions')
const bccSuggestions = useTemplateRef<HTMLElement>('bccSuggestions')

const mailDetails = takePendingCompose()

// Leaving the page IS closing the composer, so both the header's close button and the system back
// gesture land in the same place. `leaving` stops the guard from bouncing the programmatic pop.
let leaving = false
const closeCompose = () => {
	if (leaving) return
	leaving = true
	router.back()
}

const {
	mail,
	identities,
	isRecipientsEmpty,
	saveDraft,
	sendMail,
	discardMail,
	showScheduleModal,
	openScheduleModal,
	scheduleSend,
	openQuotedContent,
	openAttachment,
	mentionExtensions,
	editorContent,
	onEditorChange,
	updateOriginalMail,
} = useComposeMail({
	mailDetails,
	reloadMails: () => {},
	close: closeCompose,
	// The page is the composer, so it is open right up until the route leaves.
	isOpen: () => !leaving,
	host: () => textEditor.value,
	isUploading: () => isUploading.value,
})

const { height: viewportHeight, top: keyboardTop } = useKeyboardInsets()

// Hold the document still for as long as this page is open.
//
// This is what the bouncing was. iOS implements its keyboard "pan" as an ordinary document scroll —
// `window.scrollY` goes non-zero — and `visualViewport.offsetTop` reports the same number. So two
// things moved at once on every focus change: the document scrolled up, and this page, chasing
// `offsetTop`, was pushed down by exactly as much. A document that cannot scroll has neither.
//
// `position: fixed` as well as `overflow: hidden`, because overflow alone still leaves iOS a document
// to scroll for a focused field.
onMounted(() => {
	const { style } = document.body
	style.overflow = 'hidden'
	style.position = 'fixed'
	style.width = '100%'
	document.documentElement.style.overflow = 'hidden'
})

onUnmounted(() => {
	const { style } = document.body
	style.overflow = ''
	style.position = ''
	style.width = ''
	document.documentElement.style.overflow = ''
})

/**
 * Do the focusing ourselves, so it can be done without a reveal.
 *
 * Moving between the body and the fields bounced the whole screen. iOS reveals a newly focused field
 * by scrolling it into view, and it cannot scroll a `position: fixed` container — so it pans the
 * visible area instead, and the page lurches and settles back. Chasing that pan is hopeless: JS only
 * hears about it once it has started.
 *
 * `preventScroll` is the opt-out built for this, but the browser only honours it on a focus *we*
 * call. So take the tap: stop the default focus, place the caret where the tap landed, and focus with
 * the reveal turned off. `revealFocused` still runs afterwards and does the scrolling itself, in the
 * scroller, where it costs nothing.
 */
const focusWithoutReveal = (event: PointerEvent) => {
	const target = event.target as HTMLElement | null
	const editor = textEditor.value?.editor
	const body = editor?.view?.dom as HTMLElement | undefined

	// The body: place the caret from the tap's own coordinates, since preventing the default is what
	// would otherwise have done it.
	if (body && target && body.contains(target)) {
		const pos = editor!.view.posAtCoords({ left: event.clientX, top: event.clientY })
		if (!pos) return

		event.preventDefault()
		editor!.commands.setTextSelection(pos.pos)
		body.focus({ preventScroll: true })
		return
	}

	// A field. Anything with its own caret placement (a tap partway along existing text) is left to
	// the browser — only an unfocused field is taken over, which is the case that pans.
	const field = target?.closest?.('input, textarea')
	if (!(field instanceof HTMLElement) || field === document.activeElement) return

	event.preventDefault()
	field.focus({ preventScroll: true })
}

/**
 * The formatting toolbar belongs to the message, so it only appears while the message has focus —
 * it is noise (and lost height) while someone is filling in recipients.
 *
 * Deliberately not "focus left the body": tapping a toolbar button takes focus out of the editor for
 * an instant, and hiding the bar out from under the finger would make it unusable. Only moving to one
 * of the *fields* puts it away.
 */
const isBodyFocused = ref(false)

const onFocusIn = (event: FocusEvent) => {
	const node = event.target as HTMLElement | null
	const body = textEditor.value?.editor?.view?.dom as HTMLElement | undefined

	if (body && node && body.contains(node)) isBodyFocused.value = true
	else if (node?.closest?.('input, textarea')) isBodyFocused.value = false

	revealFocused(event)
}

// Pre-empt iOS's focus reveal.
//
// When focus lands on a field it thinks the keyboard covers, iOS brings it into view — and if it
// can't find a scroller to do that with, it pans the visible area up the page instead. The page is
// exactly as tall as that visible area, so a pan carries its bottom edge up with it and the toolbar
// ends up floating above the keyboard with a white gap under it.
//
// Bringing the focused field comfortably into view ourselves, in our own scroller and synchronously
// as focus arrives, leaves iOS with nothing to reveal and so no reason to pan.
const revealFocused = (event: FocusEvent) => {
	const box = scroller.value
	const node = event.target as HTMLElement | null
	if (!box || !node) return

	// The body's element spans the whole composition, so its box says nothing about where the caret
	// is; ask ProseMirror. Every other field is small enough to use its own.
	const editor = textEditor.value?.editor
	const rect =
		editor && node === editor.view?.dom
			? editor.view.coordsAtPos(editor.state.selection.head)
			: node.getBoundingClientRect()

	const view = box.getBoundingClientRect()
	const margin = 24

	if (rect.bottom > view.bottom - margin) box.scrollTop += rect.bottom - view.bottom + margin
	else if (rect.top < view.top + margin) box.scrollTop -= view.top + margin - rect.top
}
const { buttons } = useTextEditorButtons()

const identityOptions = computed(
	() =>
		identities.value.data?.map((i: Identity) => ({
			label: `${i._name} <${i.email}>`,
			value: i.email,
		})) ?? [],
)

const showCcBcc = ref(!!mailDetails?.cc?.length || !!mailDetails?.bcc?.length)
watch(showCcBcc, (open) => open && nextTick(() => ccInput.value?.setFocus()))

const attachments = computed(() =>
	mail.attachments.filter((file: Attachment) => file.disposition === 'attachment'),
)

const removeAttachment = (index: number) => {
	const file = attachments.value[index]
	mail.attachments.splice(mail.attachments.indexOf(file), 1)
}

const onFilesSelected = async (e: Event) => {
	const input = e.target as HTMLInputElement
	const files = Array.from(input.files ?? [])
	input.value = ''

	for (const file of files) {
		pendingUploads.value++
		try {
			const doc = await uploadFunction(file)
			mail.attachments.push({ ...doc, disposition: 'attachment' } as Attachment)
		} catch (error) {
			raiseToast((error as Error)?.message ?? __('Could not attach {0}.', [file.name]), 'error')
		} finally {
			pendingUploads.value--
		}
	}
}

const ACTIONS = [
	{ label: __('Schedule send'), onClick: () => openScheduleModal(), icon: CalendarClock },
	{ label: __('Discard'), onClick: () => discardMail(), icon: Trash2, theme: 'red' },
]

// Start where there is still something to write: the body on a reply (recipients and subject came
// with the thread), the subject when the draft arrived addressed but unnamed (a `mailto:` link, or a
// calendar invite's participants), and To otherwise.
onMounted(() => {
	updateOriginalMail()

	// Deferred: TextEditor renders nothing until it has built its editor on its own mounted hook, so
	// none of these exist yet at this point.
	nextTick(() => {
		if (mailDetails?.in_reply_to) textEditor.value?.editor?.commands.focus()
		else if (!isRecipientsEmpty.value && !mail.subject) subjectInput.value?.focus()
		else toInput.value?.setFocus()
	})
})

// Navigating away is the only way off this page, so this is where an unsent message gets kept.
onBeforeRouteLeave(() => {
	leaving = true
	saveDraft()
})

onUnmounted(() => saveDraft())
</script>
