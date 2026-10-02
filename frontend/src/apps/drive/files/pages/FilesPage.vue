<template>
  <div class="flex min-w-0 flex-1 flex-col text-ink-gray-8">
    <AreaSidebar v-if="signedIn" area="files" title="Drive" :loading="discovered.status === 'pending' && !discovered.data">
      <FilesPanel />
    </AreaSidebar>
    <PageHeader class="hidden md:flex">
      <div class="flex w-full items-center justify-between gap-3">
        <Breadcrumbs :items="breadcrumbs" />
        <Dropdown v-if="canCreate" :options="newOptions" align="end">
          <Button variant="subtle" label="New" icon-right="lucide-chevron-down" />
        </Dropdown>
      </div>
    </PageHeader>
    <PageHeaderMobile class="md:hidden">
      <template #prefix>
        <PageHeaderBackButton v-if="folderParent" :route="folderParent" />
      </template>
      <Button
        v-if="signedIn"
        variant="ghost"
        :label="destinationLabel"
        icon-right="lucide-chevron-down"
        class="min-w-0 max-w-full text-lg font-medium"
        @click="requestPanel"
      />
      <span v-else class="block truncate text-lg font-medium text-ink-gray-9">{{ destinationLabel }}</span>
      <template #suffix>
        <Dropdown v-if="canCreate" :options="newOptions" align="end">
          <Button variant="subtle" label="New" icon-right="lucide-chevron-down" />
        </Dropdown>
      </template>
    </PageHeaderMobile>

    <UnlockScreen v-if="locked" :node="parentId" @unlocked="reload" />
    <!-- The wrapper is the menu's trigger, so a right-click anywhere in the
         pane below the header opens it. The pane picks the options on each
         right-click, or stops the event to leave the browser's own menu.
         The trigger sets an inline `pointer-events: auto` so a right-click
         can move the open menu. While its menu is closed, the class gives
         that back to the page, so another overlay that blocks the page,
         such as a select open in View settings, blocks the pane too. -->
    <ContextMenu v-else v-model:open="contextOpen" :options="contextOptions">
      <div class="flex flex-1 flex-col data-[state=closed]:![pointer-events:inherit]">
        <div
          class="relative flex flex-1 flex-col px-5 py-4"
          v-bind="paneDrop"
          @pointerdown="onPanePointerdown"
          @contextmenu="onPaneContextMenu"
        >
          <div class="flex h-7 items-center justify-between gap-2">
            <template v-if="selectionMode">
              <div class="flex min-w-0 items-center gap-2">
                <Button
                  v-for="action in bulkActions"
                  :key="action.label"
                  :label="action.label"
                  :icon-left="action.icon"
                  :disabled="action.disabled"
                  @click="action.onClick"
                />
                <span class="truncate pl-1 text-base text-ink-gray-7">{{ selection.length }} selected</span>
              </div>
              <Button variant="ghost" label="Done" @click="clearSelected" />
            </template>
            <template v-else>
              <TextInput
                v-if="signedIn"
                v-model="searchText"
                type="search"
                :debounce="250"
                placeholder="Search all files"
                aria-label="Search all files"
                class="files-search w-full max-w-64"
                @update:model-value="updateSearch"
                @keydown.escape="clearSearch"
              >
                <template #prefix><span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" /></template>
                <template v-if="searchText" #suffix>
                  <button
                    type="button"
                    aria-label="Clear search"
                    class="flex size-4 items-center justify-center rounded-full text-ink-gray-5 hover:text-ink-gray-7 focus-visible:focus-ring"
                    @click="clearSearchAndFocus"
                  >
                    <span class="lucide-x size-3.5" aria-hidden="true" />
                  </button>
                </template>
              </TextInput>
              <!-- A set filter stays, so an empty result can still change or clear it.
                   The wrapper keeps the filter its width, since MultiSelect's own root takes no class. -->
              <div v-if="listingTypes.length || !settledEmpty" class="shrink-0">
                <MultiSelect
                  :model-value="listingTypes.map((option) => option.value)"
                  :options="typeOptions"
                  placeholder="Type"
                  hide-search
                  class="max-w-40"
                  @update:model-value="setTypes"
                >
                  <template #item-prefix="{ item }">
                    <span :class="['size-4 shrink-0', typeIcon(item.value)]" aria-hidden="true" />
                  </template>
                  <!-- A phone shows one type by its icon only, so the search field keeps its room. -->
                  <template #summary="{ summary }">
                    <span :class="listingTypes.length === 1 && 'max-md:sr-only'">{{ typeSummary(listingTypes) ?? summary }}</span>
                  </template>
                  <!-- Clear only. Every type at once would still hide links and other files, so there is no Select all. -->
                  <template #footer="{ clear }">
                    <div v-if="listingTypes.length" class="border-t border-outline-gray-1 px-2 py-1.5">
                      <Button variant="ghost" label="Clear" @click="clear" />
                    </div>
                  </template>
                </MultiSelect>
              </div>
              <div class="ml-auto flex items-center gap-2">
                <Button
                  v-if="trashActions && trash.canEmptyTrash.value"
                  label="Empty trash"
                  icon-left="lucide-trash-2"
                  :disabled="!listing.rows.length || trash.pending.value"
                  @click="trash.emptyTrash()"
                />
                <!-- An empty view has nothing to arrange or select. The control stays
                     while rows load, so it does not pop in after them. -->
                <ViewSettings
                  v-if="!settledEmpty"
                  :presentation="userPresentation"
                  :arrangeable="arrangeable"
                  :columns="offeredColumns"
                  @change="setPresentation"
                  @toggle-column="setColumn"
                />
                <Dropdown v-if="moreOptions.length" :options="moreOptions" align="end">
                  <Button icon="lucide-ellipsis" aria-label="More file actions" />
                </Dropdown>
              </div>
            </template>
          </div>

          <TabButtons
            v-if="trashTabs"
            class="mt-3 max-w-96"
            :model-value="route.query.root === 'organization' ? 'organization' : 'personal'"
            :options="[{ value: 'personal', label: 'My files' }, { value: 'organization', label: 'Organization files' }]"
            @update:model-value="switchTrashRoot"
          />

          <BatchOutcome
            :result="trash.outcome.value ?? batchOutcome"
            :verb="trash.outcome.value ? trash.verb.value : batchVerb"
            class="mt-3"
            @dismiss="trash.dismissOutcome(); batchOutcome = null"
          />
          <FilesListing
            class="flex-1"
            :query="listing"
            :presentation="presentation"
            :selection="selection"
            :selection-mode="selectionMode"
            :empty-title="emptyTitle"
            :empty-description="emptyDescription"
            :show-breadcrumbs="isSearching"
            :sortable="arrangeable"
            :menu-options="rowMenuOptions"
            :row-drop="rowDrop"
            :menu-target="contextOpen ? contextRow : null"
            :date-column="destination === 'recent' && !isSearching ? 'opened' : 'modified'"
            @update:selection="selection = $event"
            @sort="changeSort"
            @open="openNode"
            @select="selectNode"
            @menu="openContextMenu"
            @preview-error="refreshPreviews"
          >
            <template v-if="listingTypes.length" #empty-action>
              <Button label="Clear filter" class="mt-2" @click="setTypes([])" />
            </template>
          </FilesListing>
          <DropOverlay :zone="drop.over.value" />
        </div>
      </div>
    </ContextMenu>

    <RenameDialog v-model:open="renameOpen" :node="activeNode" @renamed="replaceSlug" />
    <CreateNodeDialog v-model:open="createOpen" :request="createRequest" @created="onCreated" />
    <FolderPicker
      v-model:open="pickerOpen"
      :mode="pickerMode"
      :items="pickerBulk ? selectedRows : activeNode ? [activeNode] : []"
      :busy="moveMutation.isPending || copyMutation.isPending || batchMutation.isPending"
      @choose="applyPicker"
    />
    <TemplatePicker v-if="parentId" v-model:open="templatesOpen" :parent="parentId" @created="openNode" />
    <DriveUploads ref="uploads" />
  </div>
