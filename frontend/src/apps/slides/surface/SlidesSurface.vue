<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { onKeyStroke, useMediaQuery } from '@vueuse/core'
import { Button, dialog, Dropdown, Skeleton, toast } from 'frappe-ui'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

import '@/apps/slides/styles/fonts.css'
import '@/apps/slides/styles/scrollbars.css'

import { api, client } from '@/api'
import {
  DriveCommentList,
  DriveDocumentHeader,
  imagesNotice,
  missingImages,
  rankMentionsFor,
  restoreImages,
  useCommentDrafts,
  useDocumentThreads,
  useDriveDocumentActions,
  useThreadChanges,
  type DocumentPanel,
  type DocumentSession,
  type MissingImage,
} from '@/apps/drive'
import LayoutDialog from '@/apps/slides/components/LayoutDialog.vue'
import NavigationPanel from '@/apps/slides/components/NavigationPanel.vue'
import OfflineCopyButton from '@/apps/slides/components/OfflineCopyButton.vue'
import PresentButton from '@/apps/slides/components/PresentButton.vue'
import PropertiesPanel from '@/apps/slides/components/PropertiesPanel.vue'
import SlideContainer from '@/apps/slides/components/SlideContainer.vue'
import ThemeDialog from '@/apps/slides/components/ThemeDialog.vue'
import Toolbar from '@/apps/slides/components/Toolbar.vue'
import { useCommandHistory } from '@/apps/slides/composables/useCommandHistory'
import { useNavigationPanel } from '@/apps/slides/composables/useNavigationPanel'
import { useShortcuts } from '@/apps/slides/composables/useShortcuts'
import { activeEditor } from '@/apps/slides/composables/useTextEditor'
import { useOldDraft } from '@/apps/slides/recovery/useOldDraft'
import { setDocumentMedia } from '@/apps/slides/stores/documentMedia'
import { flushPendingBlur, focusElementId, resetFocus } from '@/apps/slides/stores/element'
import {
  actionOrder as historyMetaActionOrder,
  actions as historyMetaActions,
  setCommandHistory,
} from '@/apps/slides/stores/historyMeta'
import { flushLive } from '@/apps/slides/stores/liveDeck'
import {
  offlineCopyStatus,
  pruneOfflineCopy,
  refreshOfflineStatus,
  warmOfflineCopyAssets,
} from '@/apps/slides/stores/offlineCopy'
import {
  contextFor,
  initPresentationDoc,
  inReadonlyMode,
  loadTemplates,
  presentationDoc,
  presentationId,
  presentationTheme,
  resetEditorState,
  rowSlides,
  setDocumentContext,
  slidesLength,
  startLoad,
  templateList,
  viewOnly,
  writesBlocked,
} from '@/apps/slides/stores/presentation'
import {
  dirty,
  isSaving,
  resumeWrites,
  saveChanges,
  saveFailed,
  saveRefused,
  savingFor,
} from '@/apps/slides/stores/saving'
import {
  changeEditorSlide,
  handleInsertSlide,
  setSlideIndex,
  slideIndex,
  slides,
} from '@/apps/slides/stores/slide'
import { inSlideShowMode, startSlideShow } from '@/apps/slides/stores/slideshow'
import {
  drawTemplateLayouts,
  firstLayout,
  setTemplateReader,
} from '@/apps/slides/stores/templateLayouts'
import { cancelVisit, rememberVisit } from '@/apps/slides/stores/visitedCopies'
import { stopVisitedMedia, storeVisitedMedia } from '@/apps/slides/stores/visitedMedia'
import { drawnFontsLoaded, warmBundledFonts } from '@/apps/slides/utils/bundledFonts'
import { isMediaOwner } from '@/apps/slides/utils/mediaUploads'
import { postToServiceWorker, registerSlidesWorker } from '@/apps/slides/utils/serviceWorker'
import { readSavedDocument, type VersionRestored } from '@/platform/collab'
import { peopleOf, presenceColours } from '@/platform/collab/peers'
import {
  othersPresentWarning,
  restoredByOther,
  type RestoreNotice,
} from '@/platform/collab/restoreNotices'
import UsersBar from '@/platform/collab/UsersBar.vue'
import { useHideRail } from '@/platform/rail'
import { getCookieSessionUser, useSession } from '@/platform/session'
import { openAreaShortcuts } from '@/platform/shortcuts'
import { translate } from '@/platform/translation'

import { createSlidesAccess } from './access'
import { useAutosave } from './autosave'
import {
  CompositeGroupLoader,
  indexOfPlace,
  mergeCompositeSlides,
  placeAt,
  type CompositeItem,
  type MergedCompositeSlide,
} from './compositeGroups'
import { withSavedSlides } from './compositeSaved'
import { conversionNotice, type ConversionStatus } from './conversionNotice'
import ExportView from './ExportView.vue'
import { resolveDocumentUnload, useDocumentLeaveGuard, type DocumentSaveState } from './navigation'
import { useNewPresentationTheme } from './newPresentation'
import PreviewCapture from './PreviewCapture.vue'
import { fileTitle, saveThroughBrowser } from './recovery'
import SlidesVersionPreview from './SlidesVersionPreview.vue'
import SlidesVersionsPanel from './SlidesVersionsPanel.vue'
import SurfaceNotice from './SurfaceNotice.vue'
import { useConvertedRoom } from './useConvertedRoom'
import { useUnsavedRecovery } from './useUnsavedRecovery'
import { convertedVersion, fetchVersion, readVersionBody, versionImages } from './versions'
import { versionSlides } from './versionSlides'

