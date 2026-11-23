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
  <!-- Locked while a send is out, as the desktop composer is: what is typed then is in no request. -->
  <div
    ref="composerRoot"
    class="bg-surface-base fixed inset-x-0 z-30 flex flex-col overflow-hidden"
    :style="{ top: `${keyboardTop}px`, height: `${viewportHeight}px` }"
    :inert="isSending || undefined"
  >
    <header
      class="bg-surface-base z-20 flex shrink-0 items-center gap-1 border-b pb-2.5 pl-2 pr-4 pt-[calc(env(safe-area-inset-top)+0.875rem)]"
    >
      <Button variant="ghost" class="touch-target" :label="__('Close')" @click="closeCompose">
        <template #icon>
          <X class="text-ink-gray-5 size-5" />
        </template>
      </Button>
      <!-- The subject, or until there is one what the page is for: New message, Reply, Forward. -->
      <h2 class="text-ink-gray-8 min-w-0 flex-1 truncate text-base font-medium">{{ title }}</h2>
      <!-- Each of the header's controls takes the touch target, or a neighbour's covers it. -->
      <Button
        v-if="isSaveFailed"
        variant="ghost"
        theme="red"
        class="touch-target"
        :label="__('Not saved · Retry')"
        @click="saveDraft()"
      />
      <AdaptiveDropdown :options="ACTIONS">
        <Button variant="ghost" class="touch-target" :label="__('More actions')">
          <template #icon>
            <span class="lucide-ellipsis text-ink-gray-5 size-5" aria-hidden="true" />
          </template>
        </Button>
      </AdaptiveDropdown>
    </header>
    <ReplyReminderStrip
      v-if="remindAt"
      class="mt-2 shrink-0"
      :remind-at="remindAt"
      @change="setRemindAt"
      @cancel="setRemindAt()"
    />

    <!-- flex-1 so the body claims the rest of the page: a tap anywhere in the empty space below
		     the last line lands in the message, which is where someone tapping there meant to type. -->
    <div class="relative flex min-h-0 w-full flex-1 flex-col" :class="{ 'opacity-50': isSending }">
      <Editor
        ref="textEditor"
        :model-value="editorContent"
        :extensions="editorExtensions"
        :upload-function="uploadInlineImage"
        @change="onEditorChange"
      >
        <template #default="{ editor }">
          <!--
			  The one scrolling region: fields and body as a single column, so they move together and
			  the recipients scroll away to make room once you're writing. It runs to the bottom of the
			  page, which is the top of the keyboard.
			-->
          <div
            ref="scroller"
            class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
            @pointerdown="focusWithoutReveal"
            @focusin="onFocusIn"
          >
            <!-- Each row is a label + control on one line, tap target spanning the full width —
					     on a phone the label is a hit area, not decoration. Stopped, so tapping a field
					     doesn't also run the body's focus-at-end below. The labels stand in a column of one
					     width, as the desktop composer's do, so the values line up; From's pill is pulled
					     back by its own padding, as there, so its text starts on the same line. -->
            <!-- `border-b` as well as `divide-y`: divide-y only draws between the rows, leaving
					     the subject running straight into the message with no line between them. -->
            <div class="flex flex-col divide-y border-b" @click.stop>
              <div class="flex min-h-13 items-center gap-2 px-4 py-2">
                <span class="text-ink-gray-5 flex h-7 w-10 shrink-0 items-center text-base">{{
                  __('From')
                }}</span>
                <!-- Button trigger, not the default input one: you pick an identity here, you don't
							     type one. It also makes the control content-sized — a text input carries a
							     fixed intrinsic width of its own, so sizing to content around one cut the
							     address off rather than fitting it. min-w-0 keeps a long address shrinking
							     inside the row instead of pushing it wide. -->
                <!-- Ink to match the recipient chips below: frappe-ui's button trigger carries
							     text-ink-gray-7, a shade softer than a field's value (its own inputs use
							     gray-8), and From reads as one of the addresses on the mail, not as chrome. -->
                <Combobox
                  v-model="mail.from_email"
                  :options="identityOptions"
                  trigger="button"
                  class="-ml-[9px] min-w-0 !text-ink-gray-8"
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
                  <span class="text-ink-gray-5 flex min-h-7 w-10 shrink-0 items-center text-base">{{
                    __('To')
                  }}</span>
                  <RecipientInput
                    ref="toInput"
                    v-model="mail.to"
                    field="to"
                    :suggestions-to="toSuggestions"
                    class="min-w-0 flex-1"
                    @move="moveRecipient"
                    @show-cc-bcc="showCcBcc = true"
                  />
                  <Button
                    variant="ghost"
                    class="touch-target"
                    :label="__('Cc and Bcc')"
                    @click="showCcBcc = !showCcBcc"
                  >
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
                    <span
                      class="text-ink-gray-5 flex min-h-7 w-10 shrink-0 items-center text-base"
                      >{{ __('Cc') }}</span
                    >
                    <RecipientInput
                      ref="ccInput"
                      v-model="mail.cc"
                      field="cc"
                      :suggestions-to="ccSuggestions"
                      class="min-w-0 flex-1"
                      @move="moveRecipient"
                      @show-cc-bcc="showCcBcc = true"
                    />
                  </div>
                  <div ref="ccSuggestions" />
                </div>
                <div class="flex flex-col">
                  <div class="flex min-h-13 items-start gap-2 px-4 py-3">
                    <span
                      class="text-ink-gray-5 flex min-h-7 w-10 shrink-0 items-center text-base"
                      >{{ __('Bcc') }}</span
                    >
                    <RecipientInput
                      v-model="mail.bcc"
                      field="bcc"
                      :suggestions-to="bccSuggestions"
                      class="min-w-0 flex-1"
                      @move="moveRecipient"
                      @show-cc-bcc="showCcBcc = true"
                    />
                  </div>
                  <div ref="bccSuggestions" />
                </div>
              </template>

              <!-- A placeholder, as in the desktop composer: once there is a subject it speaks for
							     itself. Still a label around it, so the whole row is the tap target. -->
              <label class="flex min-h-13 cursor-text items-center px-4 py-2">
                <input
                  ref="subjectInput"
                  v-model="mail.subject"
                  :placeholder="__('Subject')"
                  :aria-label="__('Subject')"
                  class="text-ink-gray-8 placeholder:text-ink-gray-4 min-w-0 flex-1 border-none bg-inherit p-0 text-base focus-visible:!ring-0"
                />
              </label>
            </div>

            <!-- flex-1 so the body claims the rest of the scroller: a tap anywhere in the empty
					     space below the last line lands in the message. -->
            <div
              class="flex flex-1 cursor-text flex-col px-4 py-3 text-sm"
              @click="editor?.commands.focus('end')"
            >
              <!-- Stopped here, or the wrapper's focus('end') would fire for taps on the text
						     as well and yank the caret to the last line every time. Only taps on the
						     empty space around the message mean "start typing at the end". -->
              <EditorContent
                :editor
                class="prose-sm max-w-none [&_ol]:ps-7 [&_ul]:ps-7 [&_[contenteditable=true]]:outline-none"
                @click.stop
              />

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
                  <X
                    class="ml-auto size-3.5 shrink-0"
                    :aria-label="__('Remove')"
                    @click.stop.prevent="removeAttachment(index)"
                  />
                </a>
              </div>
            </div>
          </div>
          <!--
			  The desktop toolbar as the list's floating bar: its tools in an island, and Send a round
			  button beside it, in the thumb zone. Last in the column and `shrink-0`, so it sits on the
			  page's bottom edge — and that edge is the top of the keyboard, since the page is sized to
			  the visible area. No sticky, no fixed, no measuring: it is simply the last thing in the box.

			  It sits outside the scroller above so the scrollbar stops at it rather than running on
			  underneath, and the caret is never behind it.

			  The safe-area padding is for the home indicator, at the screen's bottom edge. The
			  installed app keeps reporting that inset with the keyboard up, when the bar is nowhere
			  near the edge, so what the keyboard covers comes off it.

			  A tap on it leaves the focus where it was, so the body keeps its caret and the keyboard stays
			  up while a format is picked. Taking the focus closed the keyboard on every tap.
			-->
          <div
            class="z-20 flex shrink-0 items-center gap-2 px-3.5 pt-2"
            :style="{
              paddingBottom: `calc(0.75rem + max(0px, env(safe-area-inset-bottom) - ${keyboardBottom}px))`,
            }"
            @mousedown.prevent
          >
            <!-- One row of tools, or behind Formatting the formatting, never both: the two together are
					     wider than a phone. The editor's buttons come from frappe-ui's menu at desktop scale,
					     a 24px target for a thumb, so the row sizes every button up with arbitrary variants,
					     the markup being the menu's rather than ours. -->
            <div
              class="bg-surface-elevation-2 flex h-14 min-w-0 flex-1 items-center gap-1 rounded-full border p-1.5 shadow-xl [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-full [&_span[class*=lucide-]]:size-5"
            >
              <Button
                variant="ghost"
                class="shrink-0"
                :class="{ '!bg-surface-gray-3': formatting }"
                :label="__('Formatting')"
                :aria-pressed="formatting"
                @click="formatting = !formatting"
              >
                <template #icon>
                  <span class="lucide-a-large-small" aria-hidden="true" />
                </template>
              </Button>
              <div
                class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
              >
                <EditorFixedMenu v-if="formatting" :items="formatMenu" class="shrink-0" />
                <template v-else>
                  <ComposeAttachMenu
                    @select-files="onFilesSelected"
                    @attach-from-drive="attachFromDrive"
                  >
                    <Button variant="ghost" class="shrink-0" :label="__('Attach')">
                      <template #icon>
                        <span class="lucide-paperclip" aria-hidden="true" />
                      </template>
                    </Button>
                  </ComposeAttachMenu>
                  <EditorFixedMenu :items="INSERTS" class="shrink-0" />
                  <!-- A sending option, not something put into the mail: at the end, beside Send, as
                       it stands beside Send on desktop. -->
                  <span class="flex-1" />
                  <ComposeReminderButton :remind-at @remind="setRemindAt" @clear="setRemindAt()" />
                </template>
              </div>
            </div>
            <Button
              variant="solid"
              class="!h-14 !w-14 shrink-0 !rounded-full shadow-xl"
              :label="__('Send')"
              :disabled="isRecipientsEmpty || isUploading"
              :loading="isSending"
              @click="sendMail()"
            >
              <template #icon>
                <span class="lucide-send-horizontal size-6" aria-hidden="true" />
              </template>
            </Button>
          </div>
        </template>
      </Editor>
    </div>

    <ScheduleSendModal v-model="showScheduleModal" :save="scheduleSend" />
  </div>