</template>

<script setup lang="ts">
import { computed, h, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Breadcrumbs,
  Button,
  ContextMenu,
  Dropdown,
  MultiSelect,
  PageHeader,
  PageHeaderBackButton,
  PageHeaderMobile,
  TabButtons,
  TextInput,
  type DropdownActionOption,
  type DropdownItem,
} from 'frappe-ui'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import { driveNodeRoute, useDriveDialogs } from '@/apps/drive'
import {
  batchNodes,
  children as nodesChildren,
  copyNode,
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
import { isDriveLocked } from '@/apps/drive/client/unlock'
import { view } from '@/apps/drive/client/views'
import { AreaSidebar, openAreaSidebar } from '@/platform/area-sidebar'
import { DOCUMENT_TYPES_KEY, GUEST_FRAME_KEY } from '@/platform/contracts'
import { confirm, toast } from '@/platform/feedback'
import { openingTitle, usePageTitle } from '@/platform/page-meta'
import { useMutation, useQuery } from '@/platform/server-state'
import { useSession } from '@/platform/session'
import BatchOutcome from '../features/BatchOutcome.vue'
import CreateNodeDialog, { type CreateRequest } from '../features/CreateNodeDialog.vue'
import { emptyState, type FilesDestination } from '../features/emptyState'
import FilesListing from '../features/FilesListing.vue'
import { heldWhileRearranging } from '../features/heldRows'
import { recentFiles } from '../features/recent'
import { offeredTypes, typeNouns, typeQuery, typesFromQuery, typeSummary } from '../features/typeFilter'
import { copyLink } from '../features/share/shareFormat'
import FolderPicker from '../features/FolderPicker.vue'
import RenameDialog from '../features/RenameDialog.vue'
import TemplatePicker from '../features/TemplatePicker.vue'
import UnlockScreen from '../features/UnlockScreen.vue'
import ViewSettings from '../features/ViewSettings.vue'
import { useTrashActions } from '../features/trash/useTrashActions'
import DriveUploads from '../features/uploads/DriveUploads.vue'
import DropOverlay from '../features/uploads/DropOverlay.vue'
import { rowDropHandlers, useUploadDrop } from '../features/uploads/drop'
import { uploadTargetOf } from '../features/uploads/queue'
import { linkAccess } from '../features/linkAccess'
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
  FILES_COLUMNS,
  type FilesColumn,
  type FilesSort,
  type PresentationChange,
  type PresentationState,
} from '../features/presentation'
import { folderTrail, type FolderTrail } from '../features/folderTrail'
import { nodeIcon, nodeIconTint } from '../internal/icons'
import { LOCATION_LABELS, locationTitle } from '../internal/locations'
import { slugify } from '../internal/slugify'
import FilesPanel from './FilesPanel.vue'

