<template>
  <div class="min-w-0 text-ink-gray-8">
    <PageHeader class="hidden md:flex">
      <div class="flex w-full items-center justify-between gap-3">
        <Breadcrumbs :items="breadcrumbs" />
        <Dropdown v-if="canCreate" :options="newOptions" align="end">
          <Button variant="solid" theme="gray" icon-left="lucide-plus" label="New" />
        </Dropdown>
      </div>
    </PageHeader>
    <PageHeaderMobile class="md:hidden">
      <template #prefix>
        <PageHeaderBackButton v-if="folderParent" :route="folderParent" />
      </template>
      <Button
        variant="ghost"
        :label="destinationLabel"
        icon-right="lucide-chevron-down"
        class="min-w-0 text-lg font-medium"
        @click="requestPanel"
      />
      <template #suffix>
        <Dropdown v-if="canCreate" :options="newOptions" align="end">
          <Button icon="lucide-plus" aria-label="New" />
        </Dropdown>
      </template>
    </PageHeaderMobile>

    <div class="mx-auto w-full max-w-[1120px] px-3 pb-28 pt-4 sm:px-5">
      <div class="flex h-9 items-center justify-between gap-2">
        <template v-if="selectionMode">
          <div class="flex min-w-0 items-center gap-2">
            <template v-if="props.destination === 'trash'">
              <Button label="Restore" icon-left="lucide-undo-2" disabled tooltip="Restore is coming in ticket 007" />
              <Button label="Delete forever" icon-left="lucide-trash-2" disabled tooltip="Permanent deletion is coming in ticket 007" />
            </template>
            <template v-else>
              <Button label="Move" icon-left="lucide-folder-input" :disabled="!canBulkEdit" @click="beginBulkMove" />
              <Button label="Move to trash" icon-left="lucide-trash-2" :disabled="!canBulkEdit" @click="runBulkTrash" />
            </template>
            <span class="truncate pl-1 text-base text-ink-gray-7">{{ selection.length }} selected</span>
          </div>
          <Button variant="solid" theme="gray" label="Done" @click="clearSelected" />
        </template>
        <template v-else>
          <TextInput
            v-model="searchText"
            type="search"
            :debounce="250"
            placeholder="Search files"
            aria-label="Search files"
            class="w-full max-w-72"
            @update:model-value="updateSearch"
          >
            <template #prefix><span class="lucide-search size-4" aria-hidden="true" /></template>
          </TextInput>
          <div class="flex items-center gap-2">
            <Dropdown :options="viewSettings" align="end">
              <Button icon="lucide-settings-2" aria-label="View settings" />
            </Dropdown>
            <Dropdown :options="moreOptions" align="end">
              <Button icon="lucide-ellipsis" aria-label="More file actions" />
            </Dropdown>
          </div>
        </template>
      </div>

      <TabButtons
        v-if="props.destination === 'trash' && discovered.data?.organization"
        class="mt-3 max-w-96"
        :model-value="route.query.root === 'organization' ? 'organization' : 'personal'"
        :options="[{ value: 'personal', label: 'My files' }, { value: 'organization', label: 'Organization files' }]"
        @update:model-value="switchTrashRoot"
      />

      <BatchOutcome :result="batchOutcome" :verb="batchVerb" class="mt-3" @dismiss="batchOutcome = null" />
      <ContextMenu :options="activeNode ? rowMenuOptions(activeNode) : []">
        <FilesListing
          :query="listing"
          :presentation="presentation"
          :selection="selection"
          :selection-mode="selectionMode"
          :empty-title="emptyTitle"
          :empty-description="emptyDescription"
          :show-breadcrumbs="isSearching"
          :menu-options="rowMenuOptions"
          @update:selection="selection = $event"
          @sort="changeSort"
          @open="openNode"
          @select="selectNode"
          @menu="activeNode = $event"
          @preview-error="refreshPreviews"
        />
      </ContextMenu>
    </div>

    <RenameDialog v-model:open="renameOpen" :node="activeNode" @renamed="replaceSlug" />
    <FolderPicker v-model:open="pickerOpen" :mode="pickerMode" @choose="applyPicker" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Breadcrumbs, Button, ContextMenu, Dropdown, PageHeader, PageHeaderBackButton, PageHeaderMobile, TabButtons, TextInput } from 'frappe-ui'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import {
  batchNodes,
  children as nodesChildren,
  copyNode,
  createNode,
  moveNode,
  node,
  starNode,
  trashNode,
  unstarNode,
  visitNode,
} from '@/apps/drive/client/nodes'
import { archiveDownloadUrl, startArchive } from '@/apps/drive/client/archives'
import { observeDriveChanges } from '@/apps/drive/client/realtime'
import { roots } from '@/apps/drive/client/roots'
import { DRIVE_ROLES, hasRole, type DriveBatchResult, type DriveNode } from '@/apps/drive/client/types'
import { view } from '@/apps/drive/client/views'
import { confirm, prompt, toast } from '@/platform/feedback'
import { useMutation, useQuery } from '@/platform/server-state'
import BatchOutcome from '../features/BatchOutcome.vue'
import FilesListing from '../features/FilesListing.vue'
import FolderPicker from '../features/FolderPicker.vue'
import RenameDialog from '../features/RenameDialog.vue'
import { observePreviewRefresh } from '../features/previewRefresh'
import {
  clearSelection,
  toggleSelection,
  type SelectionState,
} from '../features/selection'
import {
  readPresentationPreference,
  replacePresentation,
  resolvePresentation,
  writePresentationPreference,
  type FilesSort,
} from '../features/presentation'
import { slugify } from '../internal/slugify'

