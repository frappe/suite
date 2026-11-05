<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { Avatar, Button, Dropdown, Skeleton, TextInput, toast } from 'frappe-ui'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, client } from '@/api'
import {
  DriveCommentAuthor,
  DriveDocumentHeader,
  GUEST_NAME_LIMIT,
  useDriveDocumentActions,
  useDriveGuestName,
  type DocumentPanel,
  type DocumentSession,
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
import { useShortcuts } from '@/apps/slides/composables/useShortcuts'
import { setDocumentMedia } from '@/apps/slides/stores/documentMedia'
import { resetFocus } from '@/apps/slides/stores/element'
import {
  actionOrder as historyMetaActionOrder,
  actions as historyMetaActions,
  setCommandHistory,
} from '@/apps/slides/stores/historyMeta'
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
  resetEditorState,
  setDocumentContext,
  slidesLength,
  startLoad,
  viewOnly,
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
import { cancelVisit, rememberVisit } from '@/apps/slides/stores/visitedCopies'
import { stopVisitedMedia, storeVisitedMedia } from '@/apps/slides/stores/visitedMedia'
import { isMediaOwner } from '@/apps/slides/utils/mediaUploads'
import { postToServiceWorker, registerSlidesWorker } from '@/apps/slides/utils/serviceWorker'
import { useHideRail } from '@/platform/rail'
import { getCookieSessionUser, useSession } from '@/platform/session'
import { openAreaShortcuts } from '@/platform/shortcuts'
import { translate } from '@/platform/translation'

import { createSlidesAccess } from './access'
import { useAutosave } from './autosave'
import { authorLabel, commentTime, type CommentThread } from './comments'
import {
  CompositeGroupLoader,
  indexOfPlace,
  mergeCompositeSlides,
  placeAt,
  type CompositeItem,
  type MergedCompositeSlide,
} from './compositeGroups'
import { conversionNotice, type ConversionStatus } from './conversionNotice'
import ConvertedDeck from './ConvertedDeck.vue'
import ExportView from './ExportView.vue'
import { resolveDocumentUnload, useDocumentLeaveGuard, type DocumentSaveState } from './navigation'
import { useNewPresentationTheme } from './newPresentation'
import SlidesVersionsPanel from './SlidesVersionsPanel.vue'
import { useUnsavedRecovery } from './useUnsavedRecovery'

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
  () => route.name === 'slides-slideshow' && loaded.value && slides.value.length > 0,
)
// `?slide=N`: the slide the show presents, and the one the editor opens on.
const presentedSlide = computed(() => Math.max(1, Math.trunc(Number(route.query.slide)) || 1))
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const composite = ref(false)
const compositeItems = ref<CompositeItem[]>([])
const compositeLoader = ref<CompositeGroupLoader | null>(null)
const panel = ref<Panel | null>(null)
const threads = ref<CommentThread[]>([])
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
const exporting = ref(false)
const {
  isOnlyCopy,
  clearOnlyCopy,
  canDownloadChanges,
  narrowed,
  widened,
  keepSticky,
  retainRecovery,
  retainOrWarn,
  reloadAfterAccessBack,
  downloadChanges,
  discardChanges,
  settleCopies,
  dismissToasts,
} = useUnsavedRecovery(props.session, {
  isWritable: () => access.writable.value,
  isEditable: () => editable.value,
  load,
  cancelRunningLoad,
})
const isSlideInteractionActive = ref(false)
const access = createSlidesAccess(props.session, { narrowed, widened })
// A restore pauses editing: nothing is written while the server rewrites the deck.
const restoring = ref(false)
// Read-only until live editing: its rows no longer change
const isConverted = ref(false)
// A deck still on its rows, waiting for conversion or refused by it, is read-only too
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
    !onLayer.value,
)
const canRestoreVersions = computed(
  () => access.writable.value && !restoring.value && !isOnlyCopy.value && !onLayer.value,
)
// Phones get a viewer: the slide fitted to the screen with previous and next. The
// editor's panels need a wide screen. Same breakpoint as the shell's phone layout.
const phone = useMediaQuery('(max-width: 767px)')
const editing = computed(() => editable.value && !phone.value)
const { open: showThemeDialog, offer: offerTheme } = useNewPresentationTheme(
  props.session.contentDocname,
  editable,
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
const history = useCommandHistory(slides, {
  actions: historyMetaActions,
  actionOrder: historyMetaActionOrder,
})
setCommandHistory(history)
// What the canvas, panels and shortcuts read: the phone viewer edits nothing. The
// stores keep their own `inReadonlyMode`, which follows access and edit locks only.
const canvasReadonly = computed(() => inReadonlyMode.value || phone.value)
useShortcuts(canvasReadonly, inSlideShowMode)
provide('inReadonlyMode', canvasReadonly)
provide('inSlideShowMode', inSlideShowMode)
provide('isOnline', online)

// "Add slide" in the navigation panel and the slide context menu pick a layout here.
const showLayoutDialog = ref(false)
const insertIndex = ref(0)
provide('openLayoutDialog', (index: number) => {
  insertIndex.value = index
  showLayoutDialog.value = true
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
  // a dialog stays open through a change of access
  if (!editable.value) {
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

const showThemeChange = ref(false)
const driveActions = useDriveDocumentActions(props.session)
const presentationMenu = computed(() => [
  { group: '', options: driveActions.value.back },
  {
    group: '',
    options: [
      {
        label: 'Change theme',
        icon: 'lucide-swatch-book',
        condition: () => editable.value,
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
// an empty presentation has no show, so its /present opens the editor
watch([() => route.name, loaded, () => slides.value.length], ([name, done, count]) => {
  if (name === 'slides-slideshow' && done && !count) {
    void router.replace({ name: 'document-host', params: route.params, query: route.query })
  }
})
watch(
  editable,
  (canEdit) => {
    viewOnly.value = !canEdit
  },
  {
    immediate: true,
    flush: 'sync',
  },
)
watch(phone, (isPhone) => {
  if (isPhone) resetFocus()
})
const slidePosition = computed(() => (slideIndex.value ?? 0) + 1)
function showSlide(step: number) {
  changeEditorSlide((slideIndex.value ?? 0) + step, false)
}

function showPanel(next: Panel | null) {
  panel.value = next
  if (next === 'comments') void loadComments()
}
async function loadComments() {
  panelLoading.value = true
  try {
    const result = (await props.session.comments.list()) as {
      threads?: CommentThread[]
    }
    threads.value = result.threads ?? []
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not load the comments.')
  } finally {
    panelLoading.value = false
  }
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
    await load()
  } finally {
    restoring.value = false
  }
}
async function addComment() {
  const text = commentText.value.trim()
  if (!text || !access.canComment.value) return
  try {
    await props.session.comments.create('document', text, takeGuestName())
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not add the comment.')
    return
  }
  commentText.value = ''
  await loadComments()
}
function exportPdf() {
  exporting.value = true
  void nextTick(() => {
    window.setTimeout(() => {
      window.addEventListener(
        'afterprint',
        () => {
          exporting.value = false
        },
        {
          once: true,
        },
      )
      window.print()
    }, 200)
  })
}
async function loadComposite() {
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
  let shown: MergedCompositeSlide[] = []
  const loader = new CompositeGroupLoader(
    manifest,
    props.session.credentials,
    (references, context) =>
      client.query(
        api.slides.composites.group,
        {
          name: props.session.contentDocname,
          references,
        },
        {
          context,
        },
      ),
    (items) => {
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
  compositeLoader.value = loader
  compositeItems.value = loader.items.map((item) => ({
    ...item,
  }))
  await loader.load()
}

// Access can widen while the first load is still out, which starts another. Only the
// latest load may end the loading state: an earlier one returns no document, and
// ending it then draws the panels before any slide is there.
let latestLoad = 0
async function load() {
  const run = ++latestLoad
  loading.value = true
  loadError.value = ''
  try {
    // Not `editable`: a restore pauses editing, and its reload is still an editor load.
    const doc = await initPresentationDoc(
      props.session.contentDocname,
      !access.writable.value || composite.value || onLayer.value,
    )
    if (run !== latestLoad) return

    clearOnlyCopy()
    if (doc) {
      settleCopies()
    }

    if (presentationDoc.value) presentationDoc.value.title = props.session.title.value

    setSlideIndex(presentedSlide.value)
    loadTemplates()
    composite.value = !!doc?.is_composite
    isConverted.value = !!doc?.is_converted
    conversion.value = (doc?.conversion as ConversionStatus | undefined) ?? null
    if (composite.value) {
      await loadComposite()
    } else if (!onLayer.value) {
      void offerTheme()
    }

    // a group that didn't load names none of its pictures, so their bytes would pass for orphans
    if (!composite.value || compositeItems.value.every((item) => item.status === 'ready')) {
      pruneOfflineCopy(presentationId.value).catch(() => {})
    }
  } catch (error) {
    if (run !== latestLoad) return
    loadError.value = error instanceof Error ? error.message : 'Could not open this presentation.'
  } finally {
    if (run === latestLoad) {
      loading.value = false
      loaded.value = true
    }
  }
}

function cancelRunningLoad() {
  latestLoad++
  startLoad()
  loading.value = false
}

function normalizeCompositeSlide(value: unknown) {
  const slide: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  }
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
  await saveChanges()
}
useDocumentLeaveGuard({
  state: () => saveState.value,
  flush,
  retainRecovery,
})
useAutosave({
  editable,
  interacting: isSlideInteractionActive,
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
onMounted(() => {
  void load()
  void registerSlidesWorker()
  void postToServiceWorker('slides-entered')
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOffline)
  window.addEventListener('beforeunload', warnBeforeUnload)
})
onBeforeUnmount(() => {
  cancelVisit()
  stopVisitedMedia()
  void postToServiceWorker('slides-left')
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOffline)
  window.removeEventListener('beforeunload', warnBeforeUnload)
  dismissToasts()
  resetFocus()
  // A deck whose writes stopped sends nothing here; the next open starts afresh.
  void saveChanges().finally(() => {
    releaseContext()
    releaseMedia()
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
      :panels="['comments', 'versions']"
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

    <p
      v-if="notice"
      role="status"
      class="shrink-0 border-b border-outline-gray-1 bg-surface-amber-1 px-4 py-2 text-sm text-ink-amber-7"
    >
      {{ notice }}
    </p>
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
    <ConvertedDeck v-else-if="isConverted" :session="session" />
    <div v-else-if="phone" class="flex min-h-0 flex-1 flex-col bg-surface-gray-1">
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
    </div>
    <div v-else class="relative flex min-h-0 flex-1 bg-surface-gray-1">
      <SlideContainer
        v-if="presentationDoc"
        v-model:has-ongoing-interaction="isSlideInteractionActive"
      />
      <NavigationPanel class="absolute inset-y-0 left-0" @change-slide="changeEditorSlide" />
      <Toolbar v-if="editing && presentationDoc" />
      <PropertiesPanel v-if="editing" class="absolute inset-y-0 right-0" />
    </div>

    <div
      v-if="compositeItems.length && access.readable.value"
      class="absolute bottom-3 left-1/2 z-20 flex max-w-[70%] -translate-x-1/2 gap-1 rounded-6 border border-outline-gray-1 bg-surface-elevation-2 p-2 shadow-2xl"
    >
      <button
        v-for="item in compositeItems"
        :key="item.reference"
        type="button"
        class="rounded-4 px-2 py-1 text-xs leading-tighter"
        :class="
          item.status === 'ready'
            ? 'bg-surface-green-2 text-ink-green-7'
            : item.status === 'loading'
              ? 'bg-surface-gray-2 text-ink-gray-6'
              : 'bg-surface-amber-2 text-ink-amber-7'
        "
        :disabled="item.status !== 'failed'"
        @click="item.group !== undefined && compositeLoader?.retry(item.group)"
      >
        {{ item.index }} · {{ item.status }}
      </button>
    </div>

    <aside
      v-if="panel === 'comments'"
      class="absolute bottom-0 right-0 top-12 z-30 flex w-full flex-col md:w-80 border-l border-outline-gray-1 bg-surface-elevation-1 shadow-xl"
      aria-label="Comments"
    >
      <div class="flex min-h-12 items-center justify-between border-b border-outline-gray-1 px-4">
        <h2 class="text-lg-semibold">Comments</h2>
        <Button icon="lucide-x" aria-label="Close panel" variant="ghost" @click="panel = null" />
      </div>
      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p v-if="panelLoading" class="text-sm text-ink-gray-5">Loading…</p>
        <template v-else>
          <form v-if="access.canComment.value" class="space-y-2" @submit.prevent="addComment">
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
              @keydown.stop
            />
            <div class="flex gap-2">
              <TextInput
                v-model="commentText"
                class="flex-1"
                placeholder="Add a comment"
                aria-label="New comment"
                @keydown.stop
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
            <div v-for="comment in thread.comments" :key="comment.name" class="space-y-1">
              <p class="flex items-center gap-2 text-sm-medium text-ink-gray-8">
                <Avatar
                  v-if="comment.person"
                  :image="comment.person.user_image ?? undefined"
                  :label="comment.person.full_name"
                  size="sm"
                  shape="circle"
                />
                <DriveCommentAuthor :author="comment.author" :author-name="comment.author_name">{{
                  authorLabel(comment)
                }}</DriveCommentAuthor>
                <span class="flex-1 text-xs text-ink-gray-5">{{ commentTime(comment) }}</span>
              </p>
              <p class="whitespace-pre-wrap text-p-sm text-ink-gray-7">{{ comment.content }}</p>
            </div>
          </article>
          <p v-if="!threads.length" class="text-sm text-ink-gray-5">No comments yet.</p>
        </template>
      </div>
    </aside>
    <SlidesVersionsPanel
      v-else-if="panel === 'versions'"
      :session="session"
      :writable="canRestoreVersions"
      :flush="flushEdits"
      :restore="restoreVersion"
      @close="panel = null"
    />

    <LayoutDialog v-model:open="showLayoutDialog" @insert="insertLayout" />
    <ThemeDialog
      v-model:open="showThemeDialog"
      @create="writeTheme(api.slides.documents.applyTheme, $event)"
    />
    <ThemeDialog
      v-model:open="showThemeChange"
      update
      @update="writeTheme(api.slides.documents.updateTheme, $event)"
    />

    <teleport to="body">
      <ExportView v-if="exporting" :slides="slides" />
      <Slideshow v-if="presenting" :active-slide-id="presentedSlide" />
    </teleport>
  </div>
</template>