type Destination = FilesDestination

const props = defineProps<{ destination: Destination }>()
const route = useRoute()
const router = useRouter()
const dialogs = useDriveDialogs()
const documentTypes = inject(DOCUMENT_TYPES_KEY, [])
const guestFrame = inject(GUEST_FRAME_KEY, null)
const session = useSession()
// A visitor without a session gets no sidebar, search or Star (spec §10.3).
const signedIn = computed(() => session.status.value === 'authenticated')
// Roots need a session (spec §10.13). A guest only ever opens a shared folder.
const discovered = useQuery(() => signedIn.value ? roots() : false)
const presentationVersion = ref(0)
const selectionState = ref<SelectionState>(clearSelection())
const searchText = ref(String(route.query.q ?? ''))
const activeNode = ref<DriveNode | null>(null)
const contextOptions = ref<DropdownItem[]>([])
const contextOpen = ref(false)
/** The item the open menu is for, or `null` for the pane's own menu. */
const contextRow = ref<string | null>(null)
/** The last right-click the listing handled, so the pane does not handle it again. */
let listingMenuEvent: MouseEvent | null = null
/** Whether the last press in the pane was touch, where a long press selects instead. */
let paneTouch = false
const renameOpen = ref(false)
const createOpen = ref(false)
const createRequest = ref<CreateRequest | null>(null)
const pickerOpen = ref(false)
const templatesOpen = ref(false)
const pickerMode = ref<'move' | 'copy'>('move')
const pickerBulk = ref(false)
const batchOutcome = ref<DriveBatchResult | null>(null)
const batchVerb = ref('moved')
const narrow = ref(false)
let narrowMedia: MediaQueryList | null = null
let stopRealtime: (() => void) | null = null
let stopPreviews: (() => void) | null = null
let visitedFolder = ''

/** The user's choice, from the URL or their saved preference. Menus and folder links carry it. */
const userPresentation = computed(() => {
  void presentationVersion.value
  return resolvePresentation(route.query, readPresentationPreference(), narrow.value ? 'grid' : null)
})
/**
 * What the listing shows. Search and the saved views come in the server's own
 * order, so they show it without overwriting the user's choice.
 */
const presentation = computed<PresentationState>(() => {
  const chosen = userPresentation.value
  // Decided from the place, not the rows, so the loading skeleton and the
  // loaded list have the same columns.
  const shown = inOwnSpace.value ? { ...chosen, columns: chosen.columns.filter((column) => column !== 'owner') } : chosen
  if (isSearching.value || !concreteDestination.value) {
    return { ...shown, sort: 'modified', dir: 'desc' }
  }
  return shown
})
/**
 * My files and its folders, where every row names the user as owner, so the
 * Owner column says nothing. A folder whose trail has not loaded counts as the
 * user's own; a folder shared from elsewhere has another root.
 */
const inOwnSpace = computed(() => {
  if (isSearching.value) return false
  if (props.destination === 'personal') return true
  if (props.destination !== 'folder') return false
  const root = trail.value?.[0]?.name
  return !root || root === discovered.data?.personal.node
})
const selection = computed({
  get: () => selectionState.value.selected,
  set: (selected: string[]) => { selectionState.value = { selected, anchor: selected.at(-1) ?? null } },
})
const selectionMode = computed(() => selection.value.length > 0)
const searchTerm = computed(() => String(route.query.q ?? '').trim())
const isSearching = computed(() => !!searchTerm.value)
const concreteDestination = computed(() => ['personal', 'organization', 'folder'].includes(props.destination))
const rootLocation = computed(() => {
  if (props.destination === 'organization') return discovered.data?.organization ?? null
  return discovered.data?.personal ?? null
})
const parentId = computed(() => props.destination === 'folder' ? String(route.params.node ?? '') : rootLocation.value?.node ?? '')
const detail = useQuery(() => parentId.value && concreteDestination.value
  ? node(parentId.value, 'access,breadcrumbs')
  : false)
// A password link shows the unlock screen in place of the folder (spec §10.2),
// also when its ticket expires and the next listing refresh is refused.
const locked = computed(() => isDriveLocked(detail.error) || (concreteDestination.value && isDriveLocked(listing.error)))
/** Set when a folder row opens, so the header can name it before its details load. */
const openedTrail = ref<FolderTrail | null>(null)
/**
 * The folder shown and its ancestors. It holds across route changes: the new
 * folder's details load after the route changes, and the header keeps what it
 * already knows instead of going blank (see `folderTrail`).
 */