type Destination = 'personal' | 'organization' | 'folder' | 'shared' | 'recent' | 'starred' | 'trash'

const props = defineProps<{ destination: Destination }>()
const route = useRoute()
const router = useRouter()
const discovered = useQuery(roots())
const presentationVersion = ref(0)
const selectionState = ref<SelectionState>(clearSelection())
const searchText = ref(String(route.query.q ?? ''))
const activeNode = ref<DriveNode | null>(null)
const renameOpen = ref(false)
const pickerOpen = ref(false)
const pickerMode = ref<'move' | 'copy'>('move')
const pickerBulk = ref(false)
const batchOutcome = ref<DriveBatchResult | null>(null)
const batchVerb = ref('moved')
let stopRealtime: (() => void) | null = null
let stopPreviews: (() => void) | null = null
let visitedFolder = ''

const presentation = computed(() => {
  void presentationVersion.value
  const resolved = resolvePresentation(route.query, readPresentationPreference())
  if (isSearching.value || !concreteDestination.value) {
    return { ...resolved, sort: 'modified' as const, dir: 'desc' as const, group: 'none' as const }
  }
  return resolved
})
const selection = computed({
  get: () => selectionState.value.selected,
  set: (selected: string[]) => { selectionState.value = { selected, anchor: selected.at(-1) ?? null } },
})
const selectionMode = computed(() => selection.value.length > 0)
const isSearching = computed(() => !!String(route.query.q ?? '').trim())
const concreteDestination = computed(() => ['personal', 'organization', 'folder'].includes(props.destination))
const rootLocation = computed(() => {
  if (props.destination === 'organization') return discovered.data?.organization ?? null
  return discovered.data?.personal ?? null
})
const parentId = computed(() => props.destination === 'folder' ? String(route.params.node ?? '') : rootLocation.value?.node ?? '')
const detail = useQuery(() => parentId.value && concreteDestination.value
  ? node(parentId.value, 'access,breadcrumbs')
  : false)