</template>

<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { Button, Combobox } from 'frappe-ui'
import {
  Editor,
  EditorContent,
  EditorFixedMenu,
  InsertImage,
  InsertLink,
  Separator,
  type MenuItem,
} from 'frappe-ui/editor'
import { CalendarClock, ChevronDown, ChevronUp, Trash2, X } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'

import ComposeAttachMenu from '@/apps/mail/components/ComposeAttachMenu.vue'
import ComposeReminderButton from '@/apps/mail/components/ComposeReminderButton.vue'
import RecipientInput from '@/apps/mail/components/Controls/RecipientInput.vue'
import ScheduleSendModal from '@/apps/mail/components/Modals/ScheduleSendModal.vue'
import ReplyReminderStrip from '@/apps/mail/components/ReplyReminderStrip.vue'
import { takePendingCompose } from '@/apps/mail/composables/composeHandoff'
import { useComposeMail } from '@/apps/mail/composables/useComposeMail'
import { useThreadReload } from '@/apps/mail/composables/useThreadReload'
import type { Attachment, Identity } from '@/apps/mail/types'
import { formatBytes, raiseToast } from '@/apps/mail/utils'
import { composeName } from '@/apps/mail/utils/composeName'
import { useEditorMenu } from '@/apps/mail/utils/editorMenu'
import { uploadFunction } from '@/apps/mail/utils/text-editor'
import { useKeyboardInsets } from '@/composables/useKeyboardInsets'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'
import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

