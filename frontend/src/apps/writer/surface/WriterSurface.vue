<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Badge, Button, dialog, toast } from 'frappe-ui'
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
  DriveDocumentSidePanel as DocumentSidePanel,
  DriveDocumentStrip as DocumentStrip,
  DRIVE_ROLES,
  DriveDocumentHeader,
  imagesNotice,
  missingImages,
  restoreImages,
  showError,
  useDocumentComments,
  DriveVersionShownBar as VersionShownBar,
  type DocumentPanel,
  type DocumentSession,
  type DocumentThread,
  type DocumentVersion,
  type MissingImage,
} from '@/apps/drive'
import { anchorEnds, anchorQuote } from '@/apps/writer/collab/anchors'
import type { ThreadPlaces } from '@/apps/writer/collab/highlights'
import { withinTenSeconds } from '@/apps/writer/collab/timeout'
import CollabTextEditor from '@/apps/writer/components/CollabTextEditor.vue'
import ReadOnlyEditor from '@/apps/writer/components/ReadOnlyEditor.vue'
import { DOCUMENT_MEDIA } from '@/apps/writer/extensions/drive-media'
import DocumentSkeleton from '@/apps/writer/opening/DocumentSkeleton.vue'
import { isOpening } from '@/apps/writer/opening/openingEditor'
import OpeningEditor from '@/apps/writer/opening/OpeningEditor.vue'
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
import { watchConversion, type CollabRoom, type VersionRestored } from '@/platform/collab'
import type { peopleOf } from '@/platform/collab/peers'
import { othersPresentWarning, restoredByOther } from '@/platform/collab/restoreNotices'
import UsersBar from '@/platform/collab/UsersBar.vue'
import { useHideRail } from '@/platform/rail'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import { frozenBanner, isSafeOnDevice, notUpgradedBanner, upgradingBanner } from './collabMessages'
import { downloadHTML } from './exports'
import {
  resolveDocumentUnload,
  useDocumentLeaveGuard,
  type DocumentSaveState,
  type LeaveGuardOptions,
} from './navigation'
import { goToPlace, readingPlace } from './readingPlace'
import { restoreVersion, type VersionRestore } from './restoreVersion'
import { saveFirst } from './saveFirst'
import { useWriterCollab } from './useWriterCollab'
import { versionImages } from './versionImages'
import VersionPreview from './VersionPreview.vue'
import { convertedVersion, fetchVersion, readVersionBody, storedVersionHTML } from './versions'
import { createWriterDocument, editorFileOf, isLocked, type EditorFile } from './writerDocument'
import WriterDocumentMenu from './WriterDocumentMenu.vue'
import { createWriteGate } from './writes'

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
        onReanchor: (anchors: Record<string, string>) => void
        openThread: string | null
        'onUpdate:openThread': (name: string | null) => void
        litThread: string | null
        draftAnchors: string[]
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
const seesComments = computed(() => props.session.panels.value.includes('comments'))
const {
  threads,
  readAt: threadsReadAt,
  refresh: refreshThreads,
  actions: threadActions,
  drafts: commentDrafts,
} = useDocumentComments(props.session, {
  isShown: () => seesComments.value,
  room: () => room.value,
  anchors: { quote: anchorQuote, ends: anchorEnds },
})

