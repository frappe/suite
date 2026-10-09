<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Avatar, Badge, Button, Skeleton, TextInput, toast } from 'frappe-ui'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowRef,
  toRefs,
  watch,
} from 'vue'

import { api, useMutation } from '@/api'
import {
  DriveCommentAuthor,
  DriveDocumentHeader,
  formatDriveDateTime,
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

import {
  resolveDocumentUnload,
  useDocumentLeaveGuard,
  type DocumentSaveState,
  type LeaveGuardOptions,
} from './navigation'
import { clearRecovery, downloadRecovery, keepRecovery, readRecovery } from './recovery'
import { useWriterCollab } from './useWriterCollab'
import VersionPreview from './VersionPreview.vue'
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

interface VersionPage {
  rows?: VersionRow[]
  next_cursor?: string | null
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
const previewing = ref<VersionRow | null>(null)
const sidePanel = computed(() => showComments.value || showVersions.value)
const versionsCursor = ref<string | null>(null)
const loadingMoreVersions = ref(false)
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
} = useWriterCollab(props.session, retainRecovery, () => writes.writable.value)

const writes = createWriteGate(props.session, () => {
  const roomUnsaved = collabLive.value && saveState.value !== 'clean'
  const unsaved = dirty.value || roomUnsaved
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
const version = useMutation(api.drive.versions.create, {
  context: props.session.credentials.context,
  silent: true,
})
const automaticVersion: DocumentWrite = {
  get isPending() {
    return version.isPending
  },
  get error() {
    return version.error
  },
  run: () => version.run({ node: props.session.nodeId, kind: 'auto' }),
}
const documentResource = writes.guard(
  reactive({ ...toRefs(writerDocument), newVersion: automaticVersion }) as WriterDocumentResource,
  ['saveDoc', 'saveHtml', 'newVersion'],
)

const readable = computed(() => props.session.state.value !== 'Refused' && writes.role.value >= 10)
const canComment = computed(
  () => props.session.state.value === 'Active' && writes.role.value >= COMMENT,
)
const saving = computed(
  () => !!documentResource.saveDoc?.isPending || !!documentResource.saveHtml?.isPending,
)
const saveFailed = computed(
  () => !!documentResource.saveDoc?.error || !!documentResource.saveHtml?.error,
)
const resourceSaveState = computed<DocumentSaveState>(() =>
  saving.value ? 'saving' : saveFailed.value ? 'failed' : dirty.value ? 'unsaved' : 'clean',
)
const saveState = computed<DocumentSaveState>(() => roomSaveState.value ?? resourceSaveState.value)
const savingPaused = computed(() => !!roomPaused.value && saveState.value !== 'failed')
const saveNote = computed(() =>
  [savingPaused.value && 'Saving paused', roomUnsent.value && `${roomUnsent.value} unsent`]
    .filter(Boolean)
    .join(' · '),
)
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
/** The editor that shows this document, with the props only it takes. */
const editorView = computed(() => {
  if (collabLive.value && room.value) {
    return {
      is: CollabTextEditor,
      props: {
        room: room.value,
        file: fakeFileResource.value,
      },
    }
  }

  const dirtyModel = {
    dirty: dirty.value,
    'onUpdate:dirty': (value: boolean) => (dirty.value = value),
  }
  if (documentResource.doc?.collab === 0) {
    return {
      is: NonCollabEditor,
      props: {
        ...dirtyModel,
        file: fakeFileResource.value.doc,
      },
    }
  }

  return {
    is: TextEditor,
    props: {
      ...dirtyModel,
      file: fakeFileResource.value,
    },
  }
})

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
      const page = (await props.session.versions.list()) as VersionPage
      versions.value = page.rows ?? []
      versionsCursor.value = page.next_cursor ?? null
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not load this panel.')
  } finally {
    panelLoading.value = false
  }
}

function versionLabel(version: VersionRow) {
  return version.label || `Version ${version.seq}`
}

async function closePreview() {
  const row = document.querySelector<HTMLElement>('aside button[aria-pressed="true"]')
  previewing.value = null
  await nextTick()
  if (row) {
    row.focus()
  } else {
    editorSurface.value?.editor?.commands.focus()
  }
}

async function loadMoreVersions() {
  if (!versionsCursor.value) return

  loadingMoreVersions.value = true
  try {
    const page = (await props.session.versions.list(versionsCursor.value)) as VersionPage
    versions.value = [...versions.value, ...(page.rows ?? [])]
    versionsCursor.value = page.next_cursor ?? null
  } catch (error) {
    // A failed next page keeps the rows already shown.
    toast.error(error instanceof Error ? error.message : 'Could not load more versions.')
  } finally {
    loadingMoreVersions.value = false
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

  const saved = new Promise<void>((resolve) => {
    emitter.emit('manual-save', () => resolve())
  })
  return withinTenSeconds(saved)
}

useDocumentLeaveGuard({ state: () => saveState.value, flush, retainRecovery })

function warnBeforeUnload(event: Event) {
  const unloadGuard: Pick<LeaveGuardOptions, 'state' | 'retainRecovery'> = {
    state: () => (collabLive.value ? saveState.value : 'clean'),
    retainRecovery,
  }
  resolveDocumentUnload(unloadGuard, event)
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
          {{ saveNote }}
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

    <div class="relative flex min-h-0 flex-1 flex-col">
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
      <template v-else>
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <component
            :is="editorView.is"
            ref="editorSurface"
            v-bind="editorView.props"
            :document="documentResource"
            :settings="settings"
            :editable="editable"
          >
            <template v-if="previewing" #toolbar>
              <div
                class="flex shrink-0 items-center justify-between gap-3 border-b border-outline-elevation-2 px-5 py-1.5"
                role="status"
              >
                <p class="truncate text-sm text-ink-gray-7">
                  Viewing {{ versionLabel(previewing) }}
                </p>
                <Button size="sm" variant="ghost" label="Back to current" @click="closePreview" />
              </div>
            </template>
            <template v-if="previewing" #cover>
              <VersionPreview :session="session" :seq="previewing.seq" :settings="settings" />
            </template>
            <template #aside>
              <Transition
                enter-active-class="md:transition-[width] md:duration-300 md:ease-in-out"
                enter-from-class="md:!w-0"
                leave-active-class="md:transition-[width] md:duration-300 md:ease-in-out"
                leave-to-class="md:!w-0"
              >
                <aside
                  v-if="sidePanel"
                  :aria-label="showComments ? 'Comments' : 'Versions'"
                  class="absolute bottom-0 right-0 top-0 z-20 w-full overflow-hidden border-l border-outline-gray-1 bg-surface-elevation-1 shadow-xl md:static md:w-80 md:shrink-0 md:border-outline-gray-2 md:bg-surface-base md:shadow-none"
                >
                  <div class="flex h-full w-full flex-col md:w-80 md:p-2">
                    <div
                      class="flex min-h-12 items-center justify-between border-b px-4 md:min-h-0 md:border-b-0 md:pb-1 md:pl-2 md:pr-1"
                    >
                      <h2 class="text-lg-semibold md:text-base-medium md:text-ink-gray-8">
                        {{ showComments ? 'Comments' : 'Versions' }}
                      </h2>
                      <Button
                        icon="lucide-x"
                        aria-label="Close panel"
                        variant="ghost"
                        @click="showComments = showVersions = false"
                      />
                    </div>
                    <div
                      class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 md:px-2 md:pb-2 md:pt-0.5"
                    >
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
                              <DriveCommentAuthor
                                :author="comment.author"
                                :author-name="comment.author_name"
                                >{{
                                  comment.person?.full_name || comment.author || 'Someone'
                                }}</DriveCommentAuthor
                              >
                            </p>
                            <p class="whitespace-pre-wrap text-p-sm text-ink-gray-7">
                              {{ comment.content }}
                            </p>
                          </div>
                        </article>
                        <p v-if="!threads.length" class="text-sm text-ink-gray-5">
                          No comments yet.
                        </p>
                      </template>
                      <template v-else>
                        <button
                          v-for="version in versions"
                          :key="version.seq"
                          type="button"
                          class="block w-full rounded-4 p-3 text-left"
                          :class="
                            previewing?.seq === version.seq
                              ? 'bg-surface-gray-3'
                              : 'bg-surface-gray-1 hover:bg-surface-gray-2'
                          "
                          :aria-pressed="previewing?.seq === version.seq"
                          @click="previewing = version"
                        >
                          <p class="text-sm-medium text-ink-gray-8">{{ versionLabel(version) }}</p>
                          <p class="text-p-xs text-ink-gray-5">
                            {{
                              [
                                version.actor,
                                version.creation && formatDriveDateTime(version.creation),
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            }}
                          </p>
                        </button>
                        <p v-if="!versions.length" class="text-sm text-ink-gray-5">
                          No versions yet.
                        </p>
                        <Button
                          v-if="versionsCursor"
                          class="w-full"
                          label="Load more"
                          :loading="loadingMoreVersions"
                          @click="loadMoreVersions"
                        />
                      </template>
                    </div>
                  </div>
                </aside>
              </Transition>
            </template>
          </component>
        </div>
      </template>
    </div>
  </div>
</template>
