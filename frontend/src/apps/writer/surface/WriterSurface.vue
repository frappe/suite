<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Avatar, Badge, Button, Skeleton, TextInput, toast } from 'frappe-ui'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowRef,
  toRefs,
  watch,
} from 'vue'

import {
  DriveCommentAuthor,
  DriveDocumentHeader,
  GUEST_NAME_LIMIT,
  useDriveGuestName,
  type DocumentPanel,
  type DocumentSession,
} from '@/apps/drive'
import { withinTenSeconds } from '@/apps/writer/collab'
import CollabTextEditor from '@/apps/writer/components/CollabTextEditor.vue'
import NonCollabEditor from '@/apps/writer/components/NonCollabEditor.vue'
import TextEditor from '@/apps/writer/components/TextEditor.vue'
import UsersBar from '@/apps/writer/components/UsersBar.vue'
import type { CollaborationUser } from '@/apps/writer/composables/useCollaborationUsers'
import emitter from '@/apps/writer/emitter'
import { DOCUMENT_MEDIA } from '@/apps/writer/extensions/drive-media'
import { RENAME_DOCUMENT } from '@/apps/writer/renameDocument'
import { belowMinBuild } from '@/platform/build'

import { resolveDocumentUnload, useDocumentLeaveGuard, type DocumentSaveState } from './navigation'
import { clearRecovery, downloadRecovery, keepRecovery, readRecovery } from './recovery'
import { useWriterCollab } from './useWriterCollab'
import { createWriterDocument, isLocked, type WriterDocument } from './writerDocument'
import WriterDocumentMenu from './WriterDocumentMenu.vue'
import { createWriteGate, type DocumentWrite } from './writes'

const COMMENT = 20

interface WriterDocumentResource extends WriterDocument {
  newVersion: DocumentWrite
}

/** `GET nodes/<id>/threads` */
interface CommentThread {
  name: string
  resolved: boolean
  comments: {
    name: string
    content: string
    author: string | null
    /** The name a guest typed. */
    author_name: string | null
    /** The signed-in author; absent for a guest. */
    person?: { id: string; full_name: string; user_image: string | null }
    creation: string | null
  }[]
}

/** One row of `GET nodes/<id>/versions` */
interface VersionRow {
  seq: number
  kind: string
  label: string | null
  actor: string | null
  creation: string | null
}

/** What `TextEditor` and `NonCollabEditor` expose. */
interface EditorSurface {
  editor?: Editor | null
  /** Other people in the document; only the collaborative editor has them. */
  peers?: CollaborationUser[]
}

const props = defineProps<{ session: DocumentSession }>()
const editorSurface = shallowRef<EditorSurface | null>(null)
/** The editor's own unsaved flag, bound to its `dirty` model. */
const dirty = ref(false)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const showComments = ref(false)
const showVersions = ref(false)
const threads = ref<CommentThread[]>([])
const versions = ref<VersionRow[]>([])
const panelLoading = ref(false)
const commentText = ref('')
// Guests may sign their comments. Signed-in users never see the field (spec §10.5).
const {
  shown: showGuestName,
  text: guestName,
  atLimit: guestNameAtLimit,
  maxLength: guestNameMaxLength,
  take: takeGuestName,
} = useDriveGuestName()
const hasRecovery = ref(readRecovery(props.session.nodeId) !== null)
const {
  mode: collab,
  room,
  live: collabLive,
  allowsEditing,
  editingPaused,
  saveState: roomSaveState,
  unsent: roomUnsent,
  paused: roomPaused,
  banner,
  openFailure,
  open: openCollab,
  close: closeCollab,
} = useWriterCollab(props.session, retainRecovery)

const writes = createWriteGate(props.session, () => {
  const unsaved = dirty.value || (collabLive.value && saveState.value !== 'clean')
  if (unsaved) retainRecovery()
  editorSurface.value?.editor?.setEditable(false)
  if (!unsaved) {
    toast.warning('Editing access changed. This document is now read-only.')
    return
  }
  toast.warning('Editing access changed. Your unsaved changes are kept on this device.', {
    duration: Number.POSITIVE_INFINITY,
    action: { label: 'Download my changes', onClick: downloadChanges },
  })
})
const writerDocument = createWriterDocument(props.session)
// Drive owns this document's history, and `new_version` refuses a Drive
// document. The editor's automatic version is skipped until Writer takes
// versions through Drive.
const noAutomaticVersion: DocumentWrite = { loading: false, error: null, submit: async () => null }
const documentResource = writes.guard(
  reactive({ ...toRefs(writerDocument), newVersion: noAutomaticVersion }) as WriterDocumentResource,
  ['saveDoc', 'saveHtml'],
)