const router = useRouter()

const composerRoot = useTemplateRef<HTMLElement>('composerRoot')
const textEditor = useTemplateRef('textEditor')
const toInput = useTemplateRef<{ setFocus: () => void }>('toInput')
const ccInput = useTemplateRef<{ setFocus: () => void }>('ccInput')
const subjectInput = useTemplateRef<HTMLInputElement>('subjectInput')
const scroller = useTemplateRef<HTMLElement>('scroller')
const pendingUploads = ref(0)

const uploadInlineImage = async (file: File) => {
  pendingUploads.value++
  try {
    return await uploadFunction(file)
  } finally {
    pendingUploads.value--
  }
}

// Where each recipient input teleports its suggestion list, so the list spans the page rather than
// the field's own column.
const toSuggestions = useTemplateRef<HTMLElement>('toSuggestions')
const ccSuggestions = useTemplateRef<HTMLElement>('ccSuggestions')
const bccSuggestions = useTemplateRef<HTMLElement>('bccSuggestions')

const mailDetails = takePendingCompose()
const { requestThreadReload } = useThreadReload()

// The thread the page goes back to, when it was opened from one: what the reader sees once the mail
// is sent. Read from the history entry, as the page leaves by going back to it.
const { back } = router.options.history.state
const returnsToThread = typeof back === 'string' ? router.resolve(back).params.threadID : undefined

