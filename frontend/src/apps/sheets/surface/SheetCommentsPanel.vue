<script setup lang="ts">
import { Button, Skeleton, Textarea, TextInput, toast } from 'frappe-ui'
import { computed, onMounted, ref } from 'vue'

import {
  DriveCommentAuthor,
  GUEST_NAME_LIMIT,
  useDriveGuestName,
  type DocumentSession,
} from '@/apps/drive'

import { cellAnchor, readThreads, stampLabel, type CellAnchor, type SheetThread } from './records'

const props = defineProps<{
  session: DocumentSession
  /** The editor's active cell, where a new thread is anchored. */
  cursor: CellAnchor | null
  canComment: boolean
}>()
const emit = defineEmits<{ close: []; select: [anchor: CellAnchor] }>()

const threads = ref<SheetThread[]>([])
const loading = ref(true)
const loadError = ref('')
const draft = ref('')
const replies = ref<Record<string, string>>({})
const busy = ref(false)
// Guests may sign their comments and replies. Signed-in users never see the field (spec §10.5).
const {
  shown: showGuestName,
  text: guestName,
  atLimit: guestNameAtLimit,
  maxLength: guestNameMaxLength,
  take: takeGuestName,
} = useDriveGuestName()

const openThreads = computed(() => threads.value.filter((thread) => !thread.resolved))
const resolvedThreads = computed(() => threads.value.filter((thread) => thread.resolved))

async function load() {
  try {
    threads.value = readThreads(await props.session.comments.list())
    loadError.value = ''
  } catch (error) {
    loadError.value = message(error, 'Check your connection, then try again.')
  } finally {
    loading.value = false
  }
}

async function retry() {
  loading.value = true
  await load()
}

async function run(action: () => Promise<unknown>, failure: string) {
  busy.value = true
  try {
    await action()
    await load()
    return true
  } catch (error) {
    toast.error(message(error, failure))
    return false
  } finally {
    busy.value = false
  }
}

async function create() {
  const text = draft.value.trim()
  if (!text || !props.cursor) return
  const anchor = cellAnchor(props.cursor)
  if (
    await run(
      () => props.session.comments.create(anchor, text, takeGuestName()),
      'Could not add the comment.',
    )
  ) {
    draft.value = ''
  }
}

async function reply(thread: string) {
  const text = replies.value[thread]?.trim()
  if (!text) return
  if (
    await run(
      () => props.session.comments.reply(thread, text, takeGuestName()),
      'Could not add the reply.',
    )
  ) {
    replies.value[thread] = ''
  }
}

function resolve(thread: SheetThread) {
  void run(
    () => props.session.comments.resolve(thread.name, !thread.resolved),
    thread.resolved ? 'Could not reopen the thread.' : 'Could not resolve the thread.',
  )
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

onMounted(load)
</script>

<template>
  <aside
    class="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-l border-outline-gray-2 bg-surface-base text-ink-gray-8 shadow-xl"
    aria-label="Comments"
    @click.stop
    @keydown.stop
  >
    <header
      class="flex min-h-12 shrink-0 items-center justify-between border-b border-outline-gray-1 pl-4 pr-2"
    >
      <h2 class="text-lg-semibold">Comments</h2>
      <Button icon="lucide-x" variant="ghost" aria-label="Close comments" @click="emit('close')" />
    </header>

    <form
      v-if="canComment"
      class="shrink-0 space-y-2 border-b border-outline-gray-1 p-4"
      @submit.prevent="create"
    >
      <TextInput
        v-if="showGuestName"
        v-model="guestName"
        label="Your name"
        placeholder="Guest"
        autocomplete="name"
        :maxlength="guestNameMaxLength"
        :description="
          guestNameAtLimit
            ? `Names can have up to ${GUEST_NAME_LIMIT} characters.`
            : 'Optional. Shown with your comments.'
        "
      />
      <Textarea
        v-model="draft"
        :rows="2"
        :placeholder="cursor ? `Comment on ${cursor.cell}` : 'Select a cell to comment on it'"
        aria-label="New comment"
      />
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-sm text-ink-gray-5">{{
          cursor ? `${cursor.sheet} · ${cursor.cell}` : ''
        }}</span>
        <Button
          type="submit"
          variant="solid"
          label="Comment"
          :disabled="!draft.trim() || !cursor"
          :loading="busy"
        />
      </div>
    </form>

    <div class="min-h-0 flex-1 overflow-y-auto pb-10">
      <div v-if="loading" class="space-y-3 p-4" aria-hidden="true">
        <Skeleton v-for="row in 3" :key="row" class="h-16 w-full rounded-4" />
      </div>
      <div v-else-if="loadError" class="px-4 py-10 text-center" role="alert">
        <p class="text-p-sm text-ink-gray-7">Comments could not be loaded.</p>
        <p class="mt-1.5 text-p-sm text-ink-gray-5">{{ loadError }}</p>
        <Button class="mt-4" label="Retry" icon-left="lucide-refresh-cw" @click="retry" />
      </div>
      <p v-else-if="!threads.length" class="px-4 py-10 text-center text-p-sm text-ink-gray-5">
        No comments yet.
      </p>
      <template v-else>
        <section
          v-for="group in [openThreads, resolvedThreads]"
          :key="group === openThreads ? 'open' : 'resolved'"
        >
          <h3
            v-if="group === resolvedThreads && group.length"
            class="px-4 pt-4 text-sm text-ink-gray-5"
          >
            Resolved
          </h3>
          <article
            v-for="thread in group"
            :key="thread.name"
            class="space-y-3 border-b border-outline-gray-1 p-4"
            :class="{ 'text-ink-gray-6': thread.resolved }"
          >
            <div class="flex items-center justify-between gap-2">
              <Button
                v-if="thread.anchor"
                size="sm"
                variant="subtle"
                icon-left="lucide-table-2"
                :label="`${thread.anchor.sheet} · ${thread.anchor.cell}`"
                @click="emit('select', thread.anchor)"
              />
              <span v-else class="text-sm text-ink-gray-5">Spreadsheet</span>
              <Button
                v-if="canComment"
                size="sm"
                variant="ghost"
                :label="thread.resolved ? 'Reopen' : 'Resolve'"
                :disabled="busy"
                @click="resolve(thread)"
              />
            </div>
            <div v-for="comment in thread.comments" :key="comment.name" class="space-y-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="min-w-0 text-sm-medium text-ink-gray-8">
                  <DriveCommentAuthor :author="comment.author" :author-name="comment.author_name">{{
                    comment.author_name || comment.author || 'Someone'
                  }}</DriveCommentAuthor>
                </span>
                <span class="shrink-0 text-xs text-ink-gray-5">{{
                  stampLabel(comment.creation)
                }}</span>
              </div>
              <p class="whitespace-pre-wrap break-words text-p-sm text-ink-gray-7">
                {{ comment.content }}
              </p>
            </div>
            <form
              v-if="canComment && !thread.resolved"
              class="flex items-end gap-2"
              @submit.prevent="reply(thread.name)"
            >
              <Textarea
                v-model="replies[thread.name]"
                class="flex-1"
                :rows="1"
                placeholder="Reply"
                :aria-label="`Reply to the thread on ${thread.anchor?.cell ?? 'the spreadsheet'}`"
              />
              <Button
                type="submit"
                label="Reply"
                :disabled="!replies[thread.name]?.trim() || busy"
              />
            </form>
          </article>
        </section>
      </template>
    </div>
  </aside>
</template>