type Panel = DocumentPanel

const Slideshow = defineAsyncComponent(() => import('@/apps/slides/pages/Slideshow.vue'))

const props = defineProps<{
  session: DocumentSession
}>()
const loading = ref(true)
// a reload mid-show keeps the show up
const loaded = ref(false)
const loadError = ref('')
const route = useRoute()
const router = useRouter()
const userSession = useSession()
const presenting = computed(
  () =>
    route.name === 'slides-slideshow' &&
    loaded.value &&
    slides.value.length > 0 &&
    !isConverted.value,
)
// `?slide=N`: the slide the show presents, and the one the editor opens on.
const presentedSlide = computed(() => Math.max(1, Math.trunc(Number(route.query.slide)) || 1))
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const composite = ref(false)
const compositeItems = ref<CompositeItem[]>([])
const panel = ref<Panel | null>(null)
// The version shown read-only in the canvas's place (Q7); it shows only beside the versions panel
const previewed = ref<string | null>(null)
watch(panel, (shown) => {
  if (shown !== 'versions') {
    previewed.value = null
  }
})
// Escape goes back to the presentation, unless a dialog or menu over the preview takes the key
onKeyStroke(
  'Escape',
  (event) => {
    const isOverlayOpen = document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')
    if (!event.defaultPrevented && previewed.value && !isOverlayOpen) {
      previewed.value = null
    }
  },
  { target: document },
)
const {
  threads: readThreads,
  readAt: threadsReadAt,
  refresh: refreshThreads,
} = useDocumentThreads(props.session, () => panel.value === 'comments')
const { threads, actions: threadActions } = useThreadChanges({
  session: props.session,
  readThreads,
  readAt: threadsReadAt,
  refresh: refreshThreads,
})
// Comments are on the whole presentation, so a draft waits on no text in the room
const commentDrafts = useCommentDrafts({
  session: props.session,
  user: userSession.user.value?.id ?? 'Guest',
  room: () => null,
  refreshThreads,
})
rankMentionsFor(props.session.nodeId)
const exporting = ref(false)
// A version's slides to print in place of the presentation's, for a version that can't be restored
const printedSlides = shallowRef<Record<string, unknown>[] | null>(null)
const exportedSlides = computed(() => printedSlides.value ?? slides.value)
const {
  isOnlyCopy,
  clearOnlyCopy,
  canDownloadChanges,
  narrowed,
  widened,
  keepSticky,
  retainRecovery,
  retainStickyOrOffer,
  retainOrWarn,
  reloadAfterAccessBack,
  downloadChanges,
  discardChanges,
  settleCopies,
  heldNotice,
} = useUnsavedRecovery(props.session, {
  isWritable: () => access.writable.value,
  isEditable: () => editable.value,
  load,
  cancelRunningLoad,
})
const { oldDraftNotice, settleOldDraft, downloadOldDraft, dismissOldDraft } = useOldDraft(
  props.session,
)
const isSlideInteractionActive = ref(false)
const previewCapture = useTemplateRef<InstanceType<typeof PreviewCapture>>('previewCapture')
const exportView = useTemplateRef<InstanceType<typeof ExportView>>('exportView')
const versionsPanel = useTemplateRef<InstanceType<typeof SlidesVersionsPanel>>('versionsPanel')
const access = createSlidesAccess(props.session, { narrowed, widened })
// A restore pauses editing: nothing is written while the server rewrites the deck.
const restoring = ref(false)
// Edited through its room: its rows no longer change
const isConverted = ref(false)
// A deck still on its rows, waiting for conversion or refused by it, is read-only
const conversion = ref<ConversionStatus | null>(null)
const onLayer = computed(() => isConverted.value || !!conversion.value)
const notice = computed(() => {
  if (!conversion.value || !access.readable.value) {
    return ''
  }

  return conversionNotice(conversion.value)
})
const editable = computed(
  () =>
    access.writable.value &&
    !composite.value &&
    !restoring.value &&
    !isOnlyCopy.value &&
    !conversion.value &&
    (!isConverted.value || convertedRoom.allowsEditing.value),
)
// A composite can restore a version of itself, so this is not `inReadonlyMode`.
const canRestoreVersions = computed(
  () =>
    access.writable.value &&
    !restoring.value &&
    !isOnlyCopy.value &&
    (!onLayer.value || (isConverted.value && convertedRoom.allowsEditing.value)) &&
    !writesBlocked.value,
)
// A converted presentation asks and restores itself. A row presentation leaves both to the panel
const liveRestore = computed(() => (isConverted.value ? confirmLiveRestore : undefined))
// Phones get a viewer: the slide fitted to the screen with previous and next. The
// editor's panels need a wide screen. Same breakpoint as the shell's phone layout.
const phone = useMediaQuery('(max-width: 767px)')
const convertedRoom = useConvertedRoom({
  session: props.session,
  // Not `editable`, which asks the room back
  mayEdit: () =>
    access.writable.value &&
    !composite.value &&
    !restoring.value &&
    !isOnlyCopy.value &&
    !phone.value,
  retainRecovery,
  retainStickyOrOffer,
  onThreadsChanged: () => void refreshThreads(),
  onVersionRestored: (restored) => void tellRestoredByOther(restored),
})
provide('livePresence', convertedRoom.presence)
const roomPeople = computed(() => {
  const presence = convertedRoom.presence.value
  return presence ? peopleOf(presence.peers, presenceColours(presence)) : []
})
const { isNavigationPanelOpen } = useNavigationPanel()
// the side panel floats over the slide area, so a notice starts at its edge
const isNoticeBesidePanel = computed(() => !phone.value && isNavigationPanelOpen.value)
// What the canvas, panels and shortcuts read: the phone viewer edits nothing. The
// stores keep their own `inReadonlyMode`, which follows access and a refused save
const canvasReadonly = computed(() => inReadonlyMode.value || phone.value)
const editing = computed(() => !canvasReadonly.value)
const { open: showThemeDialog, offer: offerTheme } = useNewPresentationTheme(
  props.session.contentDocname,
  computed(() => !inReadonlyMode.value),
)
useHideRail()

