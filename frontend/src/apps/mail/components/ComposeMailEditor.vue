<template>
  <!-- The list indents are ours rather than prose-sm's 22px: an outside marker is drawn in
	     that padding, and "10." is wider than it, so from the tenth item on the number was cut
	     off by the editor's own scroll container (it starts at x=0 — the body carries no
	     horizontal padding on desktop). Both lists move together so a document mixing them
	     keeps one indent. -->
  <!-- 75vh is a modal's height — it has the screen to itself. Docked, the composer sits beside
	     the mail it is being written about, so it takes a fixed 30rem and leaves the rest of the
	     list visible; the panel's own max-h still clips it on a short viewport. In a thread the
	     height is the thread's — unless the draft is the whole thread, when the card it sits in
	     is stretched to the pane and the composer fills that (`fillsHost`). -->
  <TextEditor
    ref="textEditor"
    editor-class="prose-sm max-w-none [&_ol]:ps-7 [&_ul]:ps-7"
    :extensions="[
      imageExtension,
      CustomParagraphExtension,
      QuotedContentExtension,
      ...mentionExtensions,
    ]"
    :content="editorContent"
    :upload-function="uploadInlineImage"
    class="flex flex-col"
    :class="[
      { 'pointer-events-none opacity-50': !show },
      fillsHost || windowed ? 'sm:min-h-0 sm:flex-1' : '',
    ]"
    @change="onEditorChange"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <template #top>
      <!-- Desktop, in the composer window and in a thread alike: one row per field, each led by its
           name in a column of its own, so the values line up down the page; neither host pads the
           composer, so every row carries its own inset. A reply in a thread leaves From and
           Subject out — the conversation around it says both — and switches between reply, reply
           all and forward from the To row. -->
      <template v-if="!isMobile">
        <!-- Scrolls rather than pushing the window's header off screen when enough recipients
             wrap that the fields outgrow a capped window. -->
        <div class="max-h-[40vh] min-h-0 shrink-0 overflow-y-auto">
          <div
            v-if="showsFromAndSubject"
            class="flex items-center gap-2 border-b px-4 py-2"
            :class="{ 'border-transparent': isDragging }"
          >
            <span class="text-ink-gray-5 flex h-7 w-10 shrink-0 items-center text-base">
              {{ __('From') }}
            </span>
            <!-- Button mode, so the trigger takes the width of the identity it shows rather than
                 cutting a long address off mid-domain; the list is searched from the popover.
                 Pulled left by its padding and border (8px + 1px), so the address starts where the
                 recipient chips below do. -->
            <Combobox
              v-model="mail.from_email"
              :options="identityOptions"
              trigger="button"
              variant="ghost"
              class="-ml-[9px] min-w-0 max-w-full !text-ink-gray-8"
            />
            <!-- Unsaved text is no reason to withhold this: the draft is handed to the window as
                 it stands, in memory, rather than fetched back from the server. Only a save
                 actually in flight holds it up — see popOut. -->
            <Button
              v-if="isInThread"
              variant="ghost"
              class="ml-auto shrink-0"
              :tooltip="__('Open in a window')"
              :disabled="isLoading"
              @click="popOut()"
            >
              <template #icon>
                <component :is="ExternalLink" class="text-ink-gray-5 h-4 w-4" />
              </template>
            </Button>
          </div>
          <div
            class="flex items-start gap-2 border-b px-4 py-2"
            :class="{ 'border-transparent': isDragging }"
          >
            <Dropdown v-if="isInThread && mailDetails?.type" :options="localDraftActions">
              <Button variant="ghost" class="-ml-1.5" :icon="TYPE_ICON_MAP[mailDetails.type]" />
            </Dropdown>
            <Tooltip :text="__('Select from contacts')">
              <button
                type="button"
                class="text-ink-gray-5 hover:text-ink-gray-8 flex h-7 w-10 shrink-0 items-center text-base"
                @click="insertContacts('to')"
              >
                {{ __('To') }}
              </button>
            </Tooltip>
            <RecipientInput
              ref="toInput"
              v-model="mail.to"
              field="to"
              @move="moveRecipient"
              @show-cc-bcc="showCcBcc = true"
            />
            <Button
              v-if="!(mail.cc?.length || mail.bcc?.length)"
              variant="ghost"
              :aria-label="showCcBcc ? __('Hide Cc and Bcc') : __('Show Cc and Bcc')"
              :tooltip="__('Cc and Bcc')"
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
          <template v-if="showCcBcc">
            <div
              class="flex items-start gap-2 border-b px-4 py-2"
              :class="{ 'border-transparent': isDragging }"
            >
              <Tooltip :text="__('Select from contacts')">
                <button
                  type="button"
                  class="text-ink-gray-5 hover:text-ink-gray-8 flex h-7 w-10 shrink-0 items-center text-base"
                  @click="insertContacts('cc')"
                >
                  {{ __('Cc') }}
                </button>
              </Tooltip>
              <RecipientInput ref="ccInput" v-model="mail.cc" field="cc" @move="moveRecipient" />
            </div>
            <div
              class="flex items-start gap-2 border-b px-4 py-2"
              :class="{ 'border-transparent': isDragging }"
            >
              <Tooltip :text="__('Select from contacts')">
                <button
                  type="button"
                  class="text-ink-gray-5 hover:text-ink-gray-8 flex h-7 w-10 shrink-0 items-center text-base"
                  @click="insertContacts('bcc')"
                >
                  {{ __('Bcc') }}
                </button>
              </Tooltip>
              <RecipientInput v-model="mail.bcc" field="bcc" @move="moveRecipient" />
            </div>
          </template>
        </div>
        <input
          v-if="showsFromAndSubject"
          ref="subjectInput"
          v-model="mail.subject"
          :placeholder="__('Subject')"
          :aria-label="__('Subject')"
          class="border-outline-gray-1 text-ink-gray-9 placeholder:text-ink-gray-4 focus:border-outline-gray-1 h-11 w-full shrink-0 border-0 border-b bg-transparent px-4 text-base focus:ring-0"
          :class="{ 'border-transparent': isDragging }"
        />
      </template>
      <div
        v-else
        class="flex flex-col gap-2.5 border-b px-3 py-2.5"
        :class="{ 'border-transparent': isDragging }"
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
            <!-- Button mode, like the phone composer's: the trigger takes the width of the
						     identity it is showing. As an input it was a box of a fixed 16rem with the
						     name and address inside it, and anything longer than that — which is most
						     addresses once the display name is in front of them — was cut off mid-domain.
						     The list is filtered from the popover's own search box instead. -->
            <Combobox
              v-model="mail.from_email"
              :options="identityOptions"
              trigger="button"
              class="min-w-0 max-w-full !text-ink-gray-8"
            />
          </div>
          <!-- Unsaved text is no reason to withhold this: the draft is handed to the window as
					     it stands, in memory, rather than fetched back from the server. Only a save
					     actually in flight holds it up — see popOut. -->
          <Button v-if="isInThread" variant="ghost" :disabled="isLoading" @click="popOut()">
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
                field="to"
                @move="moveRecipient"
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
                <RecipientInput ref="ccInput" v-model="mail.cc" field="cc" @move="moveRecipient" />
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
                <RecipientInput v-model="mail.bcc" field="bcc" @move="moveRecipient" />
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
      <!-- In a thread the body scrolls on its own past 24rem, so a long reply does not push
			     the conversation up out of view. Given the pane to itself it has no conversation
			     to protect and takes whatever height the fields and toolbar leave. -->
      <div
        class="relative flex cursor-text flex-col border-2 border-transparent px-3 py-2.5 text-sm sm:overflow-y-auto sm:px-4 sm:py-3"
        :class="{
          // Docked, the body is its own height and gives way only at the window's cap; anywhere
          // else it fills what the fields and toolbar leave.
          'flex-1': !windowed || expanded,
          // Docked, the window is as tall as its fields and a fixed page; expanded, the page
          // takes whatever the window's fixed height leaves.
          // Shrinks (and scrolls) when the window meets its height cap on a short screen.
          'h-72 min-h-16 shrink': windowed && !expanded,
          'min-h-0': windowed && expanded,
          'max-h-96 min-h-32': isInThread && !fillsHost,
          'sm:min-h-0': fillsHost,
          '!border-outline-gray-3 rounded-4 border-dashed': isDragging,
        }"
        @click="editor.commands.focus('end')"
      >
        <div
          v-if="isDragging"
          class="bg-surface-gray-1/90 text-ink-gray-3 absolute inset-0 z-50 flex flex-col items-center justify-center space-y-1 rounded-4"
        >
          <UploadCloud class="stroke-1.5 h-12 w-12" />
          <p class="text-lg-semibold">{{ __('Drop files to upload') }}</p>
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

          <!-- Attachments, as the pills the list shows them with: a row that wraps, each one
               opening on a click and leaving the mail on its ✕. Files still uploading join the
               row with their progress in place of a size. -->
          <div v-if="attachedFiles.length || uploadingFiles.length" class="flex flex-wrap gap-2">
            <Tooltip
              v-for="file in attachedFiles"
              :key="`${file.blob_id}:${file.file_url}`"
              :text="nameOf(file)"
            >
              <AttachmentCapsule
                :file-name="nameOf(file)"
                :type="file.type"
                :size="sizeOf(file)"
                removable
                truncate-middle
                class="max-w-64"
                @click="openFile(file)"
                @remove="mail.attachments.splice(mail.attachments.indexOf(file), 1)"
              />
            </Tooltip>
            <Tooltip
              v-for="(upload, id) in uploadingFiles"
              :key="`upload-${id}`"
              :text="upload.name"
            >
              <AttachmentCapsule
                :file-name="upload.name"
                :progress="upload.progress"
                truncate-middle
                class="max-w-64 !cursor-default"
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </template>
    <!-- Last child of the scroller, so `sticky bottom-0` (mobile, in the toolbar itself) pins it to
		     the bottom of the scrollport while the fields and body scroll under it. The sheet ends where
		     the keyboard begins, so that bottom edge is the top of the keyboard. -->
    <!-- Neither the window nor a thread's draft card pads the composer, so the fields, the body
         and the bar each carry their own inset. The phone's sticky bar insets itself. -->
    <template #bottom>
      <ComposeMailToolbar
        :is-recipients-empty
        :is-uploading
        class="border-t sm:px-4 sm:pb-2.5"
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
  <ScheduleSendModal v-model="showScheduleModal" :save="scheduleSend" />
