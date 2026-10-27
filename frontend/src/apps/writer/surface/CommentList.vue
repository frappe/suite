<script setup lang="ts">
import { Avatar, Button, Dropdown, TextInput, type DropdownOptions } from 'frappe-ui'
import { v4 } from 'uuid'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import {
  DriveCommentAuthor,
  GUEST_NAME_LIMIT,
  useDriveGuestName,
  type DocumentThread,
} from '@/apps/drive'
import { DOCUMENT_ANCHOR } from '@/apps/writer/collab/anchors'
import type { ThreadPlaces } from '@/apps/writer/collab/highlights'
import { confirm, toast } from '@/platform/feedback'
import { useSession } from '@/platform/session'

import CommentDraftCard from './CommentDraftCard.vue'
import CommentDraftRow from './CommentDraftRow.vue'
import { isComposing } from './commentMentions'
import CommentText from './CommentText.vue'
import MentionTextarea from './MentionTextarea.vue'
import { useSeenThreads } from './seenThreads'
import { threadRows, type ThreadRow } from './threadRows'
import type { ShownDraft, useCommentDrafts } from './useCommentDrafts'
import type { ThreadActions } from './useDocumentPanel'
import { dayOrTime } from './versionDates'

type ThreadComment = DocumentThread['comments'][number]
// A row, or the Resolved line when row is null
interface ShownItem {
  key: string
  row: ThreadRow | null
}

const RESOLVED_MESSAGE_MS = 5000
// Its own key, so changes to the threads around it keep the line and its focus
const RESOLVED_LINE = 'resolved-line'
// The most a comment holds, in UTF-8 bytes, as Drive counts them
const MAX_COMMENT_BYTES = 65_535

/**
 * The document's comment threads, open ones first and resolved ones folded below,
 * one row each and one open at a time. A closed row shows who started the thread,
 * where it is, when, its first comment and how many replies it has.
 */
const props = defineProps<{
  threads: DocumentThread[]
  /** When Drive's threads were read; null before the first read. */
  readAt: number | null
  /** The document the threads are on. */
  node: string
  /** Where each thread shows in the editor; null when the editor can't tell. */
  places: ThreadPlaces | null
  canComment: boolean
  /** Whether the person can edit the document, which lets them change anyone's comment. */
  canEditDocument: boolean
  actions: ThreadActions
  /** Comments not posted yet, on text or on the whole document. */
  drafts: ReturnType<typeof useCommentDrafts>
}>()

/** The thread shown open; its text in the editor stays lit. */
const openThread = defineModel<string | null>('openThread', { default: null })
/** The closed thread whose row is pointed at, whose text lights faintly. */
const litThread = defineModel<string | null>('litThread', { default: null })

const isResolvedShown = ref(false)
const rowItems = ref<HTMLElement[]>([])
const documentCard = ref<{ focus(): void } | null>(null)
const replyBoxes = ref<{ focus(): void }[]>([])
/** A reply typed into each thread, kept while another is open. */
const replyTexts = ref<Record<string, string>>({})
/** The replies sent to each thread that Drive hasn't confirmed, by words, with the client id each went under. */
const unsentReplies = new Map<string, Map<string, string>>()
/** Threads being resolved or reopened, faded until they leave their part of the list. */
const leavingThreads = ref(new Set<string>())
let isSendingReply = false
const editingComment = ref<string | null>(null)
const editText = ref('')
const editBoxes = ref<{ focus(): void }[]>([])
/** The comment whose menu is open keeps its ⋯ while the pointer is in the menu. */
const menuComment = ref<string | null>(null)
const session = useSession()
const user = computed(() => session.user.value?.id)
const { isUnread, markSeen } = useSeenThreads({
  user: user.value ?? 'Guest',
  node: props.node,
  threads: () => props.threads,
  readAt: () => props.readAt,
  openThread: () => openThread.value,
})

// Guests may sign their comments. Signed-in users never see the field (spec §10.5)
const {
  shown: showGuestName,
  text: guestName,
  atLimit: guestNameAtLimit,
  maxLength: guestNameMaxLength,
  take: takeGuestName,
} = useDriveGuestName()