// Body requests go through the session, with this document's link credentials.
// A refused write is a verdict: access narrows until the presentation opens again.
const releaseContext = setDocumentContext(
  props.session.contentDocname,
  props.session.credentials.context,
  () => access.refuse(),
  keepSticky,
)
// A migrated deck names its pictures by node id; the session signs their urls.
const releaseMedia = setDocumentMedia((id) => props.session.media(id))
const releaseTemplateReader = setTemplateReader(readSource)
const history = useCommandHistory(slides, {
  actions: historyMetaActions,
  actionOrder: historyMetaActionOrder,
})
setCommandHistory(history)
// a previewed version hides the live presentation, so no shortcut may change it
useShortcuts(
  computed(() => canvasReadonly.value || !!previewed.value),
  inSlideShowMode,
)
provide('inReadonlyMode', canvasReadonly)
provide('inSlideShowMode', inSlideShowMode)
provide('isOnline', online)

// "Add slide" in the navigation panel and the slide context menu pick a layout here.
const showLayoutDialog = ref(false)
const insertIndex = ref(0)
provide('openLayoutDialog', (index: number) => {
  insertIndex.value = index
  showLayoutDialog.value = true
  void drawTemplateLayouts([presentationTheme.value])
})
function insertLayout(layout: unknown) {
  handleInsertSlide(insertIndex.value, layout)
}

/** A theme write rewrites the deck on the server, so it pauses editing like a restore. */
async function writeTheme(
  endpoint: typeof api.slides.documents.applyTheme | typeof api.slides.documents.updateTheme,
  theme: string,
) {
  showThemeDialog.value = false
  showThemeChange.value = false
  // a dialog stays open through a change of access, or of the edit lock
  if (inReadonlyMode.value) {
    return
  }

  try {
    await flushEdits()
    restoring.value = true
    await client.mutation(
      endpoint,
      { name: props.session.contentDocname, theme },
      { context: contextFor(props.session.contentDocname) },
    )
    await load()
  } catch (error) {
    const message = error instanceof Error && error.message
    toast.error(message || 'Could not change the theme.')
  } finally {
    restoring.value = false
  }
}

/** A converted presentation takes its theme in its room, then the row records which theme it was. */
async function fillTheme(theme: string) {
  showThemeDialog.value = false
  const template = templateList.value.find(({ name }) => name === theme)
  if (inReadonlyMode.value || !template) {
    return
  }

  await drawTemplateLayouts([theme])
  const layout = firstLayout(template)
  if (!layout) {
    toast.error(translate('This theme has no slides to start from'))
    return
  }

  try {
    // the layout's pictures belong to the template: this presentation takes its own
    const adopted = await client.mutation(
      api.slides.media.adoptSlide,
      { parent: props.session.contentDocname, slide: layout },
      { context: contextFor(props.session.contentDocname) },
    )
    // a converted template's layouts are already drawn, and only their elements come back as text
    const [slide] = template.is_converted
      ? [{ ...adopted, elements: JSON.parse(String(adopted.elements)) }]
      : rowSlides([adopted])
    if (!convertedRoom.fillBlank(slide)) {
      toast.error(translate('Only a new, empty presentation can take a theme'))
      return
    }
  } catch (error) {
    const message = error instanceof Error && error.message
    toast.error(message || translate('Could not change the theme.'))
    return
  }

  await writeTheme(api.slides.documents.updateTheme, theme)
}

