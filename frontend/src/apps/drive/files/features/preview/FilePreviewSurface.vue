<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { Button, Dropdown, TabButtons } from 'frappe-ui'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, useInfiniteQuery, useMutation, useQuery } from '@/api'
import { driveNodeRoute, useDriveDialogs } from '@/apps/drive'
import { nodeContentUrl, openAsSpreadsheet, opensAsSpreadsheet } from '@/apps/drive/client/nodes'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { useTweak } from '@/platform/tweaks'

import { trashLocation, useLocationTitle } from '../../internal/locations'
import { previewKind } from '../../internal/previewKind'
import { announceTrash } from '../changeToast'
import DocumentHeader from '../document/DocumentHeader.vue'
import { nodeActions } from '../nodeActions'
import { readPresentationPreference, resolvePresentation } from '../presentation'
import { copyLink } from '../share/shareFormat'
import { useTrashActions } from '../trash/useTrashActions'
import { offeredTypes, typeQuery, typesFromQuery } from '../typeFilter'
import { uploadTargetOf } from '../uploads/queue'
import { keepImages } from './imageCache'
import { arrowsStep, escapeLeaves } from './keys'
import { rememberShown } from './lastShown'
import PdfPreview from './PdfPreview.vue'
import PreviewFallback from './PreviewFallback.vue'
import PreviewImage from './PreviewImage.vue'
import type { FilePreviewSession } from './session'
import { TEXT_PREVIEW_LIMIT } from './textContent'
import TextPreview from './TextPreview.vue'
import UploadNewVersion from './UploadNewVersion.vue'

const props = defineProps<{ session: FilePreviewSession }>()
const route = useRoute()
const router = useRouter()
const dialogs = useDriveDialogs()
const locationTitle = useLocationTitle()
const file = computed(() => props.session)
const mime = computed(() => file.value.mime ?? '')
const previewUrl = computed(() => file.value.preview.value?.url ?? '')
/** Bumped after a new version, so the browser fetches the new bytes. */
const revision = ref(0)
const contentUrl = computed(() =>
  nodeContentUrl(props.session.nodeId, { revision: revision.value }),
)
/** Saves the file, where `contentUrl` would open a PDF or a picture in the tab. */
const downloadUrl = computed(() =>
  nodeContentUrl(props.session.nodeId, { download: true, revision: revision.value }),
)
/** An empty file has no bytes on the server, so there is nothing to download or show. */
const empty = computed(() => file.value.size.value === 0)
const account = useSession()
const signedIn = computed(() => account.status.value === 'authenticated')
const trashed = computed(() => props.session.state.value === 'Trashed')
/** The listing's rules for this file. A trashed file is read-only, and only a trash root can be restored. */
const can = computed(() =>
  nodeActions(
    {
      name: props.session.nodeId,
      kind: 'file',
      state: props.session.state.value,
      trash_root: file.value.trashRoot.value,
      access: props.session.access.value,
    },
    signedIn.value,
  ),
)
const parent = computed(() => file.value.parent.value)
const canReplace = computed(() => !!parent.value && can.value.rename)
const isSpreadsheetFile = computed(() =>
  opensAsSpreadsheet({ kind: 'file', title: props.session.title.value }),
)
const parentFolder = useQuery(api.drive.nodes.get, () =>
  parent.value && isSpreadsheetFile.value && can.value.copy
    ? { node: parent.value, expand: 'access' }
    : false,
)
/** An uploaded .xlsx or .csv opens as a new spreadsheet beside it, which takes UPLOAD on the folder (§10.1). */
const opensAsSheet = computed(
  () => isSpreadsheetFile.value && can.value.copy && !!uploadTargetOf(parentFolder.data),
)
const openingAsSheet = ref(false)
async function openAsSheet() {
  if (!parent.value) return
  openingAsSheet.value = true
  // A refusal is reported where the spreadsheet is created.
  const sheet = await openAsSpreadsheet({
    name: props.session.nodeId,
    title: props.session.title.value,
    parent_node: parent.value,
  }).catch(() => null)
  openingAsSheet.value = false
  if (sheet) await router.push(driveNodeRoute(sheet))
}
/** The file is in a trashed folder, so it steps through what was trashed with it. */
const inTrashedFolder = computed(
  () => trashed.value && file.value.trashRoot.value !== props.session.nodeId,
)
const trash = useTrashActions(() => (trashed.value ? file.value.root : null))
const discovered = useQuery(api.drive.roots.list, () => (signedIn.value ? {} : false))
const trashMutation = useMutation(api.drive.nodes.trash)

const header = ref<{ focusTitle(): void } | null>(null)
const upload = ref<{ pick(): void } | null>(null)