const rows = computed(() => threadRows(props.threads, props.places))
const openRows = computed(() => rows.value.filter(({ thread }) => !thread.resolved))
const resolvedRows = computed(() => rows.value.filter(({ thread }) => thread.resolved))
const shownResolvedRows = computed(() => {
  if (!isResolvedShown.value) {
    return []
  }

  return resolvedRows.value
})
const shownItems = computed(() => {
  const items: ShownItem[] = openRows.value.map((row) => ({ key: row.thread.name, row }))
  if (resolvedRows.value.length) {
    items.push({ key: RESOLVED_LINE, row: null })
  }

  for (const row of shownResolvedRows.value) {
    items.push({ key: row.thread.name, row })
  }

  return items
})
const boxDrafts = computed(() => props.drafts.drafts.value.filter((draft) => !draft.isSent))
// The whole-document box takes the place of the line that starts it
const documentDraft = computed(() => boxDrafts.value.find(isOnDocument))
const textDrafts = computed(() => boxDrafts.value.filter((draft) => !isOnDocument(draft)))
const sentDrafts = computed(() => props.drafts.drafts.value.filter((draft) => draft.isSent))
const hasShownDrafts = computed(() => !!props.drafts.drafts.value.length)
const isEmpty = computed(() => !openRows.value.length && !hasShownDrafts.value)
const emptyText = computed(() => {
  if (!props.canComment) {
    return 'No open comments.'
  }

  return 'No open comments. Select text and press Comment, or add one above.'
})
const replyText = computed({
  get: () => replyTexts.value[openThread.value ?? ''] ?? '',
  set: (text: string) => {
    if (openThread.value) {
      replyTexts.value[openThread.value] = text
    }
  },
})
const hasReplyText = computed(() => !!replyText.value.trim())
const isEditBlank = computed(() => !editText.value.trim())
const guestNameHint = computed(() => {
  if (guestNameAtLimit.value) {
    return `Names can have up to ${GUEST_NAME_LIMIT} characters.`
  }

  return 'Optional. Shown with your comments.'
})

function canReply(thread: DocumentThread) {
  return !thread.resolved && props.canComment
}

function toggleResolvedShown() {
  isResolvedShown.value = !isResolvedShown.value
}

function isOpen(thread: DocumentThread) {
  return openThread.value === thread.name
}

function isClosed(thread: DocumentThread) {
  return !isOpen(thread)
}

// Opened from the list, the thread's reply box takes the cursor
async function toggleThread(thread: DocumentThread) {
  if (isOpen(thread)) {
    closeThread()
    return
  }

  openThread.value = thread.name
  await nextTick()
  replyBoxes.value[0]?.focus()
}

function closeThread() {
  openThread.value = null
}

function lightThread(thread: DocumentThread) {
  litThread.value = thread.name
}

function dimThread() {
  litThread.value = null
}

// A thread opened from its text shows in view, unfolding Resolved for a resolved one
async function showOpenThread(name: string | null) {
  const row = rows.value.find(({ thread }) => thread.name === name)
  if (!row) {
    return
  }

  if (row.thread.resolved) {
    isResolvedShown.value = true
  }

  await nextTick()
  const item = rowItems.value.find((element) => element.dataset.thread === name)
  item?.scrollIntoView({ block: 'nearest' })
}

watch(openThread, showOpenThread, { immediate: true })

// Another comment opening puts back the line in place of a whole-document box with no words
watch(openThread, (name) => {
  if (name && documentDraft.value && !documentDraft.value.text.trim()) {
    props.drafts.discard(documentDraft.value)
  }
})

function hasThread(shown: ThreadRow[], name: string | null) {
  return shown.some(({ thread }) => thread.name === name)
}

// The open thread closes once it leaves its part of the list: resolved, reopened, deleted or folded away
watch([openRows, shownResolvedRows], (shown, before) => {
  if (
    shown.some(
      (part, index) =>
        hasThread(before[index], openThread.value) && !hasThread(part, openThread.value),
    )
  ) {
    closeThread()
  }
})

// A closed panel leaves no text lit
onBeforeUnmount(() => {
  closeThread()
  dimThread()
})