const showThemeChange = ref(false)
// a theme picker shows every template's layouts
watch([showThemeDialog, showThemeChange], (opened) => {
  if (opened.some(Boolean)) {
    void drawTemplateLayouts()
  }
})
const driveActions = useDriveDocumentActions(props.session)
const presentationMenu = computed(() => [
  { group: '', options: driveActions.value.back },
  {
    group: '',
    options: [
      {
        label: 'Change theme',
        icon: 'lucide-swatch-book',
        condition: () => !inReadonlyMode.value,
        onClick: () => {
          showThemeChange.value = true
        },
      },
      { label: 'Shortcuts', icon: 'lucide-keyboard', onClick: openAreaShortcuts },
      {
        label: translate('Discard my changes'),
        icon: 'lucide-trash-2',
        condition: () => canDownloadChanges.value,
        onClick: discardChanges,
      },
      {
        label: translate('Reload'),
        icon: 'lucide-refresh-cw',
        condition: () => isOnlyCopy.value && access.writable.value,
        onClick: reloadAfterAccessBack,
      },
    ],
  },
  { group: '', options: driveActions.value.node },
])

// The header renames through the session; the deck keeps its own copy of the title.
watch(
  () => props.session.title.value,
  (title) => {
    if (presentationDoc.value) presentationDoc.value.title = title
  },
)
// an empty presentation has no show, and a converted one none from its rows, so /present opens the deck
watch(
  [() => route.name, loaded, () => slides.value.length, isConverted],
  ([name, done, count, converted]) => {
    if (name === 'slides-slideshow' && done && (!count || converted)) {
      void router.replace({ name: 'document-host', params: route.params, query: route.query })
    }
  },
)
watch(
  editable,
  (canEdit) => {
    viewOnly.value = !canEdit
    // Only an element being typed in was editable, so only that one becomes so again
    if (!canEdit || focusElementId.value) {
      // SAFETY: the untyped text editor store holds the open element's editor, or null
      const editor = activeEditor.value as Editor | null
      editor?.setEditable(canEdit)
    }
  },
  {
    immediate: true,
    flush: 'sync',
  },
)
watch(phone, (isPhone) => {
  if (isPhone) resetFocus()
})
// An open text element would keep taking keystrokes that no save carries. Not on every
// entry to read-only: closing an element marks the deck dirty, which a tab that has just
// lost access could never clear, and a restore that fails should keep the selection.
watch(writesBlocked, (blocked) => {
  if (!blocked) return
  flushPendingBlur()
  resetFocus()
})
const slidePosition = computed(() => (slideIndex.value ?? 0) + 1)
function showSlide(step: number) {
  changeEditorSlide((slideIndex.value ?? 0) + step, false)
}

function showPanel(next: Panel | null) {
  panel.value = next
}

/** Save pending edits, or refuse: a version holds only the saved state. */
async function flushEdits() {
  await saveChanges()
  if (saveRefused.value) {
    throw new Error(translate('This presentation changed elsewhere. Reload before you do this.'))
  }

  if (dirty.value || isSaving.value || saveFailed.value) {
    throw new Error(
      'Your latest changes are not saved yet. Try again when the presentation is saved.',
    )
  }
}
async function restoreVersion(seq: string) {
  await flushEdits()
  restoring.value = true
  try {
    await props.session.versions.restore(seq)
    previewed.value = null
    await load()
    // A reload that failed leaves the old slides in place, and they are not the restored version.
    if (!loadError.value) previewCapture.value?.captureAfterPause()
  } finally {
    restoring.value = false
  }
}

function storedFile(seq: string, bytes: Uint8Array) {
  const title = fileTitle(props.session.title.value)
  return new File([new Uint8Array(bytes)], `${title} (v${seq}).json`, { type: 'application/json' })
}

// Bytes no preview can draw: the person keeps them as the stored file
function offerStoredFile(seq: string, bytes: Uint8Array) {
  const file = storedFile(seq, bytes)
  toast.error(
    translate("This version can't be read, so it can't be restored. You can download it."),
    {
      action: { label: translate('Download'), onClick: () => saveThroughBrowser(file) },
    },
  )
}

// Version `seq`'s bytes and its pictures binned or deleted now; null once the person is told why not
async function versionToRestore(seq: string) {
  try {
    const bytes = await fetchVersion(props.session, Number(seq))
    const body = await readVersionBody(bytes).catch(() => null)
    if (!body) {
      offerStoredFile(seq, bytes)
      return null
    }

    return { bytes, images: await missingImages(props.session, versionImages(body)) }
  } catch (error) {
    console.error(error)
    toast.error(translate("This version's images couldn't be checked, so nothing was restored."))
    return null
  }
}

// A converted presentation restores in the editor, for everyone at once (Q5)
async function confirmLiveRestore(seq: string) {
  const version = await versionToRestore(seq)
  if (!version) {
    return
  }

  const { bytes, images } = version
  const message = [
    translate(
      'The presentation goes back to this version for everyone. Its current state is kept as a version first.',
    ),
    othersPresentWarning(roomPeople.value, userSession.user.value?.id ?? '', 'presentation'),
    imagesNotice(images),
  ]
  dialog.confirm({
    title: translate('Restore this version?'),
    message: message.filter(Boolean).join(' '),
    confirmLabel: translate('Restore'),
    onConfirm: () => restoreLive(seq, bytes, images),
  })
}