const trail = computed<FolderTrail | null>((shown) => {
  const id = parentId.value
  if (!id || !concreteDestination.value) return shown ?? null
  if (props.destination !== 'folder') {
    const root = rootLocation.value
    return root ? [{ name: root.node, title: root.title }] : shown ?? null
  }
  // A node the listing already holds can show before its details arrive, and
  // then has no `breadcrumbs`. Only the details give the trail, but the cached
  // node, like a link that names its folder, gives the title.
  const folder = detail.data?.name === id ? detail.data : undefined
  return folderTrail(id, {
    loaded: folder?.breadcrumbs ? [...folder.breadcrumbs, { name: folder.name, title: folder.title }] : null,
    shown: shown ?? null,
    opened: openedTrail.value,
    title: folder?.title || openingTitle(router.options.history.state),
  })
})
/** The folder's title, while its trail is known. */
const folderTitle = computed(() => {
  const last = trail.value?.at(-1)
  return last?.name === parentId.value ? last.title : null
})
const placeLabel = computed(() => {
  if (props.destination === 'folder') return folderTitle.value ?? ''
  return ({
    personal: LOCATION_LABELS.personal, organization: LOCATION_LABELS.organization, shared: LOCATION_LABELS.shared,
    recent: 'Recent', starred: 'Starred', trash: 'Trash', folder: 'Folder',
  } as Record<Destination, string>)[props.destination]
})
// Search covers the whole Drive, so while it shows, the header names the
// search and not the folder it started from.
const destinationLabel = computed(() => isSearching.value ? 'Search results' : placeLabel.value)
const breadcrumbs = computed(() => {
  if (isSearching.value) return [{ label: `Search results for “${searchTerm.value}”`, route: route.fullPath }]
  if (props.destination !== 'folder') return [{ label: placeLabel.value, route: route.path }]
  const known = folderTitle.value === null ? null : trail.value
  // Unknown until the details load. The header keeps its height meanwhile.
  if (!known) return []
  const items = known.slice(0, -1).map((crumb) => ({
    label: locationTitle(crumb, discovered.data),
    route: {
      path: rootPath(crumb.name) ?? `/drive/f/${encodeURIComponent(crumb.name)}/${slugify(crumb.title)}`,
      query: presentationQuery.value,
    },
  }))
  return [...items, { label: placeLabel.value, route: route.fullPath }]
})
usePageTitle(() => {
  if (isSearching.value) return `Search results for “${searchTerm.value}”`
  return props.destination === 'folder' ? folderTitle.value ?? '' : ''
})
const folderParent = computed<RouteLocationRaw | null>(() => {
  if (isSearching.value) return null
  const previous = breadcrumbs.value.at(-2)
  return previous?.route ?? null
})
const presentationQuery = computed(() => ({
  view: userPresentation.value.view,
  sort: userPresentation.value.sort,
  dir: userPresentation.value.dir,
}))
const expansion = computed(() => {
  const parts = ['access']
  if (isSearching.value) parts.push('breadcrumbs')
  if (presentation.value.view === 'grid') parts.push('preview')
  return parts.join(',')
})
// Recent shows the files the user opened, without the folders they passed through.
const hidesFolders = computed(() => props.destination === 'recent' && !isSearching.value)
const typeChoices = computed(() => offeredTypes({ folders: !hidesFolders.value }))
// `?type=` keeps items of any of the chosen types. It is filter state, not a
// preference, so folder links and breadcrumbs leave it behind, as they leave the search.
const listingTypes = computed(() => typesFromQuery(route.query.type, typeChoices.value))
const typeOptions = computed(() => typeChoices.value.map((option) => ({ label: option.label, value: option.value })))
/**
 * Trash has a tab per root. The tabs show from the first frame, before the
 * roots load, so the list below them never moves down. They go only when the
 * roots arrive without an Organization root, which a site rarely lacks.
 */