// Asks only when words would be lost
async function canDiscard(text: string) {
  if (!text.trim()) {
    return true
  }

  return confirm({
    title: 'Discard comment?',
    message: "It hasn't been posted, and can't be brought back.",
    confirmLabel: 'Discard',
    destructive: true,
  })
}

function isOnDocument(draft: ShownDraft) {
  return draft.anchor === DOCUMENT_ANCHOR
}

// One whole-document box at a time; asking again puts the cursor back in it
async function startDocumentComment() {
  if (!documentDraft.value) {
    props.drafts.start(DOCUMENT_ANCHOR)
  }

  await nextTick()
  documentCard.value?.focus()
}

function writeDraft(draft: ShownDraft, text: string) {
  props.drafts.write(draft, text)
}

// Words over the limit are kept to shorten, never sent to be refused
function fitsInComment(text: string) {
  const isFitting = new TextEncoder().encode(text).length <= MAX_COMMENT_BYTES
  if (!isFitting) {
    toast.error('This comment is too long. Shorten it and try again.')
  }

  return isFitting
}

// Sending again is a retry: the same words under the same client id
async function postDraft(draft: ShownDraft) {
  if (!fitsInComment(draft.text.trim())) {
    return
  }

  const thread = await props.drafts.post(draft, takeGuestName())
  if (thread) {
    openThread.value = thread
  }
}

async function discardDraft(draft: ShownDraft) {
  if (await canDiscard(draft.text)) {
    props.drafts.discard(draft)
  }
}

async function discardSentDraft(draft: ShownDraft) {
  const isConfirmed = await confirm({
    title: 'Discard this comment?',
    message: "It hasn't been posted, and can't be brought back.",
    confirmLabel: 'Discard',
    destructive: true,
  })
  if (isConfirmed) {
    props.drafts.discard(draft)
  }
}

// Sending the same words again reuses their client id, so Drive posts them once
function replyClientId(thread: string, text: string) {
  const unsent = unsentReplies.get(thread) ?? new Map<string, string>()
  const clientId = unsent.get(text) ?? v4()
  unsent.set(text, clientId)
  unsentReplies.set(thread, unsent)
  return clientId
}

// What was typed after the sent words; all of it when the sent words themselves changed
function typedSince(now: string, sent: string) {
  if (!now.startsWith(sent)) {
    return now
  }

  return now.slice(sent.length)
}

async function submitReply(thread: DocumentThread) {
  const typed = replyTexts.value[thread.name] ?? ''
  const text = typed.trim()
  if (!text || isSendingReply || !fitsInComment(text)) {
    return
  }

  isSendingReply = true
  try {
    const clientId = replyClientId(thread.name, text)
    if (await props.actions.reply(thread.name, text, takeGuestName(), clientId)) {
      replyTexts.value[thread.name] = typedSince(replyTexts.value[thread.name] ?? '', typed)
      unsentReplies.delete(thread.name)
    }
  } finally {
    isSendingReply = false
  }
}

// Shift+Enter and a word still being composed stay in the box
function sendOnEnter(event: KeyboardEvent, thread: DocumentThread) {
  if (event.shiftKey || isComposing(event)) {
    return
  }

  event.preventDefault()
  void submitReply(thread)
}

function offerUndoResolve(thread: DocumentThread) {
  toast.success('Comment resolved', {
    duration: RESOLVED_MESSAGE_MS,
    action: { label: 'Undo', onClick: () => void setResolved(thread.name, false) },
  })
}

// One's own resolve or reopen leaves the thread seen, once the list holds it
async function setResolved(thread: string, isResolved: boolean) {
  const isChanged = await props.actions.resolve(thread, isResolved)
  if (isChanged) {
    await nextTick()
    markSeen(thread)
  }

  return isChanged
}

// A thread leaves its part of the list, so it closes and fades until it has gone
async function toggleResolved(thread: DocumentThread) {
  if (leavingThreads.value.has(thread.name)) {
    return
  }

  const isResolving = !thread.resolved
  leavingThreads.value.add(thread.name)
  const isChanged = await setResolved(thread.name, isResolving)
  leavingThreads.value.delete(thread.name)
  if (isChanged && isResolving) {
    offerUndoResolve(thread)
  }
}

function resolveLabel(thread: DocumentThread) {
  if (thread.resolved) {
    return 'Reopen'
  }

  return 'Resolve'
}

