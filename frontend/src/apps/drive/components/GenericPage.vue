<template>
  <Navbar v-if="!verify?.error && !getEntities.error" :root-resource="verify" :breadcrumbs="pageBreadcrumbs"
    :entities="activeEntity ? [activeEntity] : selectedEntitities" />

  <ErrorPage v-if="verify?.error || getEntities.error" :error="verify?.error || getEntities.error" />

  <div v-else id="drop-area" ref="container" class="flex min-h-full flex-col bg-surface-base"
    @dragover="onDragOverScroll" @drop="stopAutoScroll" @dragend="stopAutoScroll">
    <DriveToolBar v-model:sort-order="sortOrder" v-model:search="search" v-model:filters="filters"
      :selection-mode="selectionMode" :action-items="actionItems" :selections="selectedEntitities"
      :selectable-count="selectableNames.length" :all-selected="allVisibleSelected"
      :get-entities="getEntities || { data: [] }" @select-all="toggleSelectAll" />

    <DriveListSkeleton v-if="!props.getEntities.data" />
    <NoFilesSection v-else-if="!props.getEntities.data?.length" v-bind="empty" />
    <ListView v-else-if="view === 'list'" ref="viewEl" v-model="selections" v-model:sort-order="sortOrder"
      :folder-contents="rows && grouper(rows)"
      :action-items="actionItems" :root-entity="verify?.data" :loading-more="loadingMore" @dropped="onDrop" />
    <GridView v-else ref="viewEl" v-model="selections" :selection-mode="selectionMode"
      :folder-contents="rows" :action-items="actionItems"
      :loading-more="loadingMore" @dropped="onDrop" />
  </div>
  <p class="hidden absolute text-center top-1/2 left-[calc(50%-4rem)] w-32 z-10 font-bold">
    Drop to upload
  </p>
  <Transition v-if="uploads.length > 0"
    enter-active-class="transition duration-[150ms] ease-[cubic-bezier(.21,1.02,.73,1)]"
    enter-from-class="translate-y-1 opacity-0" enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-[150ms] ease-[cubic-bezier(.21,1.02,.73,1)]"
    leave-from-class="translate-y-0 opacity-100" leave-to-class="translate-y-1 opacity-0">
    <UploadTracker />
  </Transition>
  <ListDialogs v-model="listDialog" :list="props.getEntities" :parent="route.params.entityName"
    :entities="activeEntity ? [activeEntity] : selectedEntitities" />
