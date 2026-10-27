<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Badge, Button, dialog, Skeleton, toast } from 'frappe-ui'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  DriveDocumentHeader,
  type DocumentPanel,
  type DocumentSession,
  type DocumentThread,
  type DocumentVersion,
} from '@/apps/drive'
import type { ThreadPlaces } from '@/apps/writer/collab/highlights'
import type { peopleOf } from '@/apps/writer/collab/peers'
import { withinTenSeconds } from '@/apps/writer/collab/timeout'
import CollabTextEditor from '@/apps/writer/components/CollabTextEditor.vue'
import DocumentStrip from '@/apps/writer/components/DocumentStrip.vue'
import ReadOnlyEditor from '@/apps/writer/components/ReadOnlyEditor.vue'
import UsersBar from '@/apps/writer/components/UsersBar.vue'
import { DOCUMENT_MEDIA } from '@/apps/writer/extensions/drive-media'
import {
  downloadCopy,
  keepPageCopy,
  listCopies,
  savedAtLabel,
  type RecoveryCopy,
} from '@/apps/writer/recovery/copies'
import { keepDeviceCopies } from '@/apps/writer/recovery/deviceCopies'
import RecoveryBanner from '@/apps/writer/recovery/RecoveryBanner.vue'
import RecoveryCopyActions from '@/apps/writer/recovery/RecoveryCopyActions.vue'
import RecoveryPreview from '@/apps/writer/recovery/RecoveryPreview.vue'
import { RENAME_DOCUMENT } from '@/apps/writer/renameDocument'
import { belowMinBuild } from '@/platform/build'
import { watchConversion, type CollabRoom } from '@/platform/collab'
import { useSession } from '@/platform/session'

import { frozenBanner, isSafeOnDevice, notUpgradedBanner, upgradingBanner } from './collabMessages'
import DocumentSidePanel from './DocumentSidePanel.vue'
import { downloadHTML } from './exports'
import {
  resolveDocumentUnload,
  useDocumentLeaveGuard,
  type DocumentSaveState,
  type LeaveGuardOptions,
} from './navigation'
import { restoreVersion, type VersionRestore } from './restoreVersion'
import { saveFirst } from './saveFirst'
import { useCommentDrafts } from './useCommentDrafts'
import { showError } from './useDocumentPanel'
import { useDocumentThreads } from './useDocumentThreads'
import { useWriterCollab } from './useWriterCollab'
import { versionTitle } from './versionDates'
import {
  imagesNotice,
  missingImages,
  restoreImages,
  versionImages,
  type MissingImage,
} from './versionImages'
import VersionPreview from './VersionPreview.vue'
import { convertedVersion, fetchVersion, readVersionBody, storedVersionHTML } from './versions'
import { createWriterDocument, editorFileOf, isLocked, type EditorFile } from './writerDocument'
import WriterDocumentMenu from './WriterDocumentMenu.vue'
import { createWriteGate } from './writes'

const READ = 10
const COMMENT = 20
// How often an old document's page asks whether its conversion has finished
const CONVERSION_POLL_MS = 15_000

/** What `CollabTextEditor` and `ReadOnlyEditor` expose. */
interface EditorSurface {
  editor?: Editor | null
  /** Other people in the document; only the collaborative editor has them. */
  peers?: ReturnType<typeof peopleOf>
  /** Where each comment thread shows; only the collaborative editor places them. */
  places?: ThreadPlaces
  /** The document holds content the editor can't show, so it takes no edits. */
  isFrozen?: boolean
  /** An old document's Yjs body doesn't decode, so its stored HTML shows instead. */
  isUnreadable?: boolean
}

const props = defineProps<{ session: DocumentSession }>()

/** The editor that shows this document, with the props only it takes. */
type EditorView =
  | {
      is: typeof CollabTextEditor
      props: {
        room: CollabRoom
        file: EditorFile
        threads: DocumentThread[]
        onComment: (anchor: string) => void
        onCommentOnDocument: () => void
        openThread: string | null
        'onUpdate:openThread': (name: string | null) => void
        litThread: string | null
      }
    }
  | { is: typeof ReadOnlyEditor; props: { file: EditorFile } }

const editorSurface = shallowRef<EditorSurface | null>(null)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const panel = ref<DocumentPanel | null>(null)
// The thread open in the comments panel, and the one whose row is pointed at
const openThread = ref<string | null>(null)
const litThread = ref<string | null>(null)
// A version or a recovery copy shown read-only in the editor's place, one at a time
const preview = shallowRef<
  | { version: DocumentVersion; copy: null }
  | { version: null; copy: RecoveryCopy }
  | { version: null; copy: null }