const readable = computed(() => props.session.state.value !== 'Refused' && writes.role.value >= 10)
const canComment = computed(
  () => props.session.state.value === 'Active' && writes.role.value >= COMMENT,
)
const saving = computed(
  () => !!documentResource.saveDoc?.loading || !!documentResource.saveHtml?.loading,
)
const saveFailed = computed(
  () => !!documentResource.saveDoc?.error || !!documentResource.saveHtml?.error,
)
const saveState = computed<DocumentSaveState>(
  () =>
    roomSaveState.value ??
    (saving.value ? 'saving' : saveFailed.value ? 'failed' : dirty.value ? 'unsaved' : 'clean'),
)
const savingPaused = computed(() => !!roomPaused.value && saveState.value !== 'failed')
const settings = computed(() => documentResource.doc?.settings ?? {})
const editable = computed(
  () =>
    readable.value &&
    writes.writable.value &&
    !isLocked(settings.value) &&
    allowsEditing.value &&
    !belowMinBuild('writer'),
)
const showEditingPaused = computed(
  () => !editable.value && editingPaused.value && writes.writable.value,
)
const fakeFileResource = computed(() => ({
  doc: {
    name: props.session.nodeId,
    file_name: props.session.title.value,
    write: editable.value,
    modified: new Date().toISOString(),
  },
}))
const peers = computed(() => editorSurface.value?.peers ?? [])

provide('file', fakeFileResource)
provide(
  'isOffline',
  computed(() => !online.value),
)
provide(RENAME_DOCUMENT, async (title) => {
  await props.session.rename(title)
})
provide(DOCUMENT_MEDIA, (id) => props.session.media(id))

// A save that lands with edit access makes the recovery copy stale.
watch(saving, (now, before) => {
  if (!before || now || saveFailed.value || !writes.writable.value || !hasRecovery.value) return
  clearRecovery(props.session.nodeId)
  hasRecovery.value = false
})

const panel = computed<DocumentPanel | null>({
  get: () => (showComments.value ? 'comments' : showVersions.value ? 'versions' : null),
  set(kind) {
    showComments.value = kind === 'comments'
    showVersions.value = kind === 'versions'
    if (kind) void loadPanel(kind)
  },
})

async function loadPanel(kind: DocumentPanel) {
  panelLoading.value = true
  try {
    if (kind === 'comments') {
      const result = (await props.session.comments.list()) as { threads?: CommentThread[] }
      threads.value = result.threads ?? []
    } else {
      const result = (await props.session.versions.list()) as { rows?: VersionRow[] }
      versions.value = result.rows ?? []
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not load this panel.')
  } finally {
    panelLoading.value = false
  }
}

async function addComment() {
  const text = commentText.value.trim()
  if (!text || !canComment.value) return
  try {
    await props.session.comments.create('document', text, takeGuestName())
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not add the comment.')
    return
  }
  commentText.value = ''
  await loadPanel('comments')
}

function retainRecovery(): boolean {
  const html = editorSurface.value?.editor?.getHTML()
  if (!html) return false
  try {
    keepRecovery(props.session.nodeId, html)
  } catch {
    return false
  }
  hasRecovery.value = true
  return true
}

function downloadChanges() {
  const downloaded = downloadRecovery(props.session.nodeId, props.session.title.value)
  hasRecovery.value = false
  if (!downloaded) toast.error('No recovery copy is kept for this document.')
}

function flush(): Promise<void> {
  if (room.value) return withinTenSeconds(room.value.flush())
  if (!dirty.value && !saving.value) return Promise.resolve()
  return withinTenSeconds(
    new Promise((resolve) => {
      emitter.emit('manual-save', () => resolve())
    }),
  )
}

useDocumentLeaveGuard({ state: () => saveState.value, flush, retainRecovery })

function warnBeforeUnload(event: Event) {
  resolveDocumentUnload(
    { state: () => (collabLive.value ? saveState.value : 'clean'), retainRecovery },
    event,
  )
}

function setOnline() {
  online.value = true
  void room.value?.pull()
}
function setOffline() {
  online.value = false
  void room.value?.pull()
}
onMounted(() => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOffline)
  window.addEventListener('beforeunload', warnBeforeUnload)
  void openCollab()
})
onBeforeUnmount(() => {
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOffline)
  window.removeEventListener('beforeunload', warnBeforeUnload)
  closeCollab()
})
</script>