async function restoreLive(seq: string, bytes: Uint8Array, images: MissingImage[]) {
  try {
    await restoreImages(props.session, images)
    const restored = await convertedRoom.restore(Number(seq), bytes, () =>
      convertedVersion(props.session, Number(seq)),
    )
    if (!restored.isRestored) {
      tellNotRestored(seq, bytes, restored)
      return
    }

    toast.success(restored.message)
    previewed.value = null
    void versionsPanel.value?.reload()
    previewCapture.value?.captureAfterPause()
  } catch (error) {
    console.error(error)
    toast.error(translate('The version was not restored.'))
  }
}

function tellNotRestored(seq: string, bytes: Uint8Array, refused: RestoreNotice) {
  if (!refused.canDownload) {
    toast.error(refused.message)
    return
  }

  toast.error(refused.message, {
    action: { label: translate('Download'), onClick: () => void downloadVersion(seq, bytes) },
  })
}

// A version that can be drawn shows in the preview and prints as a PDF; one that can't goes out as stored
async function downloadVersion(seq: string, bytes: Uint8Array) {
  let shown: Record<string, unknown>[]
  try {
    shown = versionSlides(await readVersionBody(bytes))
  } catch {
    saveThroughBrowser(storedFile(seq, bytes))
    return
  }

  panel.value = 'versions'
  previewed.value = seq
  printedSlides.value = shown
  exportPdf()
}

async function tellRestoredByOther(restored: VersionRestored) {
  void versionsPanel.value?.reload()
  toast.info(await restoredByOther(restored, 'presentation'))
}
let isWaitingToPrint = false
async function printDrawnPages() {
  const pages = exportView.value?.$el
  if (!pages) return

  try {
    await drawnFontsLoaded(pages)
  } catch {
    // a failed wait prints as a stall does
  }

  // left the presentation while a font loaded
  if (!exportView.value) return

  window.addEventListener(
    'afterprint',
    () => {
      exporting.value = false
      printedSlides.value = null
    },
    {
      once: true,
    },
  )
  window.print()
}
function exportPdf() {
  if (isWaitingToPrint) return

  isWaitingToPrint = true
  exporting.value = true
  void nextTick(() => {
    window.setTimeout(() => {
      void printDrawnPages().finally(() => {
        isWaitingToPrint = false
      })
    }, 200)
  })
}
// A source's own link code, so a public combined presentation opens signed out
async function readSource(nodeId: string) {
  const credentials = props.session.credentials.group([nodeId])[0]
  return readSavedDocument({ nodeId, credentials })
}

async function loadComposite(run: number) {
  // Sent with every held link code: the server names the node of each
  // reference those codes open, and each group then sends only its own codes.
  const manifest = await client.query(
    api.slides.composites.manifest,
    {
      name: props.session.contentDocname,
    },
    {
      context: props.session.credentials.heldContext,
    },
  )
  if (!isCurrent(run)) return

  let shown: MergedCompositeSlide[] = []
  const loader = new CompositeGroupLoader(
    manifest,
    props.session.credentials,
    async (references, context) => {
      const group = await client.query(
        api.slides.composites.group,
        {
          name: props.session.contentDocname,
          references,
        },
        {
          context,
        },
      )
      return { references: await withSavedSlides(group.references, readSource) }
    },
    (items) => {
      if (!isCurrent(run)) return

      compositeItems.value = items.map((item) => ({
        ...item,
      }))
      // A group that arrives moves indexes; the viewer stays on the slide they read.
      const place = placeAt(shown, slideIndex.value ?? 0)
      shown = mergeCompositeSlides(items)
      const merged = shown.map((entry) =>
        entry.slide ? normalizeCompositeSlide(entry.slide) : placeholderSlide(entry),
      )
      slides.value = merged
      slidesLength.value = merged.length
      if (merged.length) setSlideIndex((place ? indexOfPlace(shown, place) : 0) + 1)
    },
  )
  compositeItems.value = loader.items.map((item) => ({
    ...item,
  }))
  await loader.load()
}