function resolveIcon(thread: DocumentThread) {
  if (thread.resolved) {
    return 'lucide-rotate-ccw'
  }

  return 'lucide-check'
}

// Open, the first comment's text sits where the closed row showed it
function threadButtonClass(thread: DocumentThread) {
  if (isOpen(thread)) {
    return 'pb-1'
  }

  return 'pb-2'
}

function commentTextClass(thread: DocumentThread, comment: ThreadComment) {
  if (isReply(thread, comment)) {
    return 'text-p-sm'
  }

  return 'text-sm'
}

function actionsClass(thread: DocumentThread) {
  if (isOpen(thread)) {
    return ''
  }

  return 'invisible group-hover:visible group-focus-within:visible'
}

async function deleteComment(comment: ThreadComment) {
  const isConfirmed = await confirm({
    title: 'Delete this comment?',
    message: "It can't be brought back.",
    confirmLabel: 'Delete',
    destructive: true,
  })
  if (isConfirmed) {
    await props.actions.removeComment(comment.name)
  }
}

// Drive lets anyone who can edit change a comment, and a signed-in author their own
function canChange(comment: ThreadComment) {
  if (!props.canComment) {
    return false
  }

  if (props.canEditDocument) {
    return true
  }

  return !!user.value && user.value !== 'Guest' && comment.author === user.value
}

function isEditing(comment: ThreadComment) {
  return editingComment.value === comment.name
}

function hasMenu(comment: ThreadComment) {
  return canChange(comment) && !isEditing(comment)
}

function menuClass(comment: ThreadComment) {
  if (menuComment.value === comment.name) {
    return ''
  }

  return 'invisible group-hover/comment:visible group-focus-within/comment:visible'
}

function noteMenu(comment: ThreadComment, isMenuOpen: boolean) {
  if (isMenuOpen) {
    menuComment.value = comment.name
  } else if (menuComment.value === comment.name) {
    menuComment.value = null
  }
}

function commentActions(comment: ThreadComment): DropdownOptions {
  return [
    { label: 'Edit', icon: 'lucide-pencil', onClick: () => startEdit(comment) },
    { label: 'Delete', icon: 'lucide-trash-2', onClick: () => deleteComment(comment) },
  ]
}

async function startEdit(comment: ThreadComment) {
  // Its menu unmounts before it can report closing
  menuComment.value = null
  editingComment.value = comment.name
  editText.value = comment.content
  await nextTick()
  editBoxes.value[0]?.focus()
}

function stopEdit() {
  editingComment.value = null
  editText.value = ''
}

// An unchanged text sends nothing; a refused one keeps the box and the words
async function saveEdit(comment: ThreadComment) {
  const text = editText.value.trim()
  if (text === comment.content) {
    stopEdit()
    return
  }

  if (!fitsInComment(text)) {
    return
  }

  if (await props.actions.editComment(comment.name, text)) {
    stopEdit()
  }
}

function isListed(name: string) {
  return props.threads.some((thread) => thread.comments.some((comment) => comment.name === name))
}

// Someone else deleted the comment being edited, so there is nothing left to save it to
function dropDeletedEdit() {
  if (!editingComment.value || isListed(editingComment.value)) {
    return
  }

  stopEdit()
  toast.warning("This comment was deleted, so your edit wasn't saved.")
}

watch(() => props.threads, dropDeletedEdit)

// A comment kept from the old Drive is stored under the owner, so its own name stands with no photo
function authorImage(comment: ThreadComment) {
  if (comment.author_name?.trim()) {
    return undefined
  }

  return comment.person?.user_image ?? undefined
}

function authorLabel(comment: ThreadComment) {
  return comment.author_name?.trim() || comment.person?.full_name || comment.author || 'Someone'
}

function firstComment(thread: DocumentThread) {
  return thread.comments[0]
}

function isReply(thread: DocumentThread, comment: ThreadComment) {
  return comment !== firstComment(thread)
}

function replies(thread: DocumentThread) {
  return thread.comments.slice(1)
}

function repliesLabel(thread: DocumentThread) {
  const count = replies(thread).length
  if (count === 1) {
    return '1 reply'
  }

  return `${count} replies`
}

