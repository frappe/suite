<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { Button, Skeleton, TextInput, toast } from 'frappe-ui'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'

import {
  DriveCommentAuthor,
  DriveDocumentHeader,
  GUEST_NAME_LIMIT,
  useDriveGuestName,
  type CredentialGrouper,
  type DocumentPanel,
  type DocumentSession,
} from '@/apps/drive'
import LayoutDialog from '@/apps/slides/components/LayoutDialog.vue'
import NavigationPanel from '@/apps/slides/components/NavigationPanel.vue'
import PropertiesPanel from '@/apps/slides/components/PropertiesPanel.vue'
import SlideContainer from '@/apps/slides/components/SlideContainer.vue'
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
  initPresentationDoc,
  inReadonlyMode,
  loadTemplates,
  presentationDoc,
  resetEditorState,
  setDocumentFetch,
  slidesLength,
  viewOnly,
} from '@/apps/slides/stores/presentation'
import {
  dirty,
  isSaving,
  resumeWrites,
  saveChanges,
  saveCurrentState,
  saveFailed,
  stopWrites,
} from '@/apps/slides/stores/saving'
import {
  changeEditorSlide,
  focusedSlide,
  handleInsertSlide,
  setSlideIndex,
  slideIndex,
  slides,
} from '@/apps/slides/stores/slide'
import { inSlideShowMode } from '@/apps/slides/stores/slideshow'

import { createSlidesAccess } from './access'
import {
  CompositeGroupLoader,
  indexOfPlace,
  mergeCompositeSlides,
  placeAt,
  type CompositeItem,
  type CompositeManifest,
  type MergedCompositeSlide,
} from './compositeGroups'
import ExportView from './ExportView.vue'
import { useDocumentLeaveGuard, type DocumentSaveState } from './navigation'
import { clearRecovery, downloadRecovery, keepRecovery, readRecovery } from './recovery'
import SlidesVersionsPanel from './SlidesVersionsPanel.vue'

type Send = CredentialGrouper['fetch']
type Panel = DocumentPanel

/** `GET nodes/<id>/threads` */
interface CommentThread {
  name: string
  resolved: boolean
  comments: {
    name: string
    content: string
    author: string | null
    author_name: string | null
    creation: string | null
  }[]
}

const props = defineProps<{ session: DocumentSession }>()
const loading = ref(true)
const loadError = ref('')
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
const hasRecovery = ref(readRecovery(props.session.nodeId) !== null)
const isSlideInteractionActive = ref(false)
let autosaveTimer: number | undefined

const access = createSlidesAccess(props.session, {
  narrowed() {
    // First, so no snapshot and no push leaves after this point. `stopWrites`
    // also cancels a save under way and retires the draft, so it never replays.
    const unsaved = dirty.value || isSaving.value || saveFailed.value
    viewOnly.value = true
    void stopWrites(props.session.contentDocname)
    if (!unsaved) {
      toast.warning('Editing access changed. This presentation is now view only.')
      return
    }
    retainRecovery()
    toast.warning('Editing access changed. Your unsaved changes are kept on this device.', {
      duration: Number.POSITIVE_INFINITY,
      action: { label: 'Download my changes', onClick: downloadChanges },
    })
  },
  widened() {
    // The server copy is the truth now: reload it rather than replay anything.
    resumeWrites(props.session.contentDocname)
    toast.info('You can edit this presentation again.')
    void load()
  },
})
// A restore pauses editing: nothing is written while the server rewrites the deck.
const restoring = ref(false)
const editable = computed(() => access.writable.value && !composite.value && !restoring.value)
// Phones get a viewer: the slide fitted to the screen with previous and next. The
// editor's panels need a wide screen. Same breakpoint as the shell's phone layout.
const phone = useMediaQuery('(max-width: 767px)')
const editing = computed(() => editable.value && !phone.value)

// Body requests go through the session, with this document's link credentials.
// A refused write is a verdict: access narrows until the presentation opens again.
const send: Send = async (url, init) => {
  const response = await props.session.credentials.fetch(url, init)
  if (init?.method === 'POST' && (response.status === 401 || response.status === 403))
    access.refuse()
  return response
}
const releaseFetch = setDocumentFetch(props.session.contentDocname, send)
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

// The header renames through the session; the deck keeps its own copy of the title.
watch(
  () => props.session.title.value,
  (title) => {
    if (presentationDoc.value) presentationDoc.value.title = title
  },
)
watch(
  editable,
  (canEdit) => {
    viewOnly.value = !canEdit
  },
  { immediate: true, flush: 'sync' },
)
watch(phone, (isPhone) => {
  if (isPhone) resetFocus()
})

const slidePosition = computed(() => (slideIndex.value ?? 0) + 1)
function showSlide(step: number) {
  changeEditorSlide((slideIndex.value ?? 0) + step, false)
}
// A save that lands with edit access makes the recovery copy stale.
watch(isSaving, (now, before) => {
  if (!before || now || saveFailed.value || !editable.value || !hasRecovery.value) return
  clearRecovery(props.session.nodeId)
  hasRecovery.value = false
})