// Access can widen while the first load is still out, which starts another. Only the
// latest load may end the loading state: an earlier one returns no document, and
// ending it then draws the panels before any slide is there.
let latestLoad = 0
// a surface left behind loads nothing more, so a late reply can't land in the next presentation
let isLeft = false
function isCurrent(run: number) {
  return !isLeft && run === latestLoad
}
async function load() {
  if (isLeft) return

  const run = ++latestLoad
  loading.value = true
  loadError.value = ''
  try {
    // Not `editable`: a restore pauses editing, and its reload is still an editor load.
    const readonly = !access.writable.value || composite.value || !!conversion.value
    const doc = await initPresentationDoc(props.session.contentDocname, readonly)
    if (!isCurrent(run)) return

    clearOnlyCopy()
    if (doc) {
      settleCopies()
    }

    if (presentationDoc.value) presentationDoc.value.title = props.session.title.value

    setSlideIndex(presentedSlide.value)
    loadTemplates()
    composite.value = !!doc?.is_composite
    isConverted.value = !!doc?.is_converted
    const status = doc?.conversion
    conversion.value =
      status && typeof status === 'object' && 'state' in status && typeof status.state === 'string'
        ? {
            state: status.state,
            ...('reason' in status && typeof status.reason === 'string'
              ? { reason: status.reason }
              : { reason: undefined }),
          }
        : null
    if (isConverted.value) {
      await showConvertedSlides(run)
      // a draft from before the live room holds edits it never sent, so it stays as a copy
      void settleOldDraft()
    }

    if (!isCurrent(run)) return

    if (composite.value) {
      await loadComposite(run)
    } else if (!conversion.value) {
      void offerTheme()
    }

    if (!isCurrent(run)) return

    // a group that didn't load names none of its pictures, so their bytes would pass for orphans
    if (!composite.value || compositeItems.value.every((item) => item.status === 'ready')) {
      pruneOfflineCopy(presentationId.value).catch(() => {})
    }
  } catch (error) {
    if (!isCurrent(run)) return
    loadError.value = error instanceof Error ? error.message : 'Could not open this presentation.'
    // The server may have rewritten the deck, so an earlier save's capture would send old slides.
    previewCapture.value?.cancelCapture()
  } finally {
    if (isCurrent(run)) {
      loading.value = false
      loaded.value = true
    }
  }
}

async function showConvertedSlides(run: number) {
  const isOpen = await convertedRoom.open(() => !isCurrent(run))
  if (!isOpen) {
    throw new Error(translate('Could not open this presentation.'))
  }

  if (isCurrent(run)) {
    setSlideIndex(presentedSlide.value)
  }
}

function cancelRunningLoad() {
  latestLoad++
  startLoad()
  loading.value = false
}

function normalizeCompositeSlide(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { elements: [] }
  const slide: Record<string, unknown> = {}
  Object.assign(slide, value)
  if (typeof slide.elements === 'string') {
    try {
      slide.elements = JSON.parse(slide.elements)
    } catch {
      slide.elements = []
    }
  }
  slide.elements ??= []
  slide.clientId = slide.client_id || slide.clientId || slide.name
  slide.transitionDuration = slide.transition_duration ?? slide.transitionDuration ?? 0
  slide.fadeUnmatchedElements = slide.fade_unmatched_elements ?? slide.fadeUnmatchedElements ?? 0
  return slide
}
function placeholderSlide(entry: { reference: string; index: number; status: string }) {
  return {
    name: `composite-placeholder-${entry.reference}`,
    clientId: `composite-placeholder-${entry.reference}`,
    idx: entry.index,
    background: '#ffffffff',
    elements: [],
    transition: 'None',
    transitionDuration: 0,
    fadeUnmatchedElements: 0,
    compositePlaceholder: entry.status,
  }
}
const saveState = computed<DocumentSaveState>(() => {
  if (isConverted.value) {
    return convertedRoom.saveState.value
  }

  if (isSaving.value) {
    return 'saving'
  }

  if (saveFailed.value) {
    return 'failed'
  }

  // only the screen holds the slides, whatever the save flags say
  return dirty.value || isOnlyCopy.value ? 'unsaved' : 'clean'
})
async function flush() {
  if (isConverted.value) {
    flushLive()
    return
  }

  await saveChanges()
}
useDocumentLeaveGuard({
  state: () => saveState.value,
  flush,
  retainRecovery,
})
useAutosave({
  editable: computed(() => editable.value && !isConverted.value),
  interacting: isSlideInteractionActive,
})
// The card picture follows the room: once everything reached the server (Q2)
watch(convertedRoom.saveState, (state) => {
  if (!isConverted.value) return

  if (state === 'clean') {
    previewCapture.value?.captureAfterPause()
  } else {
    previewCapture.value?.cancelCapture()
  }
})
// The show takes the keyboard: the editor under it is inert, so no editor menu opens over
// the audience, and focus goes back where it was, or to Present, once the show ends
const presentControls = ref<InstanceType<typeof PresentButton> | null>(null)
let focusedBeforeShow: Element | null = null
watch(
  presenting,
  (isPresenting) => {
    if (isPresenting) focusedBeforeShow = document.activeElement
  },
  { flush: 'sync' },
)
// After the render, once the editor is no longer inert
watch(
  presenting,
  (isPresenting) => {
    if (isPresenting) return
    const before = focusedBeforeShow?.isConnected ? focusedBeforeShow : null
    const target = before ?? presentControls.value?.$el.querySelector('button')
    if (target instanceof HTMLElement) target.focus()
  },
  { flush: 'post' },
)
// closing the tab ends a push of the presentation left behind too
function unloadState(): DocumentSaveState {
  if (savingFor.value) {
    return 'saving'
  }

  return saveState.value
}

// the warning is for the other push; a clean presentation has nothing of its own to keep
function retainUnlessClean() {
  return saveState.value === 'clean' || retainOrWarn()
}

function warnBeforeUnload(event: Event) {
  resolveDocumentUnload({ state: unloadState, retainRecovery: retainUnlessClean }, event)
}