// The type filter of the listing the file was opened from. The route carries
// it, so a reload, Back and the folder link all keep it.
const types = computed(() => typesFromQuery(route.query.type, offeredTypes({ folders: true })))
const typeFilter = computed(() => ({ type: typeQuery(types.value) }))

const folder = computed(() => file.value.folder.value)
const location = computed(() => {
  const crumb = folder.value
  if (!crumb) return null
  const label = locationTitle(crumb)
  return { label, to: { ...driveNodeRoute(crumb.name, label, 'folder'), query: typeFilter.value } }
})

// Previous and next walk the folder's files in the order the listing shows them
// by default: the saved sort, folders left out. The server applies the type
// filter as it does for the listing, so the same files come in the same order.
const order = resolvePresentation({}, readPresentationPreference())
const siblings = useInfiniteQuery(api.drive.nodes.children, () =>
  folder.value
    ? {
        node: folder.value.name,
        order_by: order.sort,
        ascending: order.dir === 'asc',
        type: types.value.length ? types.value.map((option) => option.value).join(',') : undefined,
        limit: 200,
      }
    : false,
)
const files = computed(() =>
  siblings.rows.filter(
    (row) => row.kind === 'file' && row.state === (inTrashedFolder.value ? 'Trashed' : 'Active'),
  ),
)
// Steps count from the file the route names. The host keeps this preview on
// screen while the next file opens, so a quick second press moves on from the
// file being opened, not from the one still shown.
const current = computed(() => String(route.params.node ?? props.session.nodeId))
const position = computed(() => files.value.findIndex((row) => row.name === current.value))
const previous = computed(() => (position.value > 0 ? files.value[position.value - 1] : null))
const next = computed(() =>
  position.value !== -1 && position.value < files.value.length - 1
    ? files.value[position.value + 1]
    : null,
)

// A step replaces the history entry, so Back leaves the preview in one step
// however many files the user stepped through.
function show(row: { name: string; title: string; kind: string } | null) {
  if (row) void router.replace({ ...driveNodeRoute(row), query: typeFilter.value })
}

// The page that opened the preview focuses the row of the last file shown.
watch(
  current,
  (node) => {
    const { back } = router.options.history.state
    // Leaving the preview changes the route too, to a page that is not a file.
    const isFile = node === props.session.nodeId || files.value.some((row) => row.name === node)
    if (typeof back === 'string' && isFile) rememberShown(back, node)
  },
  { immediate: true },
)
const escapeCloses = useTweak('t15-escape-closes')
const arrowsAfterClick = useTweak('t15-arrow-keys')
const returnFocus = useTweak('t15-return-focus')
/** Back to the page that opened the preview, or to the file's folder when the preview was opened directly. */
function leave() {
  if (typeof router.options.history.state.back === 'string') return router.back()
  const state = returnFocus.value ? { reveal: current.value } : undefined
  void router.push(location.value ? { ...location.value.to, state } : '/drive')
}

// Arrow keys step through the folder unless something on the page has focus,
// such as the title field, a video's controls, or the text of a text file.
// Escape leaves the text, and then the preview.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey)
    return
  if (event.key === 'Escape' && escapeCloses.value) {
    if (escapeLeaves(event.target instanceof Element ? event.target : null)) leave()
    return
  }
  const focused = document.activeElement
  if (arrowsAfterClick.value ? !arrowsStep(focused) : focused && focused !== document.body) return
  if (event.key === 'ArrowLeft') show(previous.value)
  else if (event.key === 'ArrowRight') show(next.value)
})

// The listing's row menu offers the same actions under the same rules (`nodeActions`).
const menu = computed(() => [
  ...(opensAsSheet.value
    ? [{ label: __('Open as spreadsheet'), icon: 'lucide-sheet', onClick: openAsSheet }]
    : []),
  ...(can.value.copyLink
    ? [{ label: 'Copy link', icon: 'lucide-link', onClick: copyFileLink }]
    : []),
  ...(can.value.rename
    ? [{ label: 'Rename', icon: 'lucide-pencil', onClick: () => header.value?.focusTitle() }]
    : []),
  ...(can.value.move ? [{ label: 'Move', icon: 'lucide-folder-input', onClick: move }] : []),
  ...(can.value.copy
    ? [
        {
          label: 'Make a copy',
          icon: 'lucide-copy',
          onClick: () => dialogs.copy(props.session.nodeId),
        },
      ]
    : []),
  ...(canReplace.value
    ? [{ label: 'Upload new version', icon: 'lucide-upload', onClick: () => upload.value?.pick() }]
    : []),
  {
    label: 'Details',
    icon: 'lucide-info',
    onClick: () => void dialogs.showDetails(props.session.nodeId),
  },
  ...(can.value.trash
    ? [
        {
          label: 'Move to trash',
          icon: 'lucide-trash-2',
          theme: 'red' as const,
          onClick: moveToTrash,
        },
      ]
    : []),
  ...(can.value.restore ? [{ label: 'Restore', icon: 'lucide-undo-2', onClick: restore }] : []),
  ...(can.value.deleteForever
    ? [
        {
          label: 'Delete forever',
          icon: 'lucide-trash-2',
          theme: 'red' as const,
          onClick: deleteForever,
        },
      ]
    : []),
])