>({ version: null, copy: null })

const recoveryBanner = ref<InstanceType<typeof RecoveryBanner> | null>(null)
const {
  threads,
  readAt: threadsReadAt,
  refresh: refreshThreads,
} = useDocumentThreads(props.session)

const {
  mode: collabMode,
  room,
  isLive: collabLive,
  allowsEditing,
  editingPaused,
  saveState: roomSaveState,
  unsent: roomUnsent,
  paused: roomPaused,
  copiesKept,
  banner,
  openFailure,
  open: openCollab,
  close: closeCollab,
  loseAccess,
  regainAccess,
} = useWriterCollab(
  props.session,
  retainRecovery,
  () => writes.writable.value,
  refreshThreads,
  () => !!editorSurface.value?.isFrozen,
)

// Runs before the page drops the editor; only this tab's own work counts, not what other tabs hold
const writes = createWriteGate(
  props.session,
  async () => {
    if (room.value?.status.unsentCount) {
      retainRecovery()
    }

    editorSurface.value?.editor?.setEditable(false)
    const html = editorSurface.value?.editor?.getHTML()
    try {
      await loseAccess(readable.value ? 'lost_edit' : 'lost_read')
    } catch (error) {
      console.error(error)
    }

    if (!room.value?.status.unsentCount) {
      // Access came back within the bound, so nothing turned read-only
      if (!writes.writable.value) {
        toast.warning('Editing access changed. This document is now read-only.')
      }

      return
    }

    toast.warning('Editing access changed. Your unsaved changes are kept on this device.', {
      duration: Number.POSITIVE_INFINITY,
      action: { label: 'Download my changes', onClick: () => downloadChanges(html) },
    })
  },
  () => void regainAccess(),
)

const writerDocument = createWriterDocument(props.session)

const stopBanner = computed(() => {
  if (!banner.value && editorSurface.value?.isFrozen) {
    return frozenBanner()
  }

  if (collabMode.value === 'unconverted') {
    return conversionBanner.value
  }

  return banner.value
})

// One strip at a time: a preview's own bar, else the stop strip, else the recovery strip
const isPreviewing = computed(() => !!preview.value.version || !!preview.value.copy)
const shownBanner = computed(() => {
  if (isPreviewing.value) {
    return null
  }

  return stopBanner.value
})
const showsRecoveryBanner = computed(() => !isPreviewing.value && !stopBanner.value)

const commentDrafts = useCommentDrafts({
  session: props.session,
  user: useSession().user.value?.id ?? 'Guest',
  room: () => room.value,
  refreshThreads,
})

function refusesComment() {
  if (canComment.value) {
    return false
  }

  toast.warning("You can't comment on this document.")
  return true
}

// A comment on the selected text starts as a draft in the comments panel
function commentOnText(anchor: string) {
  if (refusesComment()) {
    return
  }

  commentDrafts.start(anchor)
  panel.value = 'comments'
}

function commentOnDocument() {
  if (!refusesComment()) {
    void sidePanel.value?.startDocumentComment()
  }
}

// Clicking a thread's text opens it in the comments panel
function openThreadInPanel(name: string | null) {
  openThread.value = name
  if (name) {
    panel.value = 'comments'
  }
}

const documentResource = writerDocument

const readable = computed(
  () => props.session.state.value !== 'Refused' && writes.role.value >= READ,
)

const canComment = computed(
  () => props.session.state.value === 'Active' && writes.role.value >= COMMENT,
)

const saveState = computed<DocumentSaveState>(() => roomSaveState.value ?? 'clean')
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
    collabLive.value &&
    !belowMinBuild('writer'),
)

// Saving pauses don't hide it, so the person is told why no version was taken
const canSaveVersion = computed(() => readable.value && writes.writable.value && collabLive.value)

// Comments are Drive threads, not the body, so changing them needs no live room
const canEditDocument = computed(() => readable.value && writes.writable.value)

const showEditingPaused = computed(
  () => !editable.value && editingPaused.value && writes.writable.value,
)

const headerSaveState = computed(() => {
  if (savingPaused.value) {
    return null
  }

  return saveState.value
})

const isViewOnly = computed(() => !editable.value && !showEditingPaused.value)

