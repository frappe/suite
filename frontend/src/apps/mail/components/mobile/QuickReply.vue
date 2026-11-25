<template>
  <!-- A reply or forward written in the thread on a phone, without the compose page: the thread's
       reply island grows into it over the keyboard, with the conversation still in view above.
       Formatting, attachments, Cc and the rest are a tap away on the full page (Expand), which
       takes the reply over as it stands.

       It covers the visible part of the screen, as the compose page does (see ComposeView), so it
       sits on the keyboard wherever iOS has scrolled the page to; only the island takes taps. -->
  <!-- One Send, at the end of a forward's row or the foot of a reply's text. -->
  <DefineSend>
    <Button
      variant="solid"
      size="lg"
      class="shrink-0 !rounded-full"
      :label="__('Send')"
      :disabled="isRecipientsEmpty || isUploading"
      :loading="isSending"
      @click="sendMail()"
    >
      <template #icon>
        <span class="lucide-send-horizontal size-5" aria-hidden="true" />
      </template>
    </Button>
  </DefineSend>
  <Teleport :to="overlayLayer ?? 'body'">
    <div
      class="pointer-events-none fixed inset-x-0 z-30 flex flex-col justify-end"
      :style="{ top: `${keyboardTop}px`, height: `${viewportHeight}px` }"
    >
      <!-- Where a forward's To field opens its suggestions: above the island, the one place the
           keyboard leaves room for them. It floats over the thread, so it takes a surface of its
           own, and only while it has something to offer. -->
      <div
        ref="suggestions"
        class="bg-surface-elevation-2 pointer-events-auto mx-3.5 max-h-72 overflow-y-auto rounded-[24px] border py-1 shadow-xl [&:not(:has(li))]:hidden"
      />
      <!-- Measured whole for the toasts, which rise above it (see phoneBarsAway). Positioned, so
           the bar's offset is taken from here and not from the full-screen layer around it. -->
      <div ref="lift" class="relative">
        <div
          ref="bar"
          class="pointer-events-auto px-3.5 pt-2"
          :style="{
            paddingBottom: `calc(0.75rem + max(0px, env(safe-area-inset-bottom) - ${keyboardBottom}px))`,
          }"
          :inert="isSending || undefined"
          @focusout="onFocusOut"
        >
          <Editor
            ref="textEditor"
            :model-value="editorContent"
            :extensions="editorExtensions"
            :upload-function="uploadFunction"
            @change="onEditorChange"
          >
            <template #default="{ editor }">
              <!-- One field, as the reply island it grew from. Its top row is Discard, who it goes
                   to and Expand; under it the text, with Send at its foot. A forward asks only who
                   it goes to, so it is that one row with Send at its end: the mail it forwards
                   rides along unseen, and a note is the full page's. -->
              <!-- Rounded as the pill it grew from: half its 48px row, which keeps a one-row forward
                   the same shape as the reply island and sits even around the 40px buttons inset
                   4px from the edge. The scale has nothing between 20px and 100px. -->
              <!-- A send dims what it holds, not the island: the thread would show through. -->
              <div
                class="bg-surface-elevation-2 rounded-[24px] border shadow-xl"
                :class="{ '*:opacity-50': isSending }"
                @mousedown="keepFocus"
              >
                <!-- 48px tall, as the reply island is: its 40px buttons sit 3px inside its 1px
                     border, and a one-row forward is the island grown in place. -->
                <div class="flex items-start gap-1 px-1 py-[3px]">
                  <Button
                    variant="ghost"
                    size="lg"
                    class="text-ink-gray-5 shrink-0 !rounded-full"
                    :label="__('Discard')"
                    @click="discard"
                  >
                    <template #icon>
                      <X class="size-5" />
                    </template>
                  </Button>
                  <div v-if="isForward" class="flex min-w-0 flex-1 items-start gap-2 py-1.5">
                    <span class="text-ink-gray-5 shrink-0 text-base leading-7">{{ __('To') }}</span>
                    <RecipientInput
                      ref="toInput"
                      v-model="mail.to"
                      field="to"
                      :suggestions-to="suggestions"
                      :movable="false"
                      class="min-w-0 flex-1"
                      @move="moveRecipient"
                    />
                  </div>
                  <!-- A reply's recipients came with the thread; changing them is the full
                       page's job. -->
                  <button
                    v-else
                    type="button"
                    class="flex h-10 min-w-0 flex-1 items-center gap-2 text-base"
                    :aria-label="__('Change recipients')"
                    @click="expand('to')"
                  >
                    <span class="text-ink-gray-5 shrink-0">{{ __('To') }}</span>
                    <span class="text-ink-gray-8 truncate">{{ recipientNames }}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="lg"
                    class="text-ink-gray-5 shrink-0 !rounded-full"
                    :label="__('Expand')"
                    @click="expand()"
                  >
                    <template #icon>
                      <Maximize2 class="size-4" />
                    </template>
                  </Button>
                  <ReuseSend v-if="isForward" />
                </div>
                <!-- The text lines up under who it goes to, between Discard's column and Send's. -->
                <div v-if="!isForward" class="flex items-end">
                  <EditorContent
                    :editor
                    class="prose-sm max-h-40 min-w-0 max-w-none flex-1 overflow-y-auto pb-3 pl-12 [&_[contenteditable=true]]:outline-none"
                  />
                  <div class="shrink-0 px-1 pb-[3px]">
                    <ReuseSend />
                  </div>
                </div>
              </div>
            </template>
          </Editor>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { createReusableTemplate, useResizeObserver } from '@vueuse/core'