const destinationLabel = computed(() => {
  if (props.destination === 'folder') return detail.data?.title ?? 'Folder'
  return ({
    personal: 'My files', organization: 'Organization files', shared: 'Shared with me',
    recent: 'Recent', starred: 'Starred', trash: 'Trash', folder: 'Folder',
  } as Record<Destination, string>)[props.destination]
})
const breadcrumbs = computed(() => {
  if (props.destination !== 'folder') return [{ label: destinationLabel.value, route: route.path }]
  const items = detail.data?.breadcrumbs?.map((crumb) => ({
    label: crumb.title,
    route: { path: `/files/f/${encodeURIComponent(crumb.name)}/${slugify(crumb.title)}`, query: presentationQuery.value },
  })) ?? []
  return [...items, { label: detail.data?.title ?? 'Folder', route: route.fullPath }]
})
const folderParent = computed<RouteLocationRaw | null>(() => {
  const previous = breadcrumbs.value.at(-2)
  return previous?.route ?? null
})
const presentationQuery = computed(() => ({
  view: presentation.value.view,
  sort: presentation.value.sort,
  dir: presentation.value.dir,
  group: presentation.value.group === 'none' ? undefined : presentation.value.group,
}))
const expansion = computed(() => {
  const parts = ['access']
  if (isSearching.value) parts.push('breadcrumbs')
  if (presentation.value.view === 'grid') parts.push('preview')
  return parts.join(',')
})
const listing = useQuery(() => {
  if (isSearching.value) return view({ view: 'search', term: String(route.query.q), expand: expansion.value })
  if (concreteDestination.value) {
    if (!parentId.value) return false
    return nodesChildren({
      node: parentId.value,
      order_by: presentation.value.sort,
      ascending: presentation.value.dir === 'asc',
      group_by: presentation.value.group === 'none' ? undefined : presentation.value.group,
      expand: expansion.value,
    })
  }
  const name = props.destination === 'shared' ? 'shared'
    : props.destination === 'recent' ? 'recents'
      : props.destination === 'starred' ? 'favourites' : 'trash'
  const root = props.destination === 'trash'
    ? (route.query.root === 'organization' ? discovered.data?.organization?.node : discovered.data?.personal.node)
    : undefined
  if (props.destination === 'trash' && !root) return false
  return view({ view: name, root, expand: expansion.value })
})
const canCreate = computed(() => concreteDestination.value && !isSearching.value && hasRole(detail.data, DRIVE_ROLES.upload))
const selectedRows = computed(() => (listing.rows as DriveNode[]).filter((row) => selection.value.includes(row.name)))
const canBulkEdit = computed(() => !!selectedRows.value.length && selectedRows.value.every((row) => hasRole(row, DRIVE_ROLES.edit)))
const emptyTitle = computed(() => isSearching.value ? 'No files match this search' : `${destinationLabel.value} is empty`)
const emptyDescription = computed(() => canCreate.value ? 'Create a folder or document to get started.' : 'Files will appear here when available.')

const batchMutation = useMutation(batchNodes())
const moveMutation = useMutation(moveNode(), { silent: ['DriveConflict'] })
const copyMutation = useMutation(copyNode(), { silent: ['DriveConflict'] })
const trashMutation = useMutation(trashNode())
const starMutation = useMutation(starNode())
const unstarMutation = useMutation(unstarNode())
const createMutation = useMutation(createNode())
const visitMutation = useMutation(visitNode(), { silent: true })
const archiveMutation = useMutation(startArchive())

onMounted(() => {
  stopRealtime = observeDriveChanges()
  syncSavedViewQuery()
  if (presentation.value.view === 'grid') startPreviewObservation()
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('popstate', onMobileBack)
})
onBeforeUnmount(() => {
  stopRealtime?.()
  stopPreviews?.()
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('popstate', onMobileBack)
})

watch(() => presentation.value.view, (mode) => {
  if (mode === 'grid') startPreviewObservation()
  else { stopPreviews?.(); stopPreviews = null }
})
watch(() => route.fullPath, () => {
  searchText.value = String(route.query.q ?? '')
  clearSelected()
})
watch(() => detail.data, (folder) => {
  if (!folder || props.destination !== 'folder') return
  const expected = slugify(folder.title)
  if (String(route.params.slug ?? '') !== expected) {
    void router.replace({ path: `/files/f/${encodeURIComponent(folder.name)}${expected ? `/${expected}` : ''}`, query: route.query })
  }
  if (visitedFolder !== folder.name) {
    visitedFolder = folder.name
    void visitMutation.run({ node: folder.name })
  }
})

const viewSettings = computed(() => [
  { group: 'View', options: [
    { label: 'List', icon: 'lucide-list', selected: presentation.value.view === 'list', onClick: () => setPresentation({ view: 'list' }) },
    { label: 'Grid', icon: 'lucide-layout-grid', selected: presentation.value.view === 'grid', onClick: () => setPresentation({ view: 'grid' }) },
  ] },
  ...(concreteDestination.value && !isSearching.value ? [{ group: 'Group by', options: [
    { label: 'None', selected: presentation.value.group === 'none', onClick: () => setPresentation({ group: 'none' }) },
    { label: 'Type', selected: presentation.value.group === 'type', onClick: () => setPresentation({ group: 'type' }) },
    { label: 'Owner', selected: presentation.value.group === 'owner', onClick: () => setPresentation({ group: 'owner' }) },
    { label: 'Modified', selected: presentation.value.group === 'modified', onClick: () => setPresentation({ group: 'modified' }) },
  ] }] : []),
  ...(presentation.value.view === 'list' ? [{ group: 'Columns', options: ['owner', 'modified', 'kind', 'size'].map((column) => ({
    label: column === 'kind' ? 'Type' : column[0]!.toUpperCase() + column.slice(1),
    switch: true,
    switchValue: presentation.value.columns.includes(column),
    onClick: (visible: boolean) => setColumn(column, visible),
  })) }] : []),
])
const moreOptions = computed(() => [
  { label: 'Select rows', icon: 'lucide-square-check', onClick: selectFirst },
  { label: 'Select all loaded', icon: 'lucide-list-checks', disabled: !listing.rows.length, onClick: selectAll },
])
const newOptions = computed(() => [
  { label: 'Folder', icon: 'lucide-folder-plus', onClick: () => create('folder') },
  { label: 'Upload files', icon: 'lucide-upload', disabled: true, description: 'Available after ticket 007' },
  { label: 'Writer document', icon: 'lucide-file-text', onClick: () => create('document', 'Writer Document') },
  { label: 'Spreadsheet', icon: 'lucide-sheet', onClick: () => create('document', 'Spreadsheet') },
  { label: 'Presentation', icon: 'lucide-presentation', onClick: () => create('document', 'Presentation') },
  { label: 'Link', icon: 'lucide-link', onClick: () => create('link') },
])