// what a refused picture means for the copy depends on which of these it is
watch(online, () => refreshOfflineStatus(presentationId.value))
function setOnline() {
  online.value = true
}
function setOffline() {
  online.value = false
}

const deckUnavailable = computed(
  () => loading.value || !access.readable.value || !slides.value.length || isConverted.value,
)
const canPin = computed(
  () =>
    'serviceWorker' in navigator &&
    'caches' in window &&
    !window.disable_slides_service_worker &&
    !presentationDoc.value?.is_composite &&
    !isConverted.value &&
    isMediaOwner(presentationDoc.value?.owner, userSession.user.value?.id),
)
const showsOfflineCopy = computed(() => canPin.value || offlineCopyStatus.value === 'unusable')
watch([slides, () => presentationDoc.value?.modified], () => {
  if (!slides.value.length) {
    refreshOfflineStatus(null)
    return
  }

  refreshOfflineStatus(presentationId.value)
  if (canPin.value) {
    warmOfflineCopyAssets(presentationId.value).catch((err) =>
      console.warn('Slides offline copy refresh failed:', err),
    )
  }

  if (access.readable.value && getCookieSessionUser()) {
    void rememberVisit(presentationId.value)
    void storeVisitedMedia(presentationId.value)
  }
})
// outside any visit or pin, which mark what they fetch so the worker keeps out
const warmFonts = () => void warmBundledFonts().catch(() => {})
onMounted(() => {
  void load()
  void registerSlidesWorker()
  void postToServiceWorker('slides-entered')
  // a first visit's worker can take control long after the page opened
  if (navigator.serviceWorker?.controller) {
    warmFonts()
  } else {
    navigator.serviceWorker?.addEventListener('controllerchange', warmFonts, { once: true })
  }
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOffline)
  window.addEventListener('beforeunload', warnBeforeUnload)
})
onBeforeUnmount(() => {
  // a load or room still on its way after this finds itself stale and touches nothing
  isLeft = true
  resetFocus()
  convertedRoom.close()
  cancelVisit()
  stopVisitedMedia()
  void postToServiceWorker('slides-left')
  navigator.serviceWorker?.removeEventListener('controllerchange', warmFonts)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOffline)
  window.removeEventListener('beforeunload', warnBeforeUnload)
  resetFocus()
  // A deck whose writes stopped sends nothing here; the next open starts afresh.
  void saveChanges().finally(() => {
    releaseContext()
    releaseMedia()
    releaseTemplateReader()
    resumeWrites(props.session.contentDocname)
  })
  resetEditorState()
})
</script>