const item = computed(() => ({ node: props.session.nodeId, title: props.session.title.value }))

/** The file's own page, as an absolute URL. */
function copyFileLink() {
  const page = driveNodeRoute(props.session.nodeId, props.session.title.value, 'file')
  return copyLink(router.resolve(page).href)
}

/** The toast's Undo restores the file. The preview goes back to the folder it was in, as a document does. */
async function moveToTrash() {
  const trashed = item.value
  await trashMutation.run({ node: trashed.node, state: 'Trashed' })
  announceTrash([trashed])
  await router.push(location.value?.to ?? '/drive')
}

/** The file comes back in place: the session hears the restore and reads its new state. */
async function restore() {
  await trash.restore([item.value])
}

/** The file is gone, so the preview goes back to the Trash that listed it. */
async function deleteForever() {
  const result = await trash.purge([item.value])
  if (!result?.ok.length) return
  await router.replace(trashLocation(file.value, discovered.data))
}

async function move() {
  if (await dialogs.move(props.session.nodeId)) await file.value.refreshPreview()
}

async function replaced() {
  await file.value.refreshPreview()
  revision.value += 1
}
const preview = computed(() =>
  previewKind({
    title: props.session.title.value,
    mime: file.value.mime,
    hasPreview: !!previewUrl.value,
  }),
)
/** A Markdown file can show rendered or as source. Over the size limit it shows neither. */
const markdown = computed(
  () =>
    preview.value.kind === 'text' &&
    preview.value.language === 'markdown' &&
    file.value.size.value <= TEXT_PREVIEW_LIMIT,
)
// A phone header has room for the file name only when the toggle shows icons.
const narrow = useMediaQuery('(max-width: 767px)')
const markdownViews = computed(() => [
  { label: 'Preview', value: 'preview', icon: narrow.value ? 'lucide-eye' : undefined },
  { label: 'Source', value: 'source', icon: narrow.value ? 'lucide-code' : undefined },
])
/** Every Markdown file opens rendered. The viewer switches to Source with the toggle. */
const markdownView = ref<'preview' | 'source'>('preview')
watch(
  () => props.session.nodeId,
  () => (markdownView.value = 'preview'),
)
function chooseMarkdownView(value: string | number) {
  markdownView.value = value === 'preview' ? 'preview' : 'source'
}
/** The file fills the screen, without the header. A browser without the Fullscreen API offers no button. */
const stage = useTemplateRef<HTMLElement>('stage')
const canFullscreen = computed(
  () =>
    !!document.fullscreenEnabled && !empty.value && !['none', 'audio'].includes(preview.value.kind),
)
function enterFullscreen() {
  // The browser may refuse, such as in a frame without permission; the page stays as it is.
  void stage.value?.requestFullscreen().catch(() => {})
}
/** Image types every browser draws. Others, such as HEIC or TIFF, show the server's preview. */
const WEB_IMAGES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/bmp',
])
const source = computed(() =>
  WEB_IMAGES.has(mime.value) || !previewUrl.value ? contentUrl.value : previewUrl.value,
)

const keptImages = useTweak('t27-preview-preload')
const loadingStates = useTweak('t27-image-loading')
const pagerSpace = useTweak('t27-pager-space')
/** Larger pictures are not loaded before they are asked for. */
const PRELOAD_LIMIT = 20 * 1024 * 1024
// The pictures either side of this file load while it shows, so a step shows them at once.
watch(
  [keptImages, files, source, preview],
  () => {
    if (!keptImages.value) return
    const own = files.value.findIndex((row) => row.name === props.session.nodeId)
    const beside = own === -1 ? [] : [files.value[own - 1], files.value[own + 1]]
    const neighbours = beside
      .filter((row) => !!row && WEB_IMAGES.has(row.mime ?? '') && row.size <= PRELOAD_LIMIT)
      .map((row) => nodeContentUrl(row!.name))
    keepImages(preview.value.kind === 'image' ? [source.value, ...neighbours] : neighbours)
  },
  { immediate: true },
)
const videoFailed = ref(false)
watch(contentUrl, () => (videoFailed.value = false))
/** While the folder loads, the pager keeps its room, so the header does not shift when it comes. */
const pagerLoading = computed(
  () => pagerSpace.value && !!folder.value && siblings.status === 'pending',
)
</script>