const trashTabs = computed(() => {
  if (props.destination !== 'trash') return false
  const known = discovered.data
  return known ? !!known.organization : !discovered.error
})
// The root whose Trash shows, from its tab.
const trashRoot = computed(() => {
  if (props.destination !== 'trash') return null
  return (route.query.root === 'organization' ? discovered.data?.organization?.node : discovered.data?.personal.node) ?? null
})
const listingQuery = useQuery(() => {
  const types = listingTypes.value.map((option) => option.value)
  if (isSearching.value) return view({ view: 'search', term: searchTerm.value, types, expand: expansion.value })
  if (concreteDestination.value) {
    if (!parentId.value) return false
    return nodesChildren({
      node: parentId.value,
      order_by: userPresentation.value.sort,
      ascending: userPresentation.value.dir === 'asc',
      types,
      expand: expansion.value,
    })
  }
  const name = props.destination === 'shared' ? 'shared'
    : props.destination === 'recent' ? 'recents'
      : props.destination === 'starred' ? 'favourites' : 'trash'
  const root = trashRoot.value ?? undefined
  if (props.destination === 'trash' && !root) return false
  return view({ view: name, root, types, expand: expansion.value })
})
// A new sort, view or search term keeps the old rows up until the new ones come.
const listing = heldWhileRearranging(
  recentFiles(listingQuery, () => hidesFolders.value),
  () => [props.destination, parentId.value, isSearching.value, trashRoot.value, typeQuery(listingTypes.value)].join('|'),
)
const hasRows = computed(() => listing.rows.length > 0)
const settledEmpty = computed(() => !hasRows.value && listing.status !== 'pending')
const trash = useTrashActions(() => trashRoot.value)
// Search replaces the Trash listing, so its rows get no Trash actions.
const trashActions = computed(() => props.destination === 'trash' && !isSearching.value)
const uploads = ref<InstanceType<typeof DriveUploads> | null>(null)
// Uploads follow the server's UPLOAD role on the open folder (spec §6.7, §10.13). Saved views and search take none.
const uploadTarget = computed(() => concreteDestination.value && !isSearching.value ? uploadTargetOf(detail.data) : null)
const drop = useUploadDrop((selection, target) => uploads.value?.upload(selection, target))
const paneDrop = drop.zone(() => uploadTarget.value && { key: uploadTarget.value.parent, label: placeLabel.value, target: uploadTarget.value })
// New stays while a search shows. It adds to the folder the search started from.
const canCreate = computed(() => concreteDestination.value && hasRole(detail.data, DRIVE_ROLES.upload))
const newUploadTarget = computed(() => concreteDestination.value ? uploadTargetOf(detail.data) : null)
const canCreateDocuments = computed(() => linkAccess(detail.data, signedIn.value).documentKinds)
const selectedRows = computed(() => (listing.rows as DriveNode[]).filter((row) => selection.value.includes(row.name)))
const canBulkEdit = computed(() => !!selectedRows.value.length && selectedRows.value.every((row) => hasRole(row, DRIVE_ROLES.edit)))
const empty = computed(() => emptyState({
  destination: props.destination,
  term: searchTerm.value,
  canCreate: canCreate.value,
  typeNoun: listingTypes.value.length ? typeNouns(listingTypes.value) : undefined,
}))
const emptyTitle = computed(() => empty.value.title)
const emptyDescription = computed(() => empty.value.description)

const batchMutation = useMutation(batchNodes())
const moveMutation = useMutation(moveNode(), { silent: ['DriveConflict'] })
const copyMutation = useMutation(copyNode(), { silent: ['DriveConflict'] })
const trashMutation = useMutation(trashNode())
const starMutation = useMutation(starNode())
const unstarMutation = useMutation(unstarNode())
const visitMutation = useMutation(visitNode(), { silent: true })
const archiveMutation = useMutation(startArchive())

onMounted(() => {
  narrowMedia = window.matchMedia('(max-width: 767px)')
  narrow.value = narrowMedia.matches
  narrowMedia.addEventListener('change', onNarrowChange)
  stopRealtime = observeDriveChanges()
  syncSavedViewQuery()
  if (presentation.value.view === 'grid') startPreviewObservation()
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('popstate', onMobileBack)
})
onBeforeUnmount(() => {
  narrowMedia?.removeEventListener('change', onNarrowChange)
  stopRealtime?.()
  stopPreviews?.()
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('popstate', onMobileBack)
})

watch(() => presentation.value.view, (mode) => {
  if (mode === 'grid') startPreviewObservation()
  else { stopPreviews?.(); stopPreviews = null }
})
// A type this listing does not offer is dropped without a history entry, and so
// is `group`, which an older listing put in the URL.
watch(() => [route.query.type, typeQuery(listingTypes.value), route.query.group] as const, ([raw, kept, group]) => {
  if ((raw === undefined || raw === kept) && group === undefined) return
  const { type: _type, group: _group, ...query } = route.query
  const type = raw === undefined ? undefined : kept
  void router.replace({ query: type ? { ...query, type } : query })
}, { immediate: true })
watch(() => route.fullPath, () => {
  searchText.value = String(route.query.q ?? '')
  clearSelected()
})
// A root never shows as a folder route. Its own route replaces it [T001, T015].
watch(() => [props.destination, String(route.params.node ?? ''), discovered.data] as const, ([destination, id]) => {
  const root = destination === 'folder' ? rootPath(id) : null
  if (root) void router.replace({ path: root, query: route.query })
}, { immediate: true })
watch(() => detail.data, (folder) => {
  if (!folder || props.destination !== 'folder' || rootPath(folder.name)) return
  // The old Drive pages used `/drive/f/<id>` for a file. A non-folder id opens as a document [T020].
  if (folder.kind !== 'folder' && folder.kind !== 'root') {
    void router.replace({ path: `/d/${encodeURIComponent(folder.name)}`, query: route.query, hash: route.hash })
    return
  }
  const expected = slugify(folder.title)
  if (String(route.params.slug ?? '') !== expected) {
    void router.replace({ path: `/drive/f/${encodeURIComponent(folder.name)}${expected ? `/${expected}` : ''}`, query: route.query })
  }
  if (visitedFolder !== folder.name && linkAccess(folder, signedIn.value).visit) {
    visitedFolder = folder.name
    void visitMutation.run({ node: folder.name })
  }
})

// Failed items stay selected after each Trash outcome, also one a Retry settles (spec §6.11).
watch(() => trash.outcome.value, (outcome) => {
  if (outcome) selectionState.value = { selected: outcome.failed.map((failure) => failure.node), anchor: null }
})