const hasLostReadAccess = computed(() => !readable.value)
const hasFailedToOpen = computed(() => collabMode.value === 'failed')
const isLoading = computed(() => !documentResource.doc || collabMode.value === 'opening')

const editorFile = computed(() => editorFileOf(props.session, editable.value))

const peers = computed(() => editorSurface.value?.peers ?? [])
const threadPlaces = computed(() => editorSurface.value?.places ?? null)

const editorView = computed<EditorView>(() => {
  const file = editorFile.value
  if (collabLive.value && room.value) {
    const collabProps = {
      room: room.value,
      file,
      threads: threads.value,
      onComment: commentOnText,
      onCommentOnDocument: commentOnDocument,
      openThread: openThread.value,
      'onUpdate:openThread': openThreadInPanel,
      litThread: litThread.value,
    }
    return { is: CollabTextEditor, props: collabProps }
  }

  return { is: ReadOnlyEditor, props: { file } }
})

provide('file', editorFile)

provide(
  'isOffline',
  computed(() => !online.value),
)

provide(RENAME_DOCUMENT, async (title) => {
  await props.session.rename(title)
})

provide(DOCUMENT_MEDIA, (id) => props.session.media(id))

function showVersion(shown: DocumentVersion | null) {
  if (!shown) {
    closeAnyPreview()
    return
  }

  preview.value = { version: shown, copy: null }
}

async function downloadVersion(shown: DocumentVersion) {
  const name = shown.label || `v${shown.seq}`
  try {
    const html = await storedVersionHTML(props.session, shown.seq, (id) => props.session.media(id))
    await downloadHTML(html, `${props.session.title.value} (${name})`)
  } catch (error) {
    console.error(error)
    toast.error('Could not download this version.')
  }
}

const header = shallowRef<{ focusPanelToggle(name: DocumentPanel): void } | null>(null)
const sidePanel = shallowRef<InstanceType<typeof DocumentSidePanel> | null>(null)
const isRestoringVersion = ref(false)
const canRestoreVersion = computed(() => editable.value && collabLive.value && !!room.value)

async function confirmRestore(shown: DocumentVersion) {
  isRestoringVersion.value = true
  let images: MissingImage[]
  try {
    const body = await readVersionBody(await fetchVersion(props.session, shown.seq))
    images = await missingImages(props.session, versionImages(body))
  } catch (error) {
    console.error(error)
    toast.error("This version's images couldn't be checked, so nothing was restored.")
    return
  } finally {
    isRestoringVersion.value = false
  }

  const message = [
    'The document goes back to this version for everyone. Its current state is kept as a version first.',
    imagesNotice(images),
  ]
  dialog.confirm({
    title: 'Restore this version?',
    message: message.filter(Boolean).join(' '),
    confirmLabel: 'Restore',
    onConfirm: () => restoreShownVersion(shown, images),
  })
}

async function restoreShownVersion(shown: DocumentVersion, images: MissingImage[]) {
  isRestoringVersion.value = true
  try {
    await restoreImages(props.session, images)
    const notice = await restoreBody(shown)
    if (notice.canDownload) {
      toast.error(notice.message, {
        action: { label: 'Download', onClick: () => void downloadVersion(shown) },
      })
      return
    }

    if (!notice.isRestored) {
      toast.error(notice.message)
      return
    }

    toast.success(notice.message)
    closeAnyPreview()
    void sidePanel.value?.reloadVersions()
    void moveThreadsBack(notice.anchors)
  } catch (error) {
    console.error(error)
    toast.error('The version was not restored.')
  } finally {
    isRestoringVersion.value = false
  }
}

// Threads whose text the restore brought back go onto it; they keep showing as deleted if this fails
async function moveThreadsBack(anchors: Record<string, string>) {
  if (!Object.keys(anchors).length) {
    return
  }

  try {
    await props.session.comments.reanchor(anchors)
  } catch (error) {
    showError(error, "Comments on the restored text couldn't be put back on it.")
    return
  }

  await refreshThreads()
}

async function restoreBody(shown: DocumentVersion): Promise<VersionRestore> {
  const liveRoom = room.value
  if (!liveRoom) {
    return { isRestored: false, message: 'The version was not restored.', anchors: {} }
  }

  const bytes = await fetchVersion(props.session, shown.seq)
  return restoreVersion(liveRoom, shown.seq, bytes, threads.value, () =>
    convertedVersion(props.session, shown.seq),
  )
}

function viewCopy(copy: RecoveryCopy) {
  preview.value = { version: null, copy }
}