</template>

<script setup lang="ts">
import { EditorContent } from '@tiptap/vue-3'
import { Button, Combobox, Dropdown, Tooltip, UploadError, useFileUpload } from 'frappe-ui'
import { TextEditor } from 'frappe-ui/experimental'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Forward,
  Reply,
  ReplyAll,
  UploadCloud,
} from 'lucide-vue-next'
import { computed, inject, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

import AttachmentCapsule from '@/apps/mail/components/AttachmentCapsule.vue'
import ComposeMailToolbar from '@/apps/mail/components/ComposeMailToolbar.vue'
import { useComposeMail } from '@/apps/mail/composables/useComposeMail'
import type {
  Attachment,
  ComposeMailData,
  File as FileDoc,
  Identity,
  UserResource,
} from '@/apps/mail/types'
import { formatBytes, isOverlayPresent, raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { QuotedContentExtension } from '@/apps/mail/utils/quotedContentExtension'
import {
  CustomImageExtension,
  CustomParagraphExtension,
  uploadFunction,
} from '@/apps/mail/utils/text-editor'

import RecipientInput from './Controls/RecipientInput.vue'
import ContactsModal from './Modals/ContactsModal.vue'
import ScheduleSendModal from './Modals/ScheduleSendModal.vue'

const show = defineModel<boolean>()
const {
  reloadMails,
  mailDetails,
  isInThread = false,
  expanded = false,
  fillsHost = false,
} = defineProps<{
  reloadMails: () => void
  mailDetails?: ComposeMailData
  isInThread?: boolean
  // The composer window expanded over the page, rather than docked in its corner: the page takes
  // the window's height instead of a fixed one.
  expanded?: boolean
  // The host is a flex column of a definite height, and the composer is to take all of it —
  // a draft that is the whole thread, given the reading pane to itself.
  fillsHost?: boolean
}>()
const emit = defineEmits([
  'discardMail',
  'discardStarted',
  'reply',
  'replyAll',
  'forward',
  'popOut',
])
const { isMobile } = useScreenSize()
// In the desktop composer window (SendMail) rather than a thread or the phone's page.
const windowed = computed(() => !isInThread && !isMobile.value)
// A reply in a thread has the conversation around it to say who it is from and what it is about.
const showsFromAndSubject = computed(() => !isInThread || !mailDetails?.type)
const textEditor = useTemplateRef('textEditor')
const toInput = useTemplateRef('toInput')
const ccInput = useTemplateRef('ccInput')
const subjectInput = useTemplateRef<HTMLInputElement>('subjectInput')
// An upload in flight, with the name and size of the file it is carrying.
type FileUpload = ReturnType<typeof useFileUpload> & { name: string; size: number }
const fileUploads = ref<FileUpload[]>([])
const pendingInlineUploads = ref(0)
const isUploading = computed(
  () => pendingInlineUploads.value > 0 || fileUploads.value.some((upload) => upload.isUploading),
)
const user = inject('$user') as UserResource

// The server refuses a file over the Mail attachment limit (`upload_file`); saying so here
// spares sending the bytes first.
const refuseOversized = (file: File) => {
  const limit = user.data?.max_attachment_size
  if (!limit || file.size <= limit) return false
  raiseToast(
    __('{0} is {1}. Mail can attach files up to {2}.', [
      file.name,
      formatBytes(file.size),
      formatBytes(limit),
    ]),
    'error',
  )
  return true
}

// The server's own refusal, already translated, or a generic line when it sent none.
const uploadFailure = (file: File, reason: unknown) =>
  reason instanceof UploadError && reason.messages.length
    ? reason.messages.join('\n')
    : __('Failed to upload {0}', [file.name])
const uploadInlineImage = async (file: File) => {
  if (refuseOversized(file)) throw new Error(__('{0} is too large to attach.', [file.name]))
  pendingInlineUploads.value++
  try {
    return await uploadFunction(file)
  } finally {
    pendingInlineUploads.value--
  }
}
const imageExtension = CustomImageExtension.configure({
  uploadFunction: uploadInlineImage,
})

// What the composition *is* — draft state, autosave, send, schedule, discard, attachments, mentions
// — lives in the composable, shared with the phone composer (ComposeView). Only what is particular
// to this dialog stays here: the contact picker, drag-and-drop, and the in-thread draft actions.
const {
  mail,
  identities,
  isLoading,
  isRecipientsEmpty,
  moveRecipient,
  onOpened,
  saveDraft,
  payListDebt,
  sendMail,
  discardMail,
  isUntouched,
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
  isUploading: () => isUploading.value,
  // The dialog holds the rest of the page inert, so the mention dropdown has to render inside it
  // rather than at <body>, where it would be unreachable.
  mentionContainer: () =>
    (textEditor.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>('[role="dialog"]') ??
    null,
})

const identityOptions = computed(() =>
  (identities.value.data ?? []).map((i: Identity) => ({
    label: `${i._name} <${i.email}>`,
    value: i.email,
  })),
)

// The composer stays mounted when it closes, so the in-flight flags have to be cleared on the way out.
watch(show, (open) => !open && onClosed())
// A file on the mail comes in one of two shapes: uploaded here a moment ago (file_name, file_size)
// or already on the server (filename, size).
type ComposeAttachment = Attachment & { file_name?: string; file_size?: number; name?: string }
const nameOf = (file: ComposeAttachment) => file.file_name || file.filename || file.name || ''
const sizeOf = (file: ComposeAttachment) => Number(file.file_size || file.size) || undefined

// The files on the mail, as opposed to the images placed inline in its body.
const attachedFiles = computed<ComposeAttachment[]>(() =>
  mail.attachments.filter((file: Attachment) => file.disposition === 'attachment'),
)
const uploadingFiles = computed(() => fileUploads.value.filter((upload) => upload.isUploading))
// A file already on the server opens from its blob; one uploaded here a moment ago, from its URL.
const openFile = (file: ComposeAttachment) =>
  file.blob_id
    ? openAttachment(file.blob_id, file.type)
    : window.open(file.file_url ?? undefined, '_blank')

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
  onOpened()
  if (mailDetails?.in_reply_to) return textEditor.value.editor.commands.focus()

  // Deferred, and the choice made from inside: TextEditor renders nothing until it has built its
  // editor on its own mounted hook, so neither field exists yet at this point.
  setTimeout(() => {
    if (!isRecipientsEmpty.value && !mail.subject && subjectInput.value) subjectInput.value.focus()
    else toInput.value?.setFocus()
  }, 50)
})