// A guest is never told whether the folder exists (spec §10.8).
watch(() => [detail.error, listing.error] as const, (errors) => {
  const refused = errors.some((error) => error && !isDriveLocked(error) && [401, 403, 404, 410].includes(error.status))
  if (guestFrame && refused) guestFrame.requireSignIn()
})

// Sort reorders a folder on the server. Search and the saved views come in
// their own order, so they offer no sort.
const arrangeable = computed(() => concreteDestination.value && !isSearching.value)
/** The listing hides Owner in the user's own space, so View settings does not offer it there. */
const offeredColumns = computed(() => inOwnSpace.value ? FILES_COLUMNS.filter((column) => column !== 'owner') : FILES_COLUMNS)
/** The open folder's own actions. A root is named by the sidebar and offers none. */
const folderActions = computed<DropdownActionOption[]>(() => {
  const folder = detail.data
  if (props.destination !== 'folder' || isSearching.value || !folder || folder.kind !== 'folder') return []
  return [
    ...(hasRole(folder, DRIVE_ROLES.manage) ? [{ label: 'Share folder', icon: 'lucide-share-2', onClick: () => shareRow(folder) }] : []),
    { label: 'Copy link', icon: 'lucide-link', onClick: () => copyNodeLink(folder) },
    ...(hasRole(folder, DRIVE_ROLES.edit) ? [{ label: 'Rename folder', icon: 'lucide-pencil', onClick: () => beginRename(folder) }] : []),
  ]
})
const moreOptions = computed<DropdownItem[]>(() => [
  ...(folderActions.value.length ? [{ group: 'This folder', options: folderActions.value }] : []),
  ...(hasRows.value ? [{ group: 'Select', hideLabel: true, options: [
    { label: 'Select rows', icon: 'lucide-square-check', onClick: selectFirst },
    { label: 'Select all', icon: 'lucide-list-checks', onClick: selectAll },
  ] }] : []),
])
/** What a selection of several items offers, in the toolbar and on right-click. */
const bulkActions = computed(() => trashActions.value
  ? [
      { label: 'Restore', icon: 'lucide-undo-2', disabled: trash.pending.value, onClick: runRestore },
      { label: 'Delete forever', icon: 'lucide-trash-2', disabled: trash.pending.value, onClick: runPurge },
    ]
  : [
      { label: 'Move', icon: 'lucide-folder-input', disabled: !canBulkEdit.value, onClick: beginBulkMove },
      { label: 'Move to trash', icon: 'lucide-trash-2', disabled: !canBulkEdit.value, onClick: runBulkTrash },
    ])
/** A menu row led by the type icon the listing shows for what it creates. */
function typedOption(label: string, kind: Pick<DriveNode, 'kind' | 'title' | 'mime' | 'content_doctype'>, onClick: () => void, icon = nodeIcon(kind)): DropdownActionOption {
  return {
    label,
    onClick,
    slots: { prefix: () => h('span', { class: ['size-4 shrink-0', icon, nodeIconTint(kind)], 'aria-hidden': 'true' }) },
  }
}
const newOptions = computed<DropdownItem[]>(() => {
  const target = newUploadTarget.value
  const documents = canCreateDocuments.value ? documentTypes : []
  return [
    { group: 'Create', options: [
      typedOption('Folder', { kind: 'folder', title: 'Folder', mime: null, content_doctype: null }, () => create('folder')),
      ...documents.map((definition) => typedOption(
        definition.newLabel(),
        { kind: 'document', title: definition.newLabel(), mime: null, content_doctype: definition.contentDoctype },
        () => create('document', definition.contentDoctype),
      )),
      typedOption('Link', { kind: 'link', title: 'Link', mime: null, content_doctype: null }, () => create('link')),
      ...(documents.length
        ? [{ label: 'From template', icon: 'lucide-layout-template', onClick: () => { templatesOpen.value = true } }]
        : []),
    ] },
    ...(target ? [{ group: 'Upload', options: [
      { label: 'Files', icon: 'lucide-upload', onClick: () => pickUpload('files') },
      // Phone pickers offer no folders (spec §5.12).
      ...(narrow.value ? [] : [{ label: 'Folder', icon: 'lucide-folder-up', onClick: () => pickUpload('folder') }]),
    ] }] : []),
  ]
})