// Leaving the page IS closing the composer, so both the header's close button and the system back
// gesture land in the same place. `leaving` stops the guard from bouncing the programmatic pop.
let leaving = false
const closeCompose = () => {
  if (leaving) return
  leaving = true
  router.back()
}
// The composer closes the page itself once the mail is sent or discarded. Any other way off it is
// the reader leaving.
let closedByComposer = false

const {
  mail,
  identities,
  isRecipientsEmpty,
  moveRecipient,
  saveDraft,
  isSaveFailed,
  sendMail,
  isSending,
  discardMail,
  isUntouched,
  showScheduleModal,
  openScheduleModal,
  scheduleSend,
  remindAt,
  setRemindAt,
  openQuotedContent,
  openAttachment,
  attachFile,
  attachFromDrive,
  isUploading,
  editorExtensions,
  editorContent,
  onEditorChange,
  onOpened,
} = useComposeMail({
  mailDetails,
  // What changed reaches the thread the page goes back to: the sent reply in place of its draft, a
  // draft saved, a send undone. The thread is off screen meanwhile, so it takes this when it is back.
  reloadMails: () => {
    if (typeof returnsToThread === 'string') requestThreadReload(returnsToThread)
  },
  shownThread: () => (typeof returnsToThread === 'string' ? returnsToThread : undefined),
  close: () => {
    closedByComposer = true
    closeCompose()
  },
  // The page is the composer, so it is open right up until the route leaves.
  isOpen: () => !leaving,
  host: () => textEditor.value,
  root: () => composerRoot.value,
  isUploading: () => pendingUploads.value > 0,
  uploadInlineImage,
})

const { height: viewportHeight, top: keyboardTop, bottom: keyboardBottom } = useKeyboardInsets()

// The subject once there is one, as iOS Mail's header and desktop's folded window do: the fields
// scroll away while the body is written, and this is what still says which mail it is. Until then,
// what the page is for.
const title = computed(() => mail.subject?.trim() || composeName(mailDetails))

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

// The document scrolls all the same while the keyboard is up: iOS lengthens it by the keyboard's
// height, fixed body or not. A drag that nothing under the finger can take (on the header, on the
// island, or on a body too short to scroll) went on to the document. The page chased it, Safari's
// own bar changed height as it went, and the island was left standing well above the keyboard. So a
// drag goes through only where something can scroll the way it is heading: the body once it is
// longer than the screen, the island's formatting sideways.
let dragFrom = { x: 0, y: 0 }
let dragScrolls: boolean | undefined
useEventListener(
  composerRoot,
  'touchstart',
  (event: TouchEvent) => {
    dragFrom = { x: event.touches[0].clientX, y: event.touches[0].clientY }
    dragScrolls = undefined
  },
  { passive: true },
)
useEventListener(
  composerRoot,
  'touchmove',
  (event: TouchEvent) => {
    if (dragScrolls === undefined) {
      const { clientX, clientY } = event.touches[0]
      const across = Math.abs(clientX - dragFrom.x) > Math.abs(clientY - dragFrom.y)
      dragScrolls = scrollsUnder(event.target, across)
    }
    if (!dragScrolls) event.preventDefault()
  },
  { passive: false },
)
const scrollsUnder = (target: EventTarget | null, across: boolean) => {
  for (let el = target instanceof Element ? target : null; el && el !== composerRoot.value;) {
    const overflow = across ? getComputedStyle(el).overflowX : getComputedStyle(el).overflowY
    const room = across ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
    if ((overflow === 'auto' || overflow === 'scroll') && room > 0) return true
    el = el.parentElement
  }
  return false
}

onUnmounted(() => {
  const { style } = document.body
  style.overflow = ''
  style.position = ''
  style.width = ''
  document.documentElement.style.overflow = ''
})