const {
  mode: collabMode,
  room,
  isLive: collabLive,
  allowsEditing,
  editingPaused,
  saveState: roomSaveState,
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
  { threadsChanged: refreshThreads, versionRestored: tellRestoredByOther },
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
        toast.warning(__('Editing access changed. This document is now read-only.'))
      }

      return
    }

    toast.warning(__('Editing access changed. Your unsaved changes are kept on this device.'), {
      duration: Number.POSITIVE_INFINITY,
      action: { label: __('Download my changes'), onClick: () => downloadChanges(html) },
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

function refusesComment() {
  if (canComment.value) {
    return false
  }

  toast.warning(__("You can't comment on this document."))
  return true
}

// The text of a comment stays marked from its draft until it is posted or discarded
const draftAnchors = computed(() => commentDrafts.drafts.value.map((draft) => draft.anchor))

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
  () => props.session.state.value !== 'Refused' && writes.role.value >= DRIVE_ROLES.read,
)

const canComment = computed(
  () => props.session.state.value === 'Active' && writes.role.value >= DRIVE_ROLES.comment,
)

const saveState = computed<DocumentSaveState>(() => roomSaveState.value ?? 'clean')
// "busy" is another tab's save holding the document; this one goes again within a second
const savingPaused = computed(
  () => !!roomPaused.value && roomPaused.value !== 'busy' && saveState.value !== 'failed',
)

// Offline, edits wait on this device until the connection is back
const isWaitingOffline = computed(
  () => !online.value && (saveState.value === 'unsaved' || saveState.value === 'saving'),
)

const saveNote = computed(() => {
  if (savingPaused.value) return __('Saving paused')
  if (isWaitingOffline.value) return __('Changes will sync')
  return ''
})

const settings = computed(() => documentResource.doc?.settings ?? {})

const isDocumentLocked = computed(() => isLocked(settings.value))

// Whether the person could edit if the document weren't locked
const canEdit = computed(
  () =>
    readable.value &&
    writes.writable.value &&
    allowsEditing.value &&
    collabLive.value &&
    !belowMinBuild('writer'),
)

const editable = computed(() => canEdit.value && !isDocumentLocked.value)

async function setDocumentLocked(lock: boolean) {
  try {
    await documentResource.setLocked(lock)
  } catch (error) {
    console.error(error)
    toast.error(lock ? __('Could not lock this document.') : __('Could not unlock this document.'))
  }
}

// Saving pauses don't hide it, so the person is told why no version was taken
const canSaveVersion = computed(() => readable.value && writes.writable.value && collabLive.value)

// Comments are Drive threads, not the body, so changing them needs no live room
const canEditDocument = computed(() => readable.value && writes.writable.value)

const showEditingPaused = computed(
  () => !editable.value && editingPaused.value && writes.writable.value,
)

// Someone who can unlock it isn't only viewing
const showLocked = computed(() => canEdit.value && isDocumentLocked.value)

const headerSaveState = computed(() => (hasFailedToOpen.value ? null : saveState.value))

// Nobody can edit until the document has opened, which doesn't make them a viewer
const isViewOnly = computed(
  () =>
    !isLoading.value &&
    !editable.value &&
    !showEditingPaused.value &&
    !showLocked.value &&
    !hasFailedToOpen.value,
)

const hasLostReadAccess = computed(() => !readable.value)
const hasFailedToOpen = computed(
  () => collabMode.value === 'failed' || documentResource.readFailure !== null,
)
const failureMessage = computed(() => {
  if (collabMode.value === 'failed') {
    return openFailure.value
  }

  return documentResource.readFailure
})
useHideRail(() => !hasLostReadAccess.value && !hasFailedToOpen.value)
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
      onReanchor: moveThreadsBack,
      openThread: openThread.value,
      'onUpdate:openThread': openThreadInPanel,
      litThread: litThread.value,
      draftAnchors: draftAnchors.value,
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
    toast.error(__('Could not download this version.'))
  }
}

const sidePanel = shallowRef<InstanceType<typeof DocumentSidePanel> | null>(null)
const versionPreview = shallowRef<InstanceType<typeof VersionPreview> | null>(null)
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
    toast.error(__("This version's images couldn't be checked, so nothing was restored."))
    return
  } finally {
    isRestoringVersion.value = false
  }

  const message = [
    __(
      'The document goes back to this version for everyone. Its current state is kept as a version first.',
    ),
    othersPresentWarning(peers.value, useSession().user.value?.id ?? '', 'document'),
    imagesNotice(images),
  ]
  dialog.confirm({
    title: __('Restore this version?'),
    message: message.filter(Boolean).join(' '),
    confirmLabel: __('Restore'),
    onConfirm: () => restoreShownVersion(shown, images),
  })
}

async function restoreShownVersion(shown: DocumentVersion, images: MissingImage[]) {
  isRestoringVersion.value = true
  const scroller = versionPreview.value?.scroller ?? liveScroller()
  const place = scroller ? readingPlace(scroller) : null
  try {
    await restoreImages(props.session, images)
    const notice = await restoreBody(shown)
    if (notice.canDownload) {
      toast.error(notice.message, {
        action: { label: __('Download'), onClick: () => void downloadVersion(shown) },
      })
      return
    }

    if (!notice.isRestored) {
      toast.error(notice.message)
      return
    }

    toast.success(notice.message)
    closeAnyPreview()
    await nextTick()
    goToPlace(liveScroller(), place)
    void sidePanel.value?.reloadVersions()
    void moveThreadsBack(notice.anchors)
  } catch (error) {
    console.error(error)
    toast.error(__('The version was not restored.'))
  } finally {
    isRestoringVersion.value = false
  }
}

// Threads whose text a restore or an undo brought back go onto it; they keep showing as deleted if this fails
async function moveThreadsBack(anchors: Record<string, string>) {
  if (!Object.keys(anchors).length) {
    return
  }

  try {
    await props.session.comments.reanchor(anchors)
  } catch (error) {
    showError(error, __("Comments on the restored text couldn't be put back on it."))
    return
  }

  await refreshThreads()
}

async function restoreBody(shown: DocumentVersion): Promise<VersionRestore> {
  const liveRoom = room.value
  if (!liveRoom) {
    return { isRestored: false, message: __('The version was not restored.'), anchors: {} }
  }

  const bytes = await fetchVersion(props.session, shown.seq)
  return restoreVersion(liveRoom, shown.seq, bytes, threads.value, () =>
    convertedVersion(props.session, shown.seq),
  )
}