function closeAnyPreview() {
  preview.value = { version: null, copy: null }
}

const route = useRoute()
const router = useRouter()

// The recovery copies page opens a copy here by its key
async function viewRequestedCopy() {
  const key = route.query.recovery
  if (typeof key !== 'string') {
    return
  }

  const copies = await listCopies(props.session.nodeId)
  const copy = copies.find((kept) => kept.key === key)
  const query = { ...route.query }
  delete query.recovery
  await router.replace({ query })
  if (copy) {
    viewCopy(copy)
  }
}

async function closeCopy() {
  closeAnyPreview()
  await nextTick()
  editorSurface.value?.editor?.commands.focus()
}

function discardedCopy() {
  closeAnyPreview()
}

function retainRecovery(): boolean {
  // The device store keeps a live tab's work, so a page copy would only repeat it
  if (room.value && isSafeOnDevice(room.value.status)) {
    return false
  }

  const html = editorSurface.value?.editor?.getHTML()
  if (!html) {
    return false
  }

  try {
    keepPageCopy(props.session.nodeId, props.session.title.value, html)
  } catch {
    return false
  }

  void recoveryBanner.value?.refresh()
  return true
}

watch(copiesKept, () => recoveryBanner.value?.refresh())

// The old editor's unsaved work on this device, once the row is read
watch(
  () => documentResource.doc?.name,
  async () => {
    const row = documentResource.doc
    if (!row) {
      return
    }

    try {
      await keepDeviceCopies(props.session, row)
    } finally {
      void recoveryBanner.value?.refresh()
    }
  },
  { immediate: true },
)

async function downloadChanges(html: string | undefined) {
  // What the editor held when editing access was lost, which a later rebuild replaces
  if (html) {
    downloadCopy({ title: props.session.title.value, savedAt: new Date(), html })
    return
  }

  const [latest] = await listCopies(props.session.nodeId)
  if (!latest) {
    toast.error('No recovery copy is kept for this document.')
    return
  }

  downloadCopy(latest)
}

function flush(): Promise<void> {
  if (room.value) {
    return withinTenSeconds(room.value.flush())
  }

  return Promise.resolve()
}

// The name box opens once the panel has seen any preview close, which would otherwise cancel it
async function nameVersion() {
  closeAnyPreview()
  panel.value = 'versions'
  await nextTick()
  void sidePanel.value?.startNamingVersion()
}

// A collab document's version covers what this tab typed; other documents take it as stored
async function saveBeforeVersion() {
  if (room.value) {
    await saveFirst(room.value)
  }
}

useDocumentLeaveGuard({ state: () => saveState.value, flush, retainRecovery })

function warnBeforeUnload(event: Event) {
  const unloadGuard: Pick<LeaveGuardOptions, 'state' | 'retainRecovery'> = {
    state: () => {
      if (collabLive.value) {
        return saveState.value
      }

      return 'clean'
    },
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

// In a live room the unload guard still asks first while changes are unsent
function reloadPage() {
  location.reload()
}

const conversionBanner = computed(() => {
  const conversion = documentResource.doc?.conversion
  const isUnreadable = !!editorSurface.value?.isUnreadable
  if (conversion?.state === 'refused') {
    return notUpgradedBanner(conversion.reason ?? null, isUnreadable)
  }

  return upgradingBanner(conversion?.reason ?? null, isUnreadable)
})

function isRefused() {
  return documentResource.doc?.conversion?.state === 'refused'
}

function conversionKeys() {
  return documentResource.doc?.conversion?.rooms?.keys ?? []
}

// The row carries a conversion state until the document is collaborative, which then opens live
// A refused document stays refused while it is open, so its poll stops
// The conversion's rooms tell the tab its outcome sooner; the poll also moves it to each epoch's rooms
let conversionPoll: ReturnType<typeof setInterval> | undefined
let conversionWatch: ReturnType<typeof watchConversion> | null = null

function stopWaiting() {
  clearInterval(conversionPoll)
  conversionWatch?.stop()
  conversionWatch = null
}

async function checkConversion() {
  try {
    await documentResource.reload()
  } catch {
    return
  }

  if (isRefused()) {
    stopWaiting()
  } else if (collabMode.value === 'unconverted' && !documentResource.doc?.conversion) {
    void openCollab()
  } else {
    conversionWatch?.setKeys(conversionKeys())
  }
}

watch(collabMode, (mode) => {
  stopWaiting()
  if (mode !== 'unconverted' || isRefused()) {
    return
  }

  conversionPoll = setInterval(checkConversion, CONVERSION_POLL_MS)
  conversionWatch = watchConversion(conversionKeys(), () => void checkConversion())
})

onMounted(() => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOffline)
  window.addEventListener('beforeunload', warnBeforeUnload)
  void openCollab()
  void viewRequestedCopy()
})