defineExpose({ startDocumentComment })

function rowClass(thread: DocumentThread) {
  if (leavingThreads.value.has(thread.name)) {
    return 'pointer-events-none opacity-0'
  }

  if (isOpen(thread)) {
    return 'bg-surface-elevation-3 shadow-sm'
  }

  return 'hover:bg-surface-gray-2'
}
</script>

<template>
  <div class="space-y-3" @keydown.esc="closeThread">
    <template v-if="canComment">
      <TextInput
        v-if="showGuestName"
        v-model="guestName"
        :label="__('Your name')"
        :placeholder="__('Guest')"
        autocomplete="name"
        :maxlength="guestNameMaxLength"
        :description="guestNameHint"
      />
      <CommentDraftCard
        v-if="documentDraft"
        ref="documentCard"
        :key="documentDraft.clientId"
        :draft="documentDraft"
        @write="writeDraft(documentDraft, $event)"
        @post="postDraft(documentDraft)"
        @discard="discardDraft(documentDraft)"
      />
      <button
        v-else
        type="button"
        class="block w-full rounded-4 border border-[--surface-gray-2] bg-surface-gray-2 px-[7px] py-[5px] text-left text-sm text-ink-gray-4 hover:border-outline-elevation-2 hover:bg-surface-gray-3"
        @click="startDocumentComment"
      >
        {{ __('Add a comment') }}
      </button>
    </template>
    <CommentDraftCard
      v-for="draft in textDrafts"
      :key="draft.clientId"
      :draft
      @write="writeDraft(draft, $event)"
      @post="postDraft(draft)"
      @discard="discardDraft(draft)"
    />
    <p v-if="isEmpty" class="px-2 text-p-sm text-ink-gray-5">{{ emptyText }}</p>
    <ul class="space-y-1.5">
      <CommentDraftRow
        v-for="draft in sentDrafts"
        :key="draft.clientId"
        :draft
        @retry="postDraft(draft)"
        @discard="discardSentDraft(draft)"
      />
      <template v-for="{ key, row } in shownItems" :key>
        <li
          v-if="row"
          ref="rowItems"
          :data-thread="row.thread.name"
          class="group relative rounded-4 transition-opacity duration-200"
          :class="rowClass(row.thread)"
          @mouseenter="lightThread(row.thread)"
          @mouseleave="dimThread"
        >
          <button
            type="button"
            class="block w-full space-y-1 px-2 pt-2 text-left"
            :class="threadButtonClass(row.thread)"
            :aria-expanded="isOpen(row.thread)"
            @click="toggleThread(row.thread)"
          >
            <span class="flex items-baseline gap-1.5 pr-8 text-xs text-ink-gray-5">
              <span class="min-w-0 text-sm-medium text-ink-gray-7">
                <DriveCommentAuthor
                  :author="firstComment(row.thread).author"
                  :author-name="firstComment(row.thread).author_name"
                  >{{ authorLabel(firstComment(row.thread)) }}</DriveCommentAuthor
                >
              </span>
              <span v-if="row.where" class="shrink-0">{{ row.where }}</span>
              <span v-if="isUnread(row.thread)" class="flex shrink-0 items-center self-center">
                <span class="size-1.5 rounded-full bg-surface-amber-7" aria-hidden="true" />
                <span class="sr-only">{{ __('Unread') }}</span>
              </span>
              <span class="shrink-0">{{ dayOrTime(firstComment(row.thread)) }}</span>
            </span>
            <span v-if="row.quote" class="block py-0.5">
              <span class="block truncate border-l-2 pl-2 text-sm text-ink-gray-5">
                {{ row.quote }}
              </span>
            </span>
            <span v-if="isClosed(row.thread)" class="flex gap-1 text-sm">
              <span class="min-w-0 flex-1 truncate text-ink-gray-7">
                <CommentText
                  :content="firstComment(row.thread).content"
                  :mentions="firstComment(row.thread).mentions"
                />
              </span>
              <span v-if="replies(row.thread).length" class="shrink-0 text-ink-gray-5">
                · {{ repliesLabel(row.thread) }}
              </span>
            </span>
          </button>
          <div
            v-if="canComment"
            class="absolute right-2 top-[3px] flex items-center"
            :class="actionsClass(row.thread)"
          >
            <Button
              size="sm"
              variant="ghost"
              :icon="resolveIcon(row.thread)"
              :aria-label="resolveLabel(row.thread)"
              @click="toggleResolved(row.thread)"
            />
          </div>
          <template v-if="isOpen(row.thread)">
            <div class="space-y-2 px-2 pb-2">
              <div
                v-for="comment in row.thread.comments"
                :key="comment.name"
                class="group/comment relative space-y-1"
              >
                <p
                  v-if="isReply(row.thread, comment)"
                  class="flex items-center gap-2 pr-8 text-sm-medium text-ink-gray-7"
                >
                  <Avatar
                    v-if="comment.person"
                    :image="authorImage(comment)"
                    :label="authorLabel(comment)"
                    size="sm"
                    shape="circle"
                  />
                  <span class="flex min-w-0 flex-1 items-baseline gap-2">
                    <DriveCommentAuthor
                      :author="comment.author"
                      :author-name="comment.author_name"
                      >{{ authorLabel(comment) }}</DriveCommentAuthor
                    >
                    <span class="flex-1 text-xs text-ink-gray-5">{{ dayOrTime(comment) }}</span>
                  </span>
                </p>
                <form
                  v-if="isEditing(comment)"
                  class="space-y-2"
                  @submit.prevent="saveEdit(comment)"
                >
                  <MentionTextarea
                    ref="editBoxes"
                    v-model="editText"
                    :mentions="comment.mentions"
                    :rows="2"
                    :aria-label="__('Edit comment')"
                    @keydown.esc.stop.prevent="stopEdit"
                  />
                  <div class="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" :label="__('Cancel')" @click="stopEdit" />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      :label="__('Save')"
                      :disabled="isEditBlank"
                    />
                  </div>
                </form>
                <p
                  v-else
                  class="whitespace-pre-wrap pr-8 text-ink-gray-7"
                  :class="commentTextClass(row.thread, comment)"
                >
                  <CommentText :content="comment.content" :mentions="comment.mentions" />
                </p>
                <div
                  v-if="hasMenu(comment)"
                  class="absolute -top-1 right-0"
                  :class="menuClass(comment)"
                >
                  <Dropdown
                    :options="commentActions(comment)"
                    align="end"
                    @update:open="noteMenu(comment, $event)"
                  >
                    <button
                      type="button"
                      class="flex size-7 items-center justify-center text-ink-gray-5 hover:text-ink-gray-8"
                      :aria-label="__('More comment actions')"
                    >
                      <span class="lucide-ellipsis size-4" aria-hidden="true" />
                    </button>
                  </Dropdown>
                </div>
              </div>
              <form v-if="canReply(row.thread)" @submit.prevent="submitReply(row.thread)">
                <div class="relative">
                  <MentionTextarea
                    ref="replyBoxes"
                    v-model="replyText"
                    :rows="1"
                    class="pr-8"
                    :placeholder="__('Reply')"
                    :aria-label="__('Reply')"
                    @keydown.enter="sendOnEnter($event, row.thread)"
                  />
                  <!-- 3px puts the glyph at the textarea's 9px text inset, border included -->
                  <Button
                    v-if="hasReplyText"
                    type="submit"
                    class="absolute bottom-1 right-[3px]"
                    size="sm"
                    variant="ghost"
                    icon="lucide-arrow-up"
                    :aria-label="__('Send reply')"
                  />
                </div>
              </form>
            </div>
          </template>
        </li>
        <li v-else role="none" class="pt-2 first:pt-0">
          <button
            type="button"
            class="group flex w-full items-center rounded-4 px-2 py-1.5 text-left text-sm text-ink-gray-5 hover:bg-surface-gray-2"
            :aria-expanded="isResolvedShown"
            @click="toggleResolvedShown"
          >
            {{ __('Resolved · {0}', [resolvedRows.length]) }}
            <span
              class="lucide-chevron-right ml-auto size-4 transition-transform duration-200 group-aria-expanded:rotate-90"
              aria-hidden="true"
            />
          </button>
        </li>
      </template>
    </ul>
  </div>
</template>