// Popping out is a hand-off, not a close: the window is given this very draft and takes over saving
// it, so this editor leaves without a word. Saving anyway would race the window into writing the
// same reply twice — one draft from each — which is the duplicate the debounced save is held back
// from making, arriving by the other door.
//
// A save in flight is the one thing that has to finish first, and is why both entry points are
// withheld while `isLoading`: the id the server is about to hand back lands on this composable, and
// the window — which copies the draft as it is at the moment of the hand-off — would never hear of
// it. Its first save would then create a second draft rather than update this one.
let handedOff = false
const popOut = () => {
  handedOff = true
  emit('popOut', mail)
}

// Otherwise this is the last chance to keep what was typed since the autosave last ran. Closing a
// composer now unmounts this editor outright — the dialog drops it, the phone leaves the compose
// route — so the debounced save that would have caught up in a second's time never gets to.
//
// And then the list is told, if a draft in a thread has been going to the server without it (see
// payListDebt). After the save, so the reload finds the draft as it was left rather than as it was
// a keystroke before that. Not on a hand-off: the window this draft has gone to is saving it now,
// and it tells the list itself.
onUnmounted(async () => {
  if (handedOff) return
  await saveDraft()
  payListDebt()
})

// `mail` is exposed so the window around this one can read the draft — the minimised bar names
// itself after the subject, which only exists in here.
defineExpose({
  mail,
  sendMail,
  discardMail,
  // Nothing written yet: the window has nothing to keep, so leaving it closes it (see SendMail).
  isUntouched,
  openScheduleModal,
})