onBeforeUnmount(() => {
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOffline)
  window.removeEventListener('beforeunload', warnBeforeUnload)
  stopWaiting()
  closeCollab()
})
</script>

<template>
  <div class="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-base">
    <DriveDocumentHeader
      ref="header"
      v-model:panel="panel"
      :session="session"
      title-label="Document title"
      :save-state="headerSaveState"
      :view-only="isViewOnly"
      :panels="['comments', 'versions']"
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
          v-if="saveNote"
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
          :can-save-version="canSaveVersion"
          @save-version="nameVersion"
        />
      </template>
    </DriveDocumentHeader>

    <RecoveryBanner
      v-if="showsRecoveryBanner"
      ref="recoveryBanner"
      :node="session.nodeId"
      @view="viewCopy"
    />

    <DocumentStrip v-if="shownBanner" tone="amber">
      <p>
        {{ shownBanner.text
        }}<a
          v-if="shownBanner.link"
          :href="shownBanner.link.href"
          target="_blank"
          class="underline"
          >{{ shownBanner.link.label }}</a
        >{{ shownBanner.after }}
      </p>
      <Button
        v-if="shownBanner.canReload"
        size="sm"
        variant="ghost"
        label="Reload"
        @click="reloadPage"
      />
    </DocumentStrip>

    <div class="relative flex min-h-0 flex-1 flex-col">
      <div v-if="hasLostReadAccess" class="m-auto text-center">
        <span class="lucide-lock-keyhole mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
        <p class="mt-2 text-p-sm text-ink-gray-6">
          You no longer have permission to read this document.
        </p>
      </div>
      <div v-else-if="hasFailedToOpen" class="m-auto text-center">
        <p class="text-p-sm text-ink-gray-6">{{ openFailure }}</p>
        <Button class="mt-3" label="Try again" @click="openCollab" />
      </div>
      <div v-else-if="isLoading" class="mx-auto w-full max-w-[770px] space-y-3 px-5 pt-10">
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
            <template v-if="preview.version" #toolbar>
              <DocumentStrip>
                <p class="truncate">Viewing {{ versionTitle(preview.version) }}</p>
                <Button
                  v-if="canRestoreVersion"
                  size="sm"
                  variant="ghost"
                  icon="lucide-undo-2"
                  tooltip="Restore this version"
                  aria-label="Restore this version"
                  :disabled="isRestoringVersion"
                  @click="confirmRestore(preview.version)"
                />
              </DocumentStrip>
            </template>
            <template v-else-if="preview.copy" #toolbar>
              <DocumentStrip>
                <p class="truncate">Viewing recovery copy from {{ savedAtLabel(preview.copy) }}</p>
                <RecoveryCopyActions
                  :copy="preview.copy"
                  can-go-back
                  @back="closeCopy"
                  @discarded="discardedCopy"
                />
              </DocumentStrip>
            </template>
            <template v-if="preview.version" #cover>
              <VersionPreview :session="session" :seq="preview.version.seq" :settings="settings" />
            </template>
            <template v-else-if="preview.copy" #cover>
              <RecoveryPreview :copy="preview.copy" :settings="settings" />
            </template>
            <template #aside>
              <DocumentSidePanel
                ref="sidePanel"
                v-model:panel="panel"
                v-model:open-thread="openThread"
                v-model:lit-thread="litThread"
                :previewed-version="preview.version"
                :session="session"
                :can-comment="canComment"
                :can-edit-document="canEditDocument"
                :can-restore-version="canRestoreVersion"
                :can-save-version="canSaveVersion"
                :is-restoring-version="isRestoringVersion"
                :threads="threads"
                :threads-read-at="threadsReadAt"
                :places="threadPlaces"
                :refresh-threads="refreshThreads"
                :drafts="commentDrafts"
                :save-first="saveBeforeVersion"
                @update:previewed-version="showVersion"
                @restore-version="confirmRestore"
                @download-version="downloadVersion"
                @save-version="nameVersion"
                @closed="header?.focusPanelToggle($event)"
              />
            </template>
          </component>
        </div>
      </template>
    </div>
  </div>
</template>