function liveScroller() {
  return document.querySelector('#editor-scroll-container')
}

async function tellRestoredByOther(restored: VersionRestored) {
  void sidePanel.value?.reloadVersions()
  toast.info(await restoredByOther(restored, 'document'))
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

// After a new comment is sent, typing goes on at the end of the commented text, where commenting put the caret
function backToText() {
  editorSurface.value?.editor?.commands.focus()
}

async function backToCurrent() {
  closeAnyPreview()
  await nextTick()
  backToText()
}

function togglePanel(name: DocumentPanel) {
  panel.value = panel.value === name ? null : name
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
    toast.error(__('No recovery copy is kept for this document.'))
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

// The room may have opened with only the row failing, and a live room mustn't open twice
function tryOpeningAgain() {
  if (documentResource.readFailure !== null) {
    void documentResource.read()
  }

  if (collabMode.value === 'failed') {
    void openCollab()
  }
}

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
  <div
    class="writer-surface relative flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-base"
    :class="{ 'writer-hides-comments': !seesComments }"
  >
    <DriveDocumentHeader
      :session="session"
      title-label="Document title"
      :save-state="headerSaveState"
      :save-note="saveNote"
      :view-only="isViewOnly"
    >
      <template #status>
        <Badge
          v-if="showEditingPaused"
          label="Editing paused"
          theme="gray"
          variant="subtle"
          class="shrink-0"
        />
        <Badge
          v-else-if="showLocked"
          :label="__('Locked')"
          theme="gray"
          variant="subtle"
          class="shrink-0"
        />
      </template>
      <template #actions>
        <UsersBar v-if="peers.length" :users="peers" />
      </template>
      <template #menu>
        <WriterDocumentMenu
          v-if="readable && !hasFailedToOpen"
          :session="session"
          :editor="editorSurface?.editor ?? null"
          :settings="settings"
          :editable="editable"
          :can-save-version="canSaveVersion"
          :can-lock="canEdit"
          :is-locked="isDocumentLocked"
          :panels="session.panels.value"
          :panel="panel"
          @toggle-panel="togglePanel"
          @save-version="sidePanel?.nameVersion()"
          @set-locked="setDocumentLocked"
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
      <!-- What was typed stays on screen until a try opens the document -->
      <template v-else-if="hasFailedToOpen && isOpening(session.nodeId)">
        <DocumentStrip tone="amber">
          <p>{{ failureMessage }}</p>
          <Button size="sm" variant="ghost" :label="__('Try again')" @click="tryOpeningAgain" />
        </DocumentStrip>
        <OpeningEditor :node="session.nodeId" />
      </template>
      <div v-else-if="hasFailedToOpen" class="m-auto text-center">
        <p class="text-p-sm text-ink-gray-6">{{ failureMessage }}</p>
        <Button class="mt-3" label="Try again" @click="tryOpeningAgain" />
      </div>
      <OpeningEditor v-else-if="isLoading && isOpening(session.nodeId)" :node="session.nodeId" />
      <DocumentSkeleton v-else-if="isLoading" :has-toolbar="writes.writable.value" />
      <template v-else>
        <!-- Covers the document's editor until it takes over what was typed -->
        <OpeningEditor
          v-if="isOpening(session.nodeId)"
          :node="session.nodeId"
          class="absolute inset-0 z-10"
        />
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
              <VersionShownBar
                :version="preview.version"
                :can-restore="canRestoreVersion"
                :is-restoring="isRestoringVersion"
                @restore="confirmRestore"
                @back="backToCurrent"
              />
            </template>
            <template v-else-if="preview.copy" #toolbar>
              <DocumentStrip>
                <p class="truncate">Viewing recovery copy from {{ savedAtLabel(preview.copy) }}</p>
                <RecoveryCopyActions
                  :copy="preview.copy"
                  can-go-back
                  @back="backToCurrent"
                  @discarded="discardedCopy"
                />
              </DocumentStrip>
            </template>
            <template v-if="preview.version" #cover>
              <VersionPreview
                ref="versionPreview"
                :session="session"
                :seq="preview.version.seq"
                :settings="settings"
              />
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
                :can-share="session.canShare.value"
                :can-restore-version="canRestoreVersion"
                :can-save-version="canSaveVersion"
                :is-restoring-version="isRestoringVersion"
                :threads="threads"
                :threads-read-at="threadsReadAt"
                :places="threadPlaces"
                :refresh-threads="refreshThreads"
                :thread-actions="threadActions"
                :drafts="commentDrafts"
                :save-first="saveBeforeVersion"
                noun="document"
                @update:previewed-version="showVersion"
                @restore-version="confirmRestore"
                @download-version="downloadVersion"
                @back="backToCurrent"
                @closed="backToText"
                @comment-sent="backToText"
              />
            </template>
          </component>
        </div>
      </template>
    </div>
  </div>
</template>