// Local draft actions

const localDraftActions = computed(() => [
  {
    group: '',
    options: [
      {
        label: __('Reply'),
        icon: Reply,
        onClick: () => emit('reply'),
      },
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
    options: [
      {
        label: __('Pop Out'),
        icon: ExternalLink,
        onClick: () => popOut(),
        condition: () => !isLoading.value,
      },
    ],
  },
])
const TYPE_ICON_MAP = {
  reply: 'lucide-reply',
  replyAll: 'lucide-reply-all',
  forward: 'lucide-forward',
}

// Shortcuts

// Every mounted composer listens on the window, and a thread can hold more than one — a draft
// being replied to below another, or one open here and another in the composer window. Without
// this the shortcuts went to all of them at once: ⌘D discarded every open draft, ⌘Enter sent them.
// The one the keystroke belongs to is the one it was typed into.
const ownsEvent = (e: KeyboardEvent) => {
  const root = textEditor.value?.$el as HTMLElement | undefined
  const target = e.target as Node | null
  return !!root && !!target && root.contains(target)
}
const handleKeydown = (e: KeyboardEvent) => {
  if (!show.value || (isInThread && isOverlayPresent())) return
  if (!ownsEvent(e)) return
  handleSendShortcut(e)
  handleDiscardShortcut(e)
}

// ⌘Enter sends; with Shift it asks when to, as the split button's menu does.
const handleSendShortcut = (e: KeyboardEvent) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return
  e.preventDefault()
  if (e.shiftKey) openScheduleModal()
  else sendMail()
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
const uploadFiles = async (files: File[]) => {
  const accepted = files.filter((file) => !refuseOversized(file))
  if (!accepted.length) return
  const results = await Promise.allSettled(accepted.map(uploadFile))
  results.forEach((res, i) => {
    if (res.status === 'rejected') raiseToast(uploadFailure(accepted[i], res.reason), 'error')
  })
}
const uploadFile = async (file: File) => {
  const fileUpload = useFileUpload()
  fileUploads.value.push({
    name: file.name,
    size: file.size,
    ...fileUpload,
  })
  const doc = (await fileUpload.upload(file, {
    private: true,
    folder: 'Home/Frappe Mail',
    upload_endpoint: '/api/method/suite.mail.api.mail.upload_file',
  })) as FileDoc
  attachDoc(doc, file.type)
}
const attachDoc = (doc: FileDoc, type?: string) =>
  mail.attachments.push({
    file_name: doc.file_name,
    // Kept for the pill's icon; the server reads the type from the file itself.
    type: type ?? '',
    file_url: doc.file_url,
    file_size: doc.file_size,
    disposition: 'attachment',
  })
</script>