function setPresentation(change: PresentationChange) {
  clearSelected()
  void replacePresentation(router, userPresentation.value, change)
}
function setColumn(column: FilesColumn, visible: boolean) {
  const chosen = userPresentation.value
  const columns = visible
    ? [...new Set([...chosen.columns, column])]
    : chosen.columns.filter((item) => item !== column)
  writePresentationPreference({ ...chosen, columns })
  presentationVersion.value += 1
}
function changeSort(column: FilesSort) {
  if (!arrangeable.value) return
  const chosen = userPresentation.value
  setPresentation({ sort: column, dir: chosen.sort === column && chosen.dir === 'asc' ? 'desc' : 'asc' })
}
function updateSearch(value: string | number) {
  const q = String(value).trim() || undefined
  void router.replace({ query: { ...route.query, q } })
}
function clearSearch() {
  searchText.value = ''
  updateSearch('')
}
/** The clear button leaves with the term, so focus stays in the field. */
function clearSearchAndFocus(event: MouseEvent) {
  const field = (event.currentTarget as HTMLElement).closest('.files-search')?.querySelector('input')
  clearSearch()
  field?.focus()
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
function onNarrowChange(event: MediaQueryListEvent) {
  narrow.value = event.matches
}
function onMobileBack() {
  if (selectionMode.value) clearSelected()
}
function requestPanel() {
  openAreaSidebar('files')
}
function rootPath(id: string): string | null {
  if (!id) return null
  if (id === discovered.data?.personal.node) return '/drive'
  if (id === discovered.data?.organization?.node) return '/drive/organization'
  return null
}
function typeIcon(value: string | number) {
  const option = typeChoices.value.find((choice) => choice.value === value)
  return option ? [nodeIcon(option.sample), nodeIconTint(option.sample)] : []
}
function setTypes(values: readonly (string | number)[]) {
  const chosen = new Set(values)
  replaceTypeQuery(typeQuery(typeChoices.value.filter((option) => chosen.has(option.value))))
}
function replaceTypeQuery(type: string | undefined) {
  const { type: _type, ...query } = route.query
  void router.replace({ query: type ? { ...query, type } : query })
}
function switchTrashRoot(value: string | number) {
  clearSelected()
  void router.replace({ query: { ...route.query, root: value === 'organization' ? 'organization' : undefined } })
}
function startPreviewObservation() {
  if (stopPreviews) return
  stopPreviews = observePreviewRefresh({
    refresh: async () => {
      await listing.refetch()
    },
  })
}
function refreshPreviews() { void listing.refetch() }
function reload() {
  void detail.refetch()
  void listing.refetch()
}

async function openNode(row: DriveNode, newTab = false) {
  if (row.kind === 'link') {
    if (!row.url) return
    const origin = new URL(row.url, window.location.href).origin
    const allowed = await confirm({ title: 'Open external link?', message: `This link opens ${origin} in a new tab.`, confirmLabel: 'Open' })
    if (!allowed) return
    if (linkAccess(row, signedIn.value).visit) await visitMutation.run({ node: row.name })
    window.open(row.url, '_blank', 'noopener,noreferrer')
    return
  }
  // A folder keeps the user's view settings. A document's history entry
  // carries its title, so its tab is named before it loads. A file keeps the
  // type filter, so its preview steps through the files this listing shows.
  const target: RouteLocationRaw = row.kind === 'folder'
    ? { path: nodePath(row), query: presentationQuery.value }
    : row.kind === 'file'
      ? { ...driveNodeRoute(row), query: { type: typeQuery(listingTypes.value) } }
      : driveNodeRoute(row)
  if (newTab) {
    window.open(router.resolve(target).href, '_blank', 'noopener,noreferrer')
    return
  }
  if (row.kind === 'folder') openedTrail.value = trailOf(row)
  await router.push(target)
}

/**
 * Sets the menu a right-click opens. An item in a selection of several gets the
 * selection's actions. Any other item gets its own menu, and the selection
 * clears unless it is that item alone. Empty space gets the New button's
 * options. Where none apply, the event stops before the menu's trigger, so the
 * browser's own menu shows.
 */
function openContextMenu(row: DriveNode | null, event: MouseEvent) {
  const options = row ? itemContextOptions(row)
    : canCreate.value && !isSearching.value ? newOptions.value : []
  if (!options.length) {
    event.stopPropagation()
    return
  }
  listingMenuEvent = event
  contextRow.value = row?.name ?? null
  contextOptions.value = options
}
function isTextField(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]')
}
function onPanePointerdown(event: PointerEvent) {
  paneTouch = event.pointerType !== 'mouse'
  // A touch press would start the menu's own long-press timer. Marking it
  // handled stops that, as the listing does for its items. Text fields keep
  // their press, so tapping the search field still focuses it.
  if (paneTouch && !isTextField(event.target)) event.preventDefault()
}
/** A right-click in the pane outside the listing: the toolbar, the padding, the space below. */
function onPaneContextMenu(event: MouseEvent) {
  if (event === listingMenuEvent) return
  if (paneTouch) {
    event.preventDefault()
    return
  }
  // A text field keeps the browser's menu, for paste and spelling.
  if (isTextField(event.target)) {
    event.stopPropagation()
    return
  }
  openContextMenu(null, event)
}
function itemContextOptions(row: DriveNode): DropdownItem[] {
  const selected = selection.value
  if (selected.length > 1 && selected.includes(row.name)) {
    return [{ group: `${selected.length} selected`, options: bulkActions.value }]
  }
  if (selected.length && !(selected.length === 1 && selected[0] === row.name)) clearSelected()
  return rowMenuOptions(row)
}
function rowMenuOptions(row: DriveNode): DropdownItem[] {
  const editable = hasRole(row, DRIVE_ROLES.edit)
  return [
    { group: 'Open', hideLabel: true, options: [
      { label: 'Open', icon: 'lucide-arrow-up-right', onClick: () => openNode(row) },
      { label: 'Open in new tab', icon: 'lucide-external-link', onClick: () => openNode(row, true) },
      // Share needs MANAGE (spec §7.2). A link gives at most EDIT, so guests and link-only readers never see it.
      ...(hasRole(row, DRIVE_ROLES.manage) ? [{ label: 'Share', icon: 'lucide-share-2', onClick: () => shareRow(row) }] : []),
      { label: 'Copy link', icon: 'lucide-link', onClick: () => copyNodeLink(row) },
      ...(row.kind !== 'link' ? [{ label: 'Download', icon: 'lucide-download', onClick: () => download(row) }] : []),
    ] },
    { group: 'Organize', hideLabel: true, options: [
      ...(editable ? [
        { label: 'Rename', icon: 'lucide-pencil', onClick: () => beginRename(row) },
        { label: 'Move', icon: 'lucide-folder-input', onClick: () => beginPicker(row, 'move') },
      ] : []),
      { label: 'Make a copy', icon: 'lucide-copy', onClick: () => beginPicker(row, 'copy') },
      ...(linkAccess(row, signedIn.value).star ? [{ label: row.favourite ? 'Unstar' : 'Star', icon: 'lucide-star', onClick: () => toggleStar(row) }] : []),
    ] },
    { group: 'Select', hideLabel: true, options: [
      { label: 'Select', icon: 'lucide-square-check', onClick: () => selectNode(row, false) },
    ] },
    ...(editable ? [{ group: 'Trash', hideLabel: true, options: [
      { label: 'Move to trash', icon: 'lucide-trash-2', theme: 'red' as const, onClick: () => trashMutation.run({ node: row.name, state: 'Trashed' }) },
    ] }] : []),
  ]
}
/**
 * A row's trail, as far as the page knows it. Search rows carry their path. A
 * row of the folder shown sits under its trail. A saved view knows the row only.
 */