</template>
<script setup>
import ListView from '@/apps/drive/components/ListView.vue'
import GridView from '@/apps/drive/components/GridView.vue'
import DriveToolBar from '@/apps/drive/components/DriveToolBar.vue'
import Navbar from '@/apps/drive/components/Navbar.vue'
import NoFilesSection from '@/apps/drive/components/NoFilesSection.vue'
import UploadTracker from '@/apps/drive/components/UploadTracker.vue'
import ListDialogs from '@/apps/drive/components/ListDialogs.vue'
import ErrorPage from '@/apps/drive/components/ErrorPage.vue'
import {
  pasteObj,
  openEntity,
  prettyData,
  sortEntities,
  isVirtual,
  isManaged,
  isAttachmentRef,
} from '@/apps/drive/utils/files'
import { toggleFav, clearRecent, PAGE_SIZE } from '@/apps/drive/resources/files'
import { confirmRestore, confirmRemove, confirmDeleteForever } from '@/apps/drive/utils/confirmActions'
import { entitiesDownload } from '@/apps/drive/utils/download'
import { ref, computed, watch, watchEffect, provide, inject, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { onKeyDown, useEventListener, useInfiniteScroll } from '@vueuse/core'
import { request, useScrollContainer } from 'frappe-ui'
import { useSessionStore, useCurrentUser } from '@/boot/session'
import { activeEntity, startRename } from '@/apps/drive/data/selection'
import { uploads } from '@/apps/drive/data/uploads'
const { systemUser } = useCurrentUser()
import { pageBreadcrumbs } from '@/apps/drive/data/breadcrumbs'
import { view, getSortOrder, setSortOrder } from '@/apps/drive/data/prefs'
import { setCurrentFolder } from '@/apps/drive/data/currentFolder'
import {
  expandedFolders,
  loadedChildRows,
  refreshExpanded,
  refreshFolder,
  removeFromTree,
  resetTree,
} from '@/apps/drive/data/folderTree'
import { toast } from '@/apps/drive/utils/toasts'
import { move } from '@/apps/drive/resources/files'
import DriveListSkeleton from '@/apps/drive/components/DriveListSkeleton.vue'
import { settings } from '@/apps/drive/resources/permissions'
import emitter from '@/apps/drive/emitter'
import { getFileLink } from '@/apps/drive/ui/drive/js/utils'

import LucideClock from '~icons/lucide/clock'
import LucideDownload from '~icons/lucide/download'
import LucideExternalLink from '~icons/lucide/external-link'
import LucideEye from '~icons/lucide/eye'
import LucideInfo from '~icons/lucide/info'
import LucideLink2 from '~icons/lucide/link-2'
import LucideArrowLeftRight from '~icons/lucide/arrow-left-right'
import LucideRotateCcw from '~icons/lucide/rotate-ccw'
import LucideShare2 from '~icons/lucide/share-2'
import LucideSquarePen from '~icons/lucide/square-pen'
import LucideCornerLeftUp from '~icons/lucide/corner-left-up'
import LucideMonitorCog from '~icons/lucide/monitor-cog'
import LucideStar from '~icons/lucide/star'
import LucideTrash from '~icons/lucide/trash'

const props = defineProps({
  grouper: { type: Function, default: (d) => d },
  showSort: { type: Boolean, default: true },
  verify: { type: Object, default: null },
  empty: Object,
  getEntities: Object,
})
const route = useRoute()
const { el: scrollHost } = useScrollContainer()

const listDialog = ref('')
provide('listDialog', listDialog)
provide('dialog', listDialog)

const sortId = computed(() => route.params.entityName || route.name)
const inIframe = inject('inIframe', false)
const DEFAULT_SORT = inIframe
  ? {
    label: 'Name',
    field: 'name',
    ascending: true,
  }
  : {
    label: 'Modified',
    field: 'modified',
    ascending: false,
  }
const sortOrder = ref(getSortOrder(sortId.value) || DEFAULT_SORT)
const search = ref('')
const filters = ref([])

const rows = computed(() => {
  let out = props.getEntities.data ?? []
  out = sortEntities([...out], sortOrder.value)
  if (filters.value.length) {
    const file_types = filters.value.map((k) => k.name)
    const isFolder = file_types.includes('Folder')
    out = out.filter(
      ({ file_type, is_folder }) =>
        file_types.includes(file_type) || (isFolder && is_folder)
    )
  }
  return out
})

watch(
  sortId,
  (id) => {
    resetTree()
    const saved = getSortOrder(id)
    if (saved) sortOrder.value = saved
  },
  { immediate: true }
)

watch(
  sortOrder,
  (order) => {
    if (sortId.value) setSortOrder(sortId.value, order)
    refreshData()
  },
  { deep: true }
)
watch(search, () => refreshData())

watch(
  rows,
  (val) => {
    setCurrentFolder({
      entities: val.filter?.((k) => k.file_name?.[0] !== '.'),
    })
  },
  { immediate: true, deep: true }
)

const selections = ref(new Set())
const selectionMode = computed(() => selections.value.size > 0)
const viewEl = ref(null)
const allRows = computed(() => [
  ...(props.getEntities.data ?? []),
  ...loadedChildRows.value,
])
const selectedEntitities = computed(() =>
  allRows.value.filter(({ name }) => selections.value.has(name))
)
watch(allRows, (entities) => {
  const names = new Set(entities.map(({ name }) => name))
  if ([...selections.value].some((name) => !names.has(name))) {
    selections.value = new Set(
      [...selections.value].filter((name) => names.has(name))
    )
  }
})
const selectableNames = computed(
  () => viewEl.value?.visibleNames ?? rows.value.map(({ name }) => name)
)
const allVisibleSelected = computed(
  () => selectableNames.value.length > 0 && selectableNames.value.every((name) => selections.value.has(name))
)

function toggleSelectAll() {
  const next = new Set(selections.value)
  if (allVisibleSelected.value) selectableNames.value.forEach((name) => next.delete(name))
  else selectableNames.value.forEach((name) => next.add(name))
  selections.value = next
}

function clearSelection() {
  selections.value = new Set()
}

// Shared by both views, as selections is Drive's own Set-based model.
const isTyping = (e) =>
  e.target.classList.contains('ProseMirror') ||
  e.target.tagName === 'INPUT' ||
  e.target.tagName === 'TEXTAREA'

onKeyDown('a', (e) => {
  if (isTyping(e)) return
  if (e.metaKey || e.ctrlKey) {
    toggleSelectAll()
    e.preventDefault()
  }
})
onKeyDown('Backspace', (e) => {
  if (isTyping(e)) return
  if (e.metaKey) emitter.emit('remove')
})
onKeyDown('m', (e) => {
  if (isTyping(e)) return
  if (e.ctrlKey) emitter.emit('move')
})
onKeyDown('Escape', (e) => {
  if (isTyping(e)) return
  // Let an open dialog handle its own Escape.
  if (document.querySelector('.dialog-content[data-state="open"]')) return
  clearSelection()
  e.preventDefault()
})

const verifyAccess = computed(() => props.verify?.data || !props.verify)
watchEffect(() => {
  if (verifyAccess.value?.write) useEventListener('paste', pasteObj)
})

const pageStart = ref(0)
const hasNextPage = ref(false)
const loadingMore = ref(false)

const queryParams = () => {
  const params = {}
  if (sortOrder.value) {
    params.order_by = sortOrder.value.field
    params.ascending = sortOrder.value.ascending
  }
  params.search = search.value || ''
  return params
}

const refreshData = () => {
  const res = props.getEntities
  const params = queryParams()
  pageStart.value = 0
  hasNextPage.value = false
  if (res.paginated) {
    params.start = 0
    params.limit = PAGE_SIZE
  }
  res.fetch(
    { ...res.params, ...params },
    res.paginated
      ? {
          onSuccess: (data) => {
            hasNextPage.value = (data?.length || 0) >= PAGE_SIZE
          },
        }
      : {}
  )
}

async function loadMore() {
  const res = props.getEntities
  if (!res?.paginated || res.loading || loadingMore.value || !hasNextPage.value)
    return
  loadingMore.value = true
  const next = pageStart.value + PAGE_SIZE
  try {
    const path = res.url.startsWith('/') ? res.url : `/api/method/${res.url}`
    const resp = await request({
      url: path,
      method: 'GET',
      params: {
        ...res.params,
        ...queryParams(),
        start: next,
        limit: PAGE_SIZE,
      },
      credentials: 'include',
    })
    // request() is a raw fetch that skips the resource's transform, so the page
    // rows arrive unformatted — run prettyData before appending.
    const page = prettyData(Array.isArray(resp) ? resp : resp?.message ?? [])
    pageStart.value = next
    hasNextPage.value = page.length >= PAGE_SIZE
    if (page.length) res.setData([...(res.data || []), ...page])
  } catch {
    hasNextPage.value = false
  } finally {
    loadingMore.value = false
  }
}

useInfiniteScroll(scrollHost, () => loadMore(), {
  distance: 200,
  canLoadMore: () =>
    !!props.getEntities?.paginated &&
    hasNextPage.value &&
    !loadingMore.value &&
    !props.getEntities.loading,
})

watch(
  [verifyAccess, () => props.getEntities],
  ([data]) => {
    if (!data) return
    refreshData()
  },
  { immediate: true, deep: false }
)
emitter.on('refresh', refreshData)

// Removes entities from the currently rendered list once a confirm-dialog
// write (remove/restore/delete forever) succeeds server-side. Provided so
// Navbar can update the list from its own remove/restore triggers.
function removeFromList(entities) {
  const names = entities.map((e) => e.name)
  props.getEntities.setData(
    props.getEntities.data.filter(({ name }) => !names.includes(name))
  )
  removeFromTree(names)
}
provide('removeFromList', removeFromList)

emitter.on('remove-file', (item) => {
  const names = Array.isArray(item) ? item : [item]
  const entities = allRows.value.filter((e) => names.includes(e.name))
  if (!entities.length) return
  confirmRemove(entities, { onSuccess: () => removeFromList(entities) })
})

if (!settings.fetched && useSessionStore().isLoggedIn) settings.fetch()

// Drag and drop
const removeFile = (file, target) => {
  const removedIndex = props.getEntities.data.findIndex((k) => k.name === file)
  if (removedIndex !== -1) props.getEntities.data.splice(removedIndex, 1)
  else removeFromTree([file])
  const targetRow = allRows.value.find((k) => k.name === target)
  if (targetRow) targetRow.child_count = (targetRow.child_count || 0) + 1
  props.getEntities.setData(props.getEntities.data)
}
const onDrop = (targetFile, draggedItem) => {
  if (!targetFile.is_folder || !draggedItem) return
  // If the dragged item is part of the current selection, move the whole
  // selection; otherwise just move the dragged item.
  const names = selections.value.has(draggedItem)
    ? [...selections.value]
    : [draggedItem]
  const toMove = names.filter((name) => name !== targetFile.name)
  if (!toMove.length) return
  move.submit(
    { entity_names: toMove, new_parent: targetFile.name },
    {
      // The rows were removed optimistically — put them back if the server said no.
      onError: () => {
        refreshData()
        refreshExpanded(sortOrder.value)
      },
    }
  )
  toMove.forEach((name) => removeFile(name, targetFile.name))
  if (expandedFolders.value.has(targetFile.name))
    refreshFolder(targetFile.name, sortOrder.value)
  selections.value = new Set()
}
emitter.on('remove-file-ui', removeFile)

// Auto-scroll the file area while dragging near its top/bottom edge, so files
// can be dropped into folders that aren't currently in view.
let scrollRAF = null
let scrollTarget = null
let scrollSpeed = 0
function autoScrollTick() {
  if (!scrollTarget || !scrollSpeed) return stopAutoScroll()
  scrollTarget.scrollTop += scrollSpeed
  scrollRAF = requestAnimationFrame(autoScrollTick)
}
function stopAutoScroll() {
  if (scrollRAF) cancelAnimationFrame(scrollRAF)
  scrollRAF = null
  scrollTarget = null
  scrollSpeed = 0
}
function onDragOverScroll(e) {
  const target = scrollHost.value
  if (!target) return stopAutoScroll()
  const rect = target.getBoundingClientRect()
  const edge = 60
  const maxSpeed = 18
  let speed = 0
  if (e.clientY < rect.top + edge)
    speed = -maxSpeed * Math.min(1, (rect.top + edge - e.clientY) / edge)
  else if (e.clientY > rect.bottom - edge)
    speed = maxSpeed * Math.min(1, (e.clientY - (rect.bottom - edge)) / edge)
  scrollSpeed = speed
  scrollTarget = target
  if (speed && !scrollRAF) autoScrollTick()
  else if (!speed) stopAutoScroll()
}
onBeforeUnmount(stopAutoScroll)

// Action Items
const actionItems = computed(() => {
  if (route.name === 'drive-Trash') {
    return [
      {
        label: 'Restore',
        icon: LucideRotateCcw,
        action: (entities) => confirmRestore(entities, { onSuccess: () => removeFromList(entities) }),
        multi: true,
        important: true,
      },
      {
        label: 'Delete forever',
        icon: LucideTrash,
        action: (entities) => confirmDeleteForever(entities, { onSuccess: () => removeFromList(entities) }),
        isEnabled: () => route.name === 'drive-Trash',
        multi: true,
        danger: true,
      },
    ].filter((a) => !a.isEnabled || a.isEnabled())
  } else {
    return [
      {
        label: __('Preview'),
        icon: LucideEye,
        action: ([entity]) => openEntity(entity),
        isEnabled: (e) => e.file_type !== 'Link' && !isVirtual(e),
      },
      {
        label: __('Open'),
        icon: LucideExternalLink,
        action: ([entity]) => openEntity(entity),
        isEnabled: (e) => e.file_type === 'Link',
      },
      {
        label: __('Show Info'),
        icon: LucideInfo,
        action: () => (listDialog.value = 'i'),
        isEnabled: (e) => !isVirtual(e),
      },
      {
        label: __('Copy Link'),
        icon: LucideLink2,
        action: ([entity]) => getFileLink(entity),
        important: true,
      },
      {
        label: __('Download'),
        icon: LucideDownload,
        // Downloading is read-only, so it is safe for every real file regardless
        // of kind (parity with the file-preview navbar). Only virtual grouping
        // nodes and non-downloadable types are excluded.
        isEnabled: (e) =>
          !isVirtual(e) &&
          !['Link', 'Presentation', 'Document'].includes(e.file_type),
        action: (entities) => entitiesDownload(entities),
        multi: true,
        important: true,
      },
      {
        divider: true,
        isEnabled: (e) => isAttachmentRef(e) || systemUser.value,
      },
      {
        label: __('Go to original'),
        icon: LucideCornerLeftUp,
        action: ([entity]) => {
          window.open(
            '/api/method/suite.drive.api.files.redirect_to_original?file_id=' +
            entity.name,
            '_blank'
          )
        },
        isEnabled: (e) => isAttachmentRef(e),
      },
      {
        label: __('Open in Desk'),
        icon: LucideMonitorCog,
        action: ([entity]) =>
          window.open('/desk/file/' + entity.name, '_blank'),
        isEnabled: () => systemUser.value,
      },
      { divider: true, isEnabled: (e) => !e.external && !isVirtual(e) },
      {
        label: __('Share'),
        icon: LucideShare2,
        action: () => (listDialog.value = 's'),
        isEnabled: (e) => e.share && isManaged(e),
        important: true,
      },
      {
        label: __('Rename'),
        icon: LucideSquarePen,
        action: ([entity]) => startRename(entity.name),
        isEnabled: (e) => isManaged(e) && e.write,
      },
      {
        label: __('Move'),
        icon: LucideArrowLeftRight,
        action: () => (listDialog.value = 'm'),
        isEnabled: (e) => isManaged(e) && e.write,
        multi: true,
        important: true,
      },
      {
        label: __('Favourite'),
        icon: LucideStar,
        action: (entities) => {
          entities.forEach((e) => (e.is_favourite = true))
          // Hack to cache
          props.getEntities.setData(props.getEntities.data)
          toggleFav.submit({ entities })
        },
        isEnabled: (e) => !e.is_favourite && !e.external && !isVirtual(e),
        important: true,
        multi: true,
      },
      {
        label: __('Unfavourite'),
        icon: LucideStar,
        class: 'text-ink-amber-6 stroke-current fill-current',
        action: (entities) => {
          entities.forEach((e) => (e.is_favourite = false))
          props.getEntities.setData(props.getEntities.data)
          toggleFav.submit({ entities })
        },
        isEnabled: (e) => e.is_favourite && !e.external && !isVirtual(e),
        important: true,
        multi: true,
      },
      {
        label: __('Remove from Recents'),
        icon: LucideClock,
        action: (entities) => {
          clearRecent.submit({
            entities,
          })
        },
        isEnabled: () => route.name == 'drive-Recents',
        important: true,
        multi: true,
      },
      { divider: true, isEnabled: (e) => e.write },
      {
        label: __('Delete'),
        icon: LucideTrash,
        action: (entities) => confirmRemove(entities, { onSuccess: () => removeFromList(entities) }),
        isEnabled: (e) => e.write,
        important: true,
        multi: true,
        theme: 'red',
      },
    ]
  }
})

async function newLink() {
  if (!document.hasFocus()) return
  try {
    const text = await navigator.clipboard.readText()
    if (localStorage.getItem('prevClip') === text) return
    localStorage.setItem('prevClip', text)
    const url = new URL(text)
    if (url.host)
      toast('Link detected', {
        description: text,
        action: {
          label: 'Add',
          onClick: () => {
            listDialog.value = 'l'
          },
        },
      })
  } catch { }
}

// JS doesn't allow direct reading of clipboard
if (settings.data?.auto_detect_links) {
  newLink()
  window.addEventListener('focus', newLink)
  window.addEventListener('copy', newLink)
}

const socket = inject('socket')
socket.on('list-add', ({ file }) => {
  if (
    file.folder === props.getEntities.params.entity_name &&
    !props.getEntities.data.find((k) => k.name === file.name)
  ) {
    props.getEntities.data.push(...prettyData([file]))
    props.getEntities.setData(props.getEntities.data)
  }
})
socket.on('list-update', ({ file }) => {
  if (file.folder !== props.getEntities.params.entity_name) return
  const index = props.getEntities.data.findIndex((k) => k.name == file.name)
  if (index !== -1)
    props.getEntities.data.splice(index, 1, ...prettyData([file]))
  props.getEntities.setData(props.getEntities.data)
})
socket.on('list-remove', ({ parent, entity_name }) => {
  if (parent !== props.getEntities.params.entity_name) return
  const index = props.getEntities.data.findIndex((k) => k.name == entity_name)
  if (index !== -1) props.getEntities.data.splice(index, 1)
  props.getEntities.setData(props.getEntities.data)
})
socket.on('client-rename', ({ entity_name, title }) => {
  const file = props.getEntities.data.find((k) => k.name === entity_name)
  file.file_name = title
})
</script>
<style>
.file-drag #drop-area {
  opacity: 0.5;
  padding-left: 0;
  padding-right: 0;
}

.file-drag #drop-area+p {
  display: block;
}
</style>