<template>
  <div class="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-base">
    <DriveDocumentHeader
      v-model:panel="panel"
      :session="session"
      title-label="Document title"
      :save-state="savingPaused ? null : saveState"
      :view-only="!editable && !showEditingPaused"
      :recoverable="hasRecovery"
      :panels="['comments', 'versions']"
      @download-changes="downloadChanges"
    >
      <template #status>
        <Badge
          v-if="showEditingPaused"
          label="Editing paused"
          theme="gray"
          variant="subtle"
          class="shrink-0"
        />
      </template>
      <template #actions>
        <span
          v-if="savingPaused || roomUnsent"
          class="mr-1 whitespace-nowrap text-sm text-ink-gray-5"
          aria-live="polite"
        >
          {{
            [savingPaused && 'Saving paused', roomUnsent && `${roomUnsent} unsent`]
              .filter(Boolean)
              .join(' · ')
          }}
        </span>
        <UsersBar v-if="peers.length" :users="peers" />
        <WriterDocumentMenu
          v-if="readable"
          :session="session"
          :editor="editorSurface?.editor ?? null"
          :settings="settings"
          :editable="editable"
        />
      </template>
    </DriveDocumentHeader>

    <div
      v-if="banner"
      class="shrink-0 border-b border-outline-gray-1 bg-surface-amber-2 px-5 py-2 text-sm text-ink-amber-7"
      role="status"
    >
      {{ banner.text
      }}<a v-if="banner.link" :href="banner.link.href" target="_blank" class="underline">{{
        banner.link.label
      }}</a
      >{{ banner.after }}
    </div>

    <div v-if="!readable" class="m-auto text-center">
      <span class="lucide-lock-keyhole mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">
        You no longer have permission to read this document.
      </p>
    </div>
    <div v-else-if="collab === 'failed'" class="m-auto text-center">
      <p class="text-p-sm text-ink-gray-6">{{ openFailure }}</p>
      <Button class="mt-3" label="Try again" @click="openCollab" />
    </div>
    <div
      v-else-if="!documentResource.doc || collab === 'opening'"
      class="mx-auto w-full max-w-[770px] space-y-3 px-5 pt-10"
    >
      <Skeleton
        v-for="width in ['70%', '92%', '84%', '60%', '88%']"
        :key="width"
        class="h-3.5 rounded-4"
        :style="{ width }"
      />
    </div>
    <div v-else class="flex min-h-0 flex-1 overflow-hidden">
      <CollabTextEditor
        v-if="collabLive && room"
        ref="editorSurface"
        :room="room"
        :file="fakeFileResource"
        :document="documentResource"
        :settings="settings"
        :editable="editable"
      />
      <NonCollabEditor
        v-else-if="documentResource.doc.collab === 0"
        ref="editorSurface"
        v-model:dirty="dirty"
        :file="fakeFileResource.doc"
        :document="documentResource"
        :settings="settings"
        :editable="editable"
      />
      <TextEditor
        v-else
        ref="editorSurface"
        v-model:dirty="dirty"
        :file="fakeFileResource"
        :document="documentResource"
        :settings="settings"
        :editable="editable"
      />
    </div>

    <aside
      v-if="showComments || showVersions"
      :aria-label="showComments ? 'Comments' : 'Versions'"
      class="absolute bottom-0 right-0 top-12 z-20 flex w-full flex-col md:w-80 border-l border-outline-gray-1 bg-surface-elevation-1 shadow-xl"
    >
      <div class="flex min-h-12 items-center justify-between border-b px-4">
        <h2 class="text-lg-semibold">{{ showComments ? 'Comments' : 'Versions' }}</h2>
        <Button
          icon="lucide-x"
          aria-label="Close panel"
          variant="ghost"
          @click="showComments = showVersions = false"
        />
      </div>
      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p v-if="panelLoading" class="text-sm text-ink-gray-5">Loading…</p>
        <template v-else-if="showComments">
          <form v-if="canComment" class="space-y-2" @submit.prevent="addComment">
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
            <div class="flex gap-2">
              <TextInput
                v-model="commentText"
                class="flex-1"
                placeholder="Add a comment"
                aria-label="New comment"
              />
              <Button type="submit" label="Add" :disabled="!commentText.trim()" />
            </div>
          </form>
          <article
            v-for="thread in threads"
            :key="thread.name"
            class="space-y-2 rounded-4 bg-surface-gray-1 p-3"
            :class="thread.resolved && 'opacity-60'"
          >
            <div v-for="comment in thread.comments" :key="comment.name">
              <p class="flex items-center gap-2 text-sm-medium text-ink-gray-8">
                <Avatar
                  v-if="comment.person"
                  :image="comment.person.user_image ?? undefined"
                  :label="comment.person.full_name"
                  size="sm"
                  shape="circle"
                />
                <DriveCommentAuthor :author="comment.author" :author-name="comment.author_name">{{
                  comment.person?.full_name || comment.author || 'Someone'
                }}</DriveCommentAuthor>
              </p>
              <p class="whitespace-pre-wrap text-p-sm text-ink-gray-7">{{ comment.content }}</p>
            </div>
          </article>
          <p v-if="!threads.length" class="text-sm text-ink-gray-5">No comments yet.</p>
        </template>
        <template v-else>
          <div
            v-for="version in versions"
            :key="version.seq"
            class="rounded-4 bg-surface-gray-1 p-3"
          >
            <p class="text-sm-medium text-ink-gray-8">
              {{ version.label || `Version ${version.seq}` }}
            </p>
            <p class="text-p-xs text-ink-gray-5">
              {{ [version.actor, version.creation].filter(Boolean).join(' · ') }}
            </p>
          </div>
          <p v-if="!versions.length" class="text-sm text-ink-gray-5">No versions yet.</p>
        </template>
      </div>
    </aside>
  </div>
</template>