// Where a tap at (x, y) puts the caret: caretPositionFromPoint where there is one, Safari's older
// caretRangeFromPoint otherwise.
const caretFromPoint = (x: number, y: number) => {
  const position = document.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = document.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

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
  const target = event.target instanceof Element ? event.target : null
  const editor = textEditor.value?.editor
  const body = editor?.view?.dom

  // A quote unfolded into the body is an editing host of its own (see QuotedContentExtension), which
  // ProseMirror keeps out of. Its caret is the browser's, so it goes where the tap landed; placed by
  // ProseMirror instead, it sat beside the quote and the reply was typed in below it.
  const quote = target?.closest?.('[contenteditable="true"]')
  if (body && quote instanceof HTMLElement && quote !== body && body.contains(quote)) {
    event.preventDefault()
    quote.focus({ preventScroll: true })
    const caret = caretFromPoint(event.clientX, event.clientY)
    if (caret && quote.contains(caret.node))
      document.getSelection()?.collapse(caret.node, caret.offset)
    return
  }

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

const onFocusIn = (event: FocusEvent) =>
  reveal(event.target instanceof Element ? event.target : null)

// Pre-empt iOS's focus reveal.
//
// When focus lands on a field it thinks the keyboard covers, iOS brings it into view — and if it
// can't find a scroller to do that with, it pans the visible area up the page instead. The page is
// exactly as tall as that visible area, so a pan carries its bottom edge up with it and the toolbar
// ends up floating above the keyboard with a white gap under it.
//
// Bringing the focused field comfortably into view ourselves, in our own scroller and synchronously
// as focus arrives, leaves iOS with nothing to reveal and so no reason to pan.
const reveal = (node: Element | null) => {
  const box = scroller.value
  if (!box || !node || !box.contains(node)) return

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

// Focus arrives before the keyboard does. The reveal above ran against the full-height page, and
// the keyboard then took the lower half of it: on a reply with Cc and Bcc open the fields fill
// what is left and the caret is behind the toolbar. Reveal again once the page has its new height.
watch(viewportHeight, () => reveal(document.activeElement), { flush: 'post' })
const menu = useEditorMenu()

// The island's tools: the inserts stand with Attach, and the rest of desktop's editor menu is the
// formatting, shown in their place.
const INSERTS: MenuItem[] = [InsertImage, InsertLink]
const formatting = ref(false)
const formatMenu = computed(() => {
  const items = menu.value.filter((item) => !INSERTS.includes(item))
  while (items.at(-1) === Separator) items.pop()
  return items
})

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

const onFilesSelected = async (files: File[]) => {
  for (const file of files) {
    pendingUploads.value++
    try {
      const doc = await uploadFunction(file)
      attachFile(doc, file.type)
    } catch (error) {
      raiseToast(
        (error instanceof TransportError &&
        error.type !== 'NetworkError' &&
        error.type !== 'AbortError'
          ? __(error.message)
          : null) || __('Could not attach {0}', [file.name]),
        'error',
      )
    } finally {
      pendingUploads.value--
    }
  }
}

// The reminder is the island's bell, as it is desktop's.
// Discard in a group of its own, kept apart from sending.
const ACTIONS = [
  {
    group: '',
    options: [
      { label: __('Schedule send'), onClick: () => openScheduleModal(), icon: CalendarClock },
    ],
  },
  {
    group: '',
    options: [
      { label: __('Discard'), onClick: () => discardMail(), icon: Trash2, theme: 'red' as const },
    ],
  },
]

// Start where there is still something to write: the body on a reply (recipients and subject came
// with the thread), the subject when the draft arrived addressed but unnamed (a `mailto:` link, or a
// calendar invite's participants), and To otherwise.
onMounted(() => {
  onOpened()

  if (mailDetails?.in_reply_to) textEditor.value?.editor?.commands.focus()
  else if (!isRecipientsEmpty.value && !mail.subject) subjectInput.value?.focus()
  else toInput.value?.setFocus()
})

// Navigating away is the only way off this page, so this is where an unsent message gets kept. One
// with nothing written is not a draft: it had already saved itself (a body that is only the
// signature saves), so leaving it left a "[No subject]" in Drafts for every compose opened and
// closed. It goes, quietly, as the desktop window's does on Close (see SendMail).
onBeforeRouteLeave(() => {
  leaving = true
  if (!closedByComposer && isUntouched.value) void discardMail()
  else saveDraft()
})

onUnmounted(() => saveDraft())
</script>