function setPresentation(change: Partial<typeof presentation.value>) {
  clearSelected()
  void replacePresentation(router, presentation.value, change)
}
function setColumn(column: string, visible: boolean) {
  const columns = visible
    ? [...new Set([...presentation.value.columns, column])]
    : presentation.value.columns.filter((item) => item !== column)
  writePresentationPreference({ ...presentation.value, columns })
  presentationVersion.value += 1
}
function changeSort(column: FilesSort) {
  if (!concreteDestination.value || isSearching.value) return
  setPresentation({ sort: column, dir: presentation.value.sort === column && presentation.value.dir === 'asc' ? 'desc' : 'asc' })
}
function updateSearch(value: string | number) {
  const q = String(value).trim() || undefined
  void router.replace({ query: { ...route.query, q } })
}
function selectNode(row: DriveNode, range: boolean) {
  selectionState.value = toggleSelection(selectionState.value, row.name, (listing.rows as DriveNode[]).map((item) => item.name), range)
}
function selectFirst() {
  const row = (listing.rows as DriveNode[])[0]
  if (row) selectNode(row, false)
}
function selectAll() {
  const ids = (listing.rows as DriveNode[]).map((row) => row.name)
  selectionState.value = { selected: ids, anchor: ids.at(-1) ?? null }
}
function clearSelected() { selectionState.value = clearSelection() }
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selectionMode.value) clearSelected()
}
function onMobileBack() {
  if (selectionMode.value) clearSelected()
}
function requestPanel() {
  window.dispatchEvent(new CustomEvent('suite:open-active-area-panel', { detail: { area: 'files' } }))
}
function switchTrashRoot(value: string | number) {
  clearSelected()
  void router.replace({ query: { ...route.query, root: value === 'organization' ? 'organization' : undefined } })
}
function startPreviewObservation() {
  if (stopPreviews) return
  stopPreviews = observePreviewRefresh({ refresh: () => listing.refetch() })
}
function refreshPreviews() { void listing.refetch() }

async function openNode(row: DriveNode, newTab = false) {
  if (row.kind === 'link') {
    if (!row.url) return
    const origin = new URL(row.url, window.location.href).origin
    const allowed = await confirm({ title: 'Open external link?', message: `This link opens ${origin} in a new tab.`, confirmLabel: 'Open' })
    if (!allowed) return
    await visitMutation.run({ node: row.name })
    window.open(row.url, '_blank', 'noopener,noreferrer')
    return
  }
  const path = row.kind === 'folder'
    ? `/files/f/${encodeURIComponent(row.name)}${slugify(row.title) ? `/${slugify(row.title)}` : ''}`
    : `/d/${encodeURIComponent(row.name)}${slugify(row.title) ? `/${slugify(row.title)}` : ''}`
  const href = router.resolve({ path, query: row.kind === 'folder' ? presentationQuery.value : undefined }).href
  if (newTab) window.open(href, '_blank', 'noopener,noreferrer')
  else await router.push(href)
}