function trailOf(row: DriveNode): FolderTrail {
  const self = { name: row.name, title: row.title }
  if (row.breadcrumbs) return [...row.breadcrumbs, self]
  if (concreteDestination.value && !isSearching.value && trail.value) return [...trail.value, self]
  return [self]
}
/** The node's own page, as an absolute URL. A link node copies where it points. */
function copyNodeLink(row: DriveNode) {
  void copyLink(row.kind === 'link' && row.url ? row.url : router.resolve(nodePath(row)).href)
}
function nodePath(row: DriveNode) {
  const slug = slugify(row.title)
  const base = row.kind === 'folder' ? '/drive/f' : '/d'
  return `${base}/${encodeURIComponent(row.name)}${slug ? `/${slug}` : ''}`
}
function pickUpload(source: 'files' | 'folder') {
  const target = newUploadTarget.value
  if (!target) return
  if (source === 'files') uploads.value?.pickFiles(target)
  else uploads.value?.pickFolder(target)
}
/** Folder rows decide drops by their own access. Saved views and search take none (spec §6.7). */
function rowDrop(row: DriveNode) {
  return concreteDestination.value && !isSearching.value ? rowDropHandlers(drop, row) : null
}
async function runRestore() { await trash.restore(selection.value) }
async function runPurge() { await trash.purge(selection.value) }
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
/** A share write can change the caller's own access, so the listing is read again. */
async function shareRow(row: DriveNode) {
  if (await dialogs.share(row.name)) void listing.refetch()
}
async function download(row: DriveNode) {
  if (row.kind === 'folder') {
    const status = await archiveMutation.run({ node: row.name })
    if (status?.status === 'ready') window.location.assign(archiveDownloadUrl(row.name))
    else toast.info('The folder archive is being prepared. Try Download again shortly.')
    return
  }
  window.location.assign(`/api/suite/drive/nodes/${encodeURIComponent(row.name)}/content`)
}
function create(kind: CreateRequest['kind'], contentDoctype?: string) {
  if (!parentId.value) return
  createRequest.value = {
    parent: parentId.value,
    kind,
    contentDoctype,
    typeLabel: documentTypes.find((definition) => definition.contentDoctype === contentDoctype)?.newLabel(),
  }
  createOpen.value = true
}
async function onCreated(created: DriveNode, request: CreateRequest) {
  if (request.kind === 'document') {
    await openNode(created)
    return
  }
  // A search hides what was just added, so the folder shows again.
  if (isSearching.value) clearSearch()
}
function replaceSlug(row: DriveNode) {
  if (props.destination === 'folder' && row.name === route.params.node) {
    void router.replace({ path: `/drive/f/${encodeURIComponent(row.name)}/${slugify(row.title)}`, query: route.query })
  }
}
function syncSavedViewQuery() {
  if (concreteDestination.value || isSearching.value) return
  if (!route.query.sort && !route.query.dir) return
  const { sort: _sort, dir: _dir, ...query } = route.query
  void router.replace({ query })
}
</script>

<style>
/*
 * The field draws its own clear button, so the browser's is hidden. Not
 * scoped: TextInput passes its attributes to the input, so its root carries
 * no scope id.
 */
.files-search input[type='search']::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
  display: none;
}
</style>