<template>
  <div
    class="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface-base"
    :inert="presenting"
  >
    <DriveDocumentHeader
      :session="session"
      title-label="Presentation title"
      :save-state="saveState"
      :view-only="!editable"
      :recoverable="canDownloadChanges"
      :panels="session.panels.value"
      layout="centered"
      :panel="panel"
      @update:panel="showPanel"
      @download-changes="downloadChanges"
    >
      <template #icon="{ icon }">
        <Dropdown :options="presentationMenu">
          <Button
            variant="ghost"
            icon-right="lucide-chevron-down"
            :aria-label="__('Presentation menu')"
          >
            <span class="block size-4.5" :class="icon" aria-hidden="true" />
          </Button>
        </Dropdown>
      </template>
      <template #actions>
        <UsersBar v-if="roomPeople.length" :users="roomPeople" />
        <OfflineCopyButton v-if="showsOfflineCopy" />
        <Button
          icon="lucide-file-down"
          tooltip="Export"
          aria-label="Export"
          variant="ghost"
          class="max-md:hidden"
          :disabled="deckUnavailable"
          @click="exportPdf"
        />
      </template>
      <template #primary>
        <PresentButton
          ref="presentControls"
          :is-disabled="deckUnavailable"
          @start="startSlideShow"
        />
      </template>
    </DriveDocumentHeader>

    <div v-if="!access.readable.value" class="m-auto max-w-md px-6 text-center">
      <span class="lucide-lock-keyhole mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">
        You no longer have permission to read this presentation.
      </p>
    </div>
    <div
      v-else-if="loading"
      class="flex min-h-0 flex-1 bg-surface-gray-1"
      role="status"
      aria-label="Opening presentation"
    >
      <div
        class="flex w-56 shrink-0 flex-col gap-4 border-r border-outline-elevation-1 bg-surface-elevation-1 p-4 max-md:hidden"
      >
        <Skeleton class="h-4 w-24" />
        <Skeleton v-for="n in 5" :key="n" class="aspect-video w-full rounded-6" />
      </div>
      <div class="flex min-w-0 flex-1 items-center justify-center p-4 md:p-10">
        <Skeleton class="aspect-video w-full max-w-[900px] rounded-4" />
      </div>
      <div
        v-if="editable"
        class="flex w-72 shrink-0 flex-col gap-4 border-l border-outline-elevation-1 bg-surface-elevation-1 p-4 max-md:hidden"
      >
        <Skeleton class="h-4 w-28" />
        <Skeleton class="h-7 w-full" />
        <Skeleton class="h-4 w-20" />
        <Skeleton class="h-7 w-full" />
      </div>
    </div>
    <div v-else-if="loadError" class="m-auto max-w-md px-6 text-center">
      <span class="lucide-lock-keyhole mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">{{ loadError }}</p>
    </div>
    <div v-else class="relative flex min-h-0 flex-1 flex-col bg-surface-gray-1">
      <p
        v-if="notice"
        role="status"
        class="shrink-0 border-b border-outline-gray-1 bg-surface-amber-1 px-4 py-2 text-sm text-ink-amber-7"
        :class="{ 'ml-56': isNoticeBesidePanel }"
      >
        {{ notice }}
      </p>
      <SlidesVersionPreview v-if="previewed" :session="session" :seq="previewed" />
      <template v-else-if="phone">
        <div class="relative flex min-h-0 flex-1">
          <SlideContainer
            v-if="presentationDoc"
            v-model:has-ongoing-interaction="isSlideInteractionActive"
            fit
          />
        </div>
        <nav
          v-if="slidesLength"
          class="flex shrink-0 items-center justify-center gap-4 border-t border-outline-gray-1 bg-surface-base px-3 py-2"
          aria-label="Slides"
        >
          <Button
            icon="lucide-chevron-left"
            aria-label="Previous slide"
            variant="ghost"
            :disabled="slidePosition <= 1"
            @click="showSlide(-1)"
          />
          <span class="text-sm tabular-nums text-ink-gray-6"
            >{{ slidePosition }} of {{ slidesLength }}</span
          >
          <Button
            icon="lucide-chevron-right"
            aria-label="Next slide"
            variant="ghost"
            :disabled="slidePosition >= slidesLength"
            @click="showSlide(1)"
          />
        </nav>
      </template>
      <template v-else>
        <div class="relative flex min-h-0 flex-1">
          <SlideContainer
            v-if="presentationDoc"
            v-model:has-ongoing-interaction="isSlideInteractionActive"
          />
        </div>
        <NavigationPanel class="absolute inset-y-0 left-0" @change-slide="changeEditorSlide" />
        <Toolbar v-if="editing && presentationDoc" />
        <PropertiesPanel v-if="editing" class="absolute inset-y-0 right-0" />
      </template>
    </div>

    <SurfaceNotice
      v-if="oldDraftNotice && !heldNotice && !loading"
      icon="lucide-history"
      :message="oldDraftNotice"
    >
      <Button variant="ghost" :label="__('Download')" @click="downloadOldDraft" />
      <Button variant="ghost" :label="__('Dismiss')" @click="dismissOldDraft" />
    </SurfaceNotice>

    <SurfaceNotice
      v-if="heldNotice && !loading"
      icon="lucide-triangle-alert"
      icon-class="text-ink-amber-6"
      :message="heldNotice.message"
    >
      <Button variant="ghost" :label="__('Download')" @click="downloadChanges" />
      <Button
        v-if="heldNotice.reload"
        variant="ghost"
        :label="__('Reload')"
        @click="heldNotice.reload"
      />
    </SurfaceNotice>

    <aside
      v-if="panel === 'comments'"
      class="absolute bottom-0 right-0 top-12 z-30 flex w-full flex-col md:w-80 border-l border-outline-gray-1 bg-surface-elevation-1 shadow-xl"
      aria-label="Comments"
    >
      <div class="flex min-h-12 items-center justify-between border-b border-outline-gray-1 px-4">
        <h2 class="text-lg-semibold">Comments</h2>
        <Button icon="lucide-x" aria-label="Close panel" variant="ghost" @click="panel = null" />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <DriveCommentList
          :threads
          :read-at="threadsReadAt"
          :node="session.nodeId"
          :places="null"
          :can-comment="access.canComment.value"
          :can-edit-document="access.writable.value"
          :can-share="session.canShare.value"
          :actions="threadActions"
          :drafts="commentDrafts"
          noun="presentation"
        />
      </div>
    </aside>
    <SlidesVersionsPanel
      v-else-if="panel === 'versions'"
      ref="versionsPanel"
      v-model:previewed="previewed"
      :session="session"
      :writable="canRestoreVersions"
      :flush="flushEdits"
      :restore="restoreVersion"
      :confirm-restore="liveRestore"
      @close="panel = null"
    />

    <LayoutDialog v-model:open="showLayoutDialog" @insert="insertLayout" />
    <ThemeDialog
      v-model:open="showThemeDialog"
      @create="
        isConverted ? fillTheme($event) : writeTheme(api.slides.documents.applyTheme, $event)
      "
    />
    <ThemeDialog
      v-model:open="showThemeChange"
      update
      @update="writeTheme(api.slides.documents.updateTheme, $event)"
    />

    <teleport to="body">
      <ExportView v-if="exporting" ref="exportView" :slides="exportedSlides" />
      <!-- `restoring` keeps it mounted while a restore pauses editing: it holds what it last sent,
           and it must be there to take the capture the restore asks for. -->
      <PreviewCapture v-if="editing || restoring" ref="previewCapture" :session="session" />
      <Slideshow v-if="presenting" :active-slide-id="presentedSlide" />
    </teleport>
  </div>
</template>