function rowMenuOptions(row: DriveNode) {
  const editable = hasRole(row, DRIVE_ROLES.edit)
  return [
    { label: 'Open', icon: 'lucide-arrow-up-right', onClick: () => openNode(row) },
    { label: 'Open in new tab', icon: 'lucide-external-link', onClick: () => openNode(row, true) },
    ...(row.kind !== 'link' ? [{ label: 'Download', icon: 'lucide-download', onClick: () => download(row) }] : []),
    ...(editable ? [
      { label: 'Rename', icon: 'lucide-pencil', onClick: () => beginRename(row) },
      { label: 'Move', icon: 'lucide-folder-input', onClick: () => beginPicker(row, 'move') },
    ] : []),
    { label: 'Make a copy', icon: 'lucide-copy', onClick: () => beginPicker(row, 'copy') },
    { label: row.favourite ? 'Unstar' : 'Star', icon: 'lucide-star', onClick: () => toggleStar(row) },
    ...(hasRole(row, DRIVE_ROLES.manage) ? [{ label: 'Share', icon: 'lucide-user-plus', onClick: unavailableShare }] : []),
    ...(editable ? [{ label: 'Move to trash', icon: 'lucide-trash-2', theme: 'red', onClick: () => trashMutation.run({ node: row.name, state: 'Trashed' }) }] : []),
    { label: 'Select', icon: 'lucide-square-check', onClick: () => selectNode(row, false) },
  ]
}
function beginRename(row: DriveNode) { activeNode.value = row; renameOpen.value = true }
function beginPicker(row: DriveNode, mode: 'move' | 'copy') {
  activeNode.value = row; pickerMode.value = mode; pickerBulk.value = false; pickerOpen.value = true
}
function beginBulkMove() { pickerMode.value = 'move'; pickerBulk.value = true; pickerOpen.value = true }
async function applyPicker(parent: string) {
  if (pickerBulk.value) {
    await runBatch({ parent }, 'moved')
    if (batchOutcome.value) pickerOpen.value = false
    return
  }
  if (!activeNode.value) return
  const result = pickerMode.value === 'move'
    ? await moveMutation.run({ node: activeNode.value.name, parent })
    : await copyMutation.run({ node: activeNode.value.name, parent })
  if (!result) {
    toast.error((pickerMode.value === 'move' ? moveMutation.error : copyMutation.error)?.message ?? 'The action failed.')
    return
  }
  pickerOpen.value = false
}
async function runBulkTrash() { await runBatch({ state: 'Trashed' }, 'moved to trash') }
async function runBatch(patch: { parent?: string; state?: 'Trashed' }, verb: string) {
  const result = await batchMutation.run({ nodes: [...selection.value], patch })
  if (!result) return
  batchOutcome.value = result
  batchVerb.value = verb
  selectionState.value = { selected: result.failed.map((failure) => failure.node), anchor: null }
}
async function toggleStar(row: DriveNode) {
  const starred = !row.favourite
  const result = starred
    ? await starMutation.run({ node: row.name })
    : await unstarMutation.run({ node: row.name })
  if (result) row.favourite = starred
}
async function unavailableShare() { toast.info('Sharing is unavailable until ticket 008.') }
async function download(row: DriveNode) {
  if (row.kind === 'folder') {
    const status = await archiveMutation.run({ node: row.name })
    if (status?.status === 'ready') window.location.assign(archiveDownloadUrl(row.name))
    else toast.info('The folder archive is being prepared. Try Download again shortly.')
    return
  }
  window.location.assign(`/api/suite/drive/nodes/${encodeURIComponent(row.name)}/content`)
}
async function create(kind: 'folder' | 'document' | 'link', contentDoctype?: string) {
  if (!parentId.value) return
  const values = await prompt<{ title: string; url?: string }>({
    title: kind === 'link' ? 'New link' : kind === 'folder' ? 'New folder' : `New ${contentDoctype}`,
    fields: [
      { name: 'title', label: 'Name', required: true },
      ...(kind === 'link' ? [{ name: 'url', label: 'URL', type: 'text' as const, required: true }] : []),
    ],
    confirmLabel: 'Create',
  })
  if (!values) return
  const created = await createMutation.run({ parent: parentId.value, title: values.title, kind, url: values.url, content_doctype: contentDoctype })
  if (created && kind === 'document') await openNode(created)
}
function replaceSlug(row: DriveNode) {
  if (props.destination === 'folder' && row.name === route.params.node) {
    void router.replace({ path: `/files/f/${encodeURIComponent(row.name)}/${slugify(row.title)}`, query: route.query })
  }
}
function syncSavedViewQuery() {
  if (concreteDestination.value || isSearching.value) return
  if (!route.query.sort && !route.query.dir && !route.query.group) return
  const { sort: _sort, dir: _dir, group: _group, ...query } = route.query
  void router.replace({ query })
}
</script>