<template>
  <div class="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-base">
    <DocumentHeader
      ref="header"
      :session="session"
      title-label="File name"
      :mime="file.mime"
      :location="location"
    >
      <template #status>
        <UploadNewVersion
          v-if="canReplace && parent"
          ref="upload"
          :node="session.nodeId"
          :parent="parent"
          :title="session.title.value"
          @replaced="replaced"
        />
      </template>
      <template #actions>
        <!-- A click does not move focus to the toggle, so the arrow keys still step through files. Tab reaches it. -->
        <TabButtons
          v-if="markdown"
          :model-value="markdownView"
          :options="markdownViews"
          aria-label="Markdown view"
          class="mr-1"
          @mousedown.prevent
          @update:model-value="chooseMarkdownView"
        />
        <template v-if="files.length > 1 && position !== -1">
          <Button
            variant="ghost"
            icon="lucide-chevron-left"
            tooltip="Previous file"
            aria-label="Previous file"
            :disabled="!previous"
            @click="show(previous)"
          />
          <span class="text-sm tabular-nums text-ink-gray-5 max-md:hidden"
            >{{ position + 1 }} of {{ files.length }}</span
          >
          <Button
            variant="ghost"
            icon="lucide-chevron-right"
            tooltip="Next file"
            aria-label="Next file"
            :disabled="!next"
            @click="show(next)"
          />
        </template>
        <div v-else-if="pagerLoading" class="invisible flex items-center gap-1" aria-hidden="true">
          <Button variant="ghost" icon="lucide-chevron-left" disabled />
          <span class="text-sm tabular-nums max-md:hidden">{{ __('{0} of {1}', [1, 2]) }}</span>
          <Button variant="ghost" icon="lucide-chevron-right" disabled />
        </div>
        <!-- A CSV has a text preview, so the "No preview" page never offers this. -->
        <Button
          v-if="opensAsSheet && preview.kind === 'text' && !empty"
          :label="__('Open as spreadsheet')"
          icon-left="lucide-sheet"
          :loading="openingAsSheet"
          @click="openAsSheet"
        />
        <Button
          v-if="!empty"
          variant="ghost"
          icon="lucide-download"
          tooltip="Download"
          aria-label="Download"
          :href="downloadUrl"
        />
        <Button
          v-if="canFullscreen"
          variant="ghost"
          icon="lucide-maximize"
          :tooltip="__('Fullscreen')"
          :aria-label="__('Fullscreen')"
          @click="enterFullscreen"
        />
      </template>
      <template #menu>
        <Dropdown :options="menu" align="end">
          <Button
            variant="ghost"
            icon="lucide-ellipsis"
            tooltip="More file actions"
            aria-label="More file actions"
          />
        </Dropdown>
      </template>
    </DocumentHeader>
    <div ref="stage" class="flex min-h-0 flex-1 flex-col bg-surface-base">
      <TextPreview
        v-if="preview.kind === 'text'"
        :src="contentUrl"
        :download="downloadUrl"
        :size="file.size.value"
        :language="preview.language"
        :title="session.title.value"
        :rendered="markdown && markdownView === 'preview'"
      />
      <PreviewFallback v-else-if="empty" title="Empty file" message="This file has no content." />
      <PreviewImage
        v-else-if="preview.kind === 'image' && (keptImages || loadingStates)"
        :src="source"
        :alt="session.title.value"
        :download="downloadUrl"
        :kept="keptImages"
        :states="loadingStates"
      />
      <img
        v-else-if="preview.kind === 'image'"
        :src="source"
        :alt="session.title.value"
        class="m-auto max-h-full min-h-0 max-w-full object-contain p-4"
      />
      <PreviewFallback
        v-else-if="preview.kind === 'video' && videoFailed"
        :title="__('Could not load the preview')"
        :message="__('Download this file to open it.')"
        :download="downloadUrl"
      />
      <audio
        v-else-if="preview.kind === 'audio'"
        :src="contentUrl"
        controls
        class="m-auto w-full max-w-xl"
      />
      <video
        v-else-if="preview.kind === 'video'"
        :src="contentUrl"
        controls
        class="m-auto max-h-full min-h-0 max-w-full"
        @error="videoFailed = loadingStates"
      />
      <PdfPreview
        v-else-if="preview.kind === 'pdf'"
        :src="contentUrl"
        :download="downloadUrl"
        :title="session.title.value"
      />
      <PreviewFallback
        v-else-if="opensAsSheet"
        :title="__('No preview')"
        :message="
          __('Open this file as a spreadsheet to view and edit it. The file stays as it is.')
        "
        :download="downloadUrl"
      >
        <Button
          variant="solid"
          :label="__('Open as spreadsheet')"
          icon-left="lucide-sheet"
          :loading="openingAsSheet"
          @click="openAsSheet"
        />
      </PreviewFallback>
      <PreviewFallback
        v-else
        title="No preview"
        message="Download this file to open it."
        :download="downloadUrl"
      />
    </div>
  </div>
</template>