import { Button, usePortalTarget } from 'frappe-ui'
import { Editor, EditorContent } from 'frappe-ui/editor'
import { Maximize2, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'

import RecipientInput from '@/apps/mail/components/Controls/RecipientInput.vue'
import type { PendingCompose } from '@/apps/mail/composables/composeHandoff'
import { liftToastsOver } from '@/apps/mail/composables/phoneBarsAway'
import { useComposeMail } from '@/apps/mail/composables/useComposeMail'
import type { ComposeMailData, DraftRecipient } from '@/apps/mail/types'
import { uploadFunction } from '@/apps/mail/utils/text-editor'
import { useKeyboardInsets, useStillDocument } from '@/platform/keyboard-insets'
import { translate as __ } from '@/platform/translation'

const { mailDetails, reloadMails, showSent } = defineProps<{
  mailDetails: ComposeMailData
  reloadMails: () => void
  /** Shows the sent reply in the thread, and resolves once it has (see useComposeMail). */
  showSent: () => Promise<void>
}>()
const emit = defineEmits<{
  close: []
  /** To the full compose page, carrying the reply as it stands, and where to put the caret there. */
  expand: [mail: ComposeMailData, startAt?: PendingCompose['startAt']]
  /** How much of the screen's foot it covers, keyboard included, so the thread can clear it. */
  cover: [px: number]
}>()

const [DefineSend, ReuseSend] = createReusableTemplate()
const overlayLayer = usePortalTarget()
const textEditor = useTemplateRef('textEditor')
const toInput = useTemplateRef<{ setFocus: () => void }>('toInput')
const bar = useTemplateRef<HTMLElement>('bar')
const lift = useTemplateRef<HTMLElement>('lift')
liftToastsOver(lift)
const suggestions = useTemplateRef<HTMLElement>('suggestions')
const { height: viewportHeight, top: keyboardTop, bottom: keyboardBottom } = useKeyboardInsets()
// Or the keyboard scrolls the page, thread and all, up off the top of the screen (see useStillDocument).
useStillDocument()

// Gone off screen, by Send, Discard or Expand: nothing is saved on the way out after that.
let closed = false
const {
  mail,
  isRecipientsEmpty,
  moveRecipient,
  saveDraft,
  sendMail,
  isSending,
  discardMail,
  isUntouched,
  isUploading,
  editorExtensions,
  editorContent,
  onEditorChange,
  onOpened,
  payListDebt,
} = useComposeMail({
  mailDetails,
  isInThread: true,
  autosave: mailDetails.type !== 'forward',
  reloadMails,
  showSent,
  close: () => {
    closed = true
    emit('close')
  },
  isOpen: () => !closed,
  host: () => textEditor.value,
  root: () => bar.value,
  uploadInlineImage: uploadFunction,
})

const isForward = computed(() => mailDetails.type === 'forward')
// Who it goes to, by first name, as the reply field it grew from says it: a reply all's Cc too.
const recipientNames = computed(() =>
  [...(mail.to ?? []), ...(mail.cc ?? [])]
    .map((recipient: DraftRecipient) => recipient.display_name?.split(/\s+/)[0] || recipient.email)
    .join(', '),
)
// The full page takes the reply over. A reply already saved goes as the draft it is, so the page
// resumes it rather than starting a second; one with nothing written goes as it came, unsaved, so
// closing the page leaves no draft behind. A forward goes unsaved too, and the page saves it from
// there as it saves any. Opened from who it goes to, the page starts in To, to change them there.
const expand = async (startAt?: PendingCompose['startAt']) => {
  if (!isForward.value && !isUntouched.value) await saveDraft()
  closed = true
  emit('expand', JSON.parse(JSON.stringify(mail)), startAt)
}

// A forward was never saved, so there is no draft to discard and nothing for Undo to bring back:
// it just goes.
const discard = () => {
  if (!isForward.value) return discardMail()
  closed = true
  emit('close')
}

// Put down with nothing written (the keyboard dismissed, a tap on the thread), it folds back into
// the reply island and leaves no draft. With something written it stays, to come back to.
const onFocusOut = (event: FocusEvent) => {
  const to = event.relatedTarget
  if (closed || (to instanceof Node && bar.value?.contains(to))) return
  if (isUntouched.value) void discardMail()
}

// A press on one of its buttons leaves the caret where it is. Taking focus would start the keyboard
// down, and the field rides down with it, out from under the finger before the tap lands: ✕ only
// put the keyboard away.
const keepFocus = (event: MouseEvent) => {
  if (event.target instanceof Element && event.target.closest('button')) event.preventDefault()
}

const reportCover = () => emit('cover', (bar.value?.offsetHeight ?? 0) + keyboardBottom.value)
useResizeObserver(bar, reportCover)
watch(keyboardBottom, reportCover)

onMounted(() => {
  onOpened()
  if (isForward.value) toInput.value?.setFocus()
  else textEditor.value?.editor?.commands.focus('start')
})
// Left for another thread or page with the reply written: it is kept as a draft. With nothing
// written it goes, as it does when put down (a reply that is only the signature is not a draft). A
// forward is never kept (see `autosave`).
onUnmounted(async () => {
  if (closed || isForward.value) return
  if (isUntouched.value) return void discardMail()
  // Then the thread is told, after the save, so it finds the draft as it was left (see payListDebt).
  await saveDraft()
  payListDebt()
})
</script>