function showPanel(next: Panel | null) {
  panel.value = next
  if (next === 'comments') void loadComments()
}

async function loadComments() {
  panelLoading.value = true
  try {
    const result = (await props.session.comments.list()) as { threads?: CommentThread[] }
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
        { once: true },
      )
      window.print()
    }, 200)
  })
}

async function loadComposite() {
  // Sent with every held link code: the server names the node of each
  // reference those codes open, and each group then sends only its own codes.
  const manifest = await frappeGet<CompositeManifest>(
    'suite.slides.api.composite.composite_manifest',
    { name: props.session.contentDocname },
    props.session.credentials.fetchHeld,
  )
  let shown: MergedCompositeSlide[] = []
  const loader = new CompositeGroupLoader(
    manifest,
    props.session.credentials,
    async (references, groupSend) =>
      frappeGet(
        'suite.slides.api.composite.composite_group',
        { name: props.session.contentDocname, references },
        groupSend,
      ),
    (items) => {
      compositeItems.value = items.map((item) => ({ ...item }))
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
  compositeItems.value = loader.items.map((item) => ({ ...item }))
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
      !access.writable.value || composite.value,
    )
    if (run !== latestLoad) return
    if (presentationDoc.value) presentationDoc.value.title = props.session.title.value
    setSlideIndex(1)
    loadTemplates()
    composite.value = !!doc?.is_composite
    if (composite.value) await loadComposite()
  } catch (error) {
    if (run !== latestLoad) return
    loadError.value = error instanceof Error ? error.message : 'Could not open this presentation.'
  } finally {
    if (run === latestLoad) loading.value = false
  }
}

function normalizeCompositeSlide(value: unknown) {
  const slide: Record<string, unknown> = { ...(value as Record<string, unknown>) }
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

async function frappeGet<T>(
  method: string,
  args: Record<string, unknown>,
  through: Send,
): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(args)) {
    query.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value))
  }
  const response = await through(`/api/method/${method}?${query}`, { credentials: 'same-origin' })
  const body = (await response.json().catch(() => ({}))) as {
    message?: T
    data?: T
    exc?: string
    exc_type?: string
  }
  if (!response.ok || body.exc) throw new Error(body.exc_type ?? 'Request failed')
  return (body.message ?? body.data ?? body) as T
}

function retainRecovery() {
  if (!slides.value?.length) return
  try {
    keepRecovery(props.session.nodeId, JSON.parse(JSON.stringify(slides.value)) as unknown[])
    hasRecovery.value = true
  } catch {
    toast.error('Your latest changes could not be kept on this device.')
  }
}

function downloadChanges() {
  const downloaded = downloadRecovery(props.session.nodeId, props.session.title.value)
  hasRecovery.value = false
  if (!downloaded) toast.error('No recovery copy is kept for this presentation.')
}

const saveState = computed<DocumentSaveState>(() =>
  isSaving.value ? 'saving' : saveFailed.value ? 'failed' : dirty.value ? 'unsaved' : 'clean',
)
async function flush() {
  await saveChanges()
}
useDocumentLeaveGuard({ state: () => saveState.value, flush, retainRecovery })

function setOnline() {
  online.value = true
}
function setOffline() {
  online.value = false
}
onMounted(() => {
  void load()
  autosaveTimer = window.setInterval(() => {
    if (editable.value && !isSlideInteractionActive.value && !focusedSlide.value) void saveChanges()
  }, 1_000)
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOffline)
})
onBeforeUnmount(() => {
  if (autosaveTimer) window.clearInterval(autosaveTimer)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOffline)
  resetFocus()
  // A deck whose writes stopped sends nothing here; the next open starts afresh.
  void saveCurrentState().finally(() => {
    releaseFetch()
    releaseMedia()
    resumeWrites(props.session.contentDocname)
  })
  resetEditorState()
})
</script>

<template>
  <div class="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface-base">
    <DriveDocumentHeader
      :session="session"
      title-label="Presentation title"
      :save-state="saveState"
      :view-only="!editable"
      :recoverable="hasRecovery"
      :panels="['comments', 'versions']"
      :panel="panel"
      @update:panel="showPanel"
      @download-changes="downloadChanges"
    >
      <template #actions>
        <Button
          icon="lucide-file-down"
          tooltip="Export"
          aria-label="Export"
          variant="ghost"
          class="max-md:hidden"
          :disabled="loading || !access.readable.value || !slides.length"
          @click="exportPdf"
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
            <div v-for="comment in thread.comments" :key="comment.name">
              <p class="text-sm-medium text-ink-gray-8">
                <DriveCommentAuthor :author="comment.author" :author-name="comment.author_name">{{
                  comment.author_name || 'Someone'
                }}</DriveCommentAuthor>
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
      :writable="access.writable.value && !restoring"
      :flush="flushEdits"
      :restore="restoreVersion"
      @close="panel = null"
    />

    <LayoutDialog v-model:open="showLayoutDialog" @insert="insertLayout" />

    <teleport to="body">
      <ExportView v-if="exporting" :slides="slides" />
    </teleport>
  </div>
</template>
