<!--
  Fake Files list. It shows either a sidebar saved view or one folder's
  contents, walking the fixture tree from the path in the URL.
-->
<template>
  <PageHeader v-if="!isMobile">
    <Breadcrumbs :items="crumbs" />
    <NewMenu />
  </PageHeader>
  <PageHeaderMobile v-else :title="crumbs[crumbs.length - 1].label">
    <template #prefix>
      <PageHeaderBackButton v-if="crumbs.length > 1" :route="crumbs[crumbs.length - 2].route" />
    </template>
    <template #suffix>
      <NewMenu />
    </template>
  </PageHeaderMobile>

  <AppSplit>
  <template #panel>
    <FilesPanel />
  </template>

  <!-- Each app owns its own scrolling now that the shell no longer wraps the
       area: the panel beside this has to stay put while the list moves. -->
  <ScrollArea class="min-h-0 flex-1">
  <div class="px-5 py-4">
    <!-- Both bars are h-7, so entering selection mode swaps the controls
         without moving the list underneath. -->
    <div class="flex h-7 items-center justify-between gap-2">
      <template v-if="selectionMode">
        <div class="flex items-center gap-2">
          <!-- Prototype: every bulk action is a no-op. -->
          <Button
            v-for="action in bulkActions"
            :key="action.label"
            :label="action.label"
            :icon-left="action.icon"
            :disabled="!selection.length"
            @click="() => {}"
          />
          <span class="pl-1 text-base text-ink-gray-7">
            {{ selection.length }} selected
          </span>
        </div>
        <Button variant="solid" label="Done" @click="exitSelection" />
      </template>

      <template v-else>
        <TextInput
          v-model="search"
          placeholder="Search files"
          class="w-full max-w-64"
          aria-label="Search files"
        >
          <template #prefix>
            <span class="lucide-search size-4" aria-hidden="true" />
          </template>
        </TextInput>

        <div class="flex items-center gap-2">
          <Dropdown :options="viewSettings" align="end">
            <Button icon="lucide-settings-2" aria-label="View settings" />
          </Dropdown>
          <Dropdown :options="moreOptions" align="end">
            <Button icon="lucide-ellipsis" aria-label="More actions" />
          </Dropdown>
        </div>
      </template>
    </div>

    <ContextMenu v-model:open="menuOpen" :options="contextMenuOptions">
      <div
        class="mt-3"
        @click.capture="onListClick"
        @mousedown="onListMousedown"
        @contextmenu.capture="onListContextMenu"
      >
        <List
          v-if="view === 'list'"
          v-model:selection="selection"
          :selectable="selectionMode"
          :active="highlightedRow"
          :columns="columnTracks"
          :row-height="40"
          class="list-row-px-3"
          @update:active="() => {}"
        >
          <ListHeader>
            <ListHeaderCellSort
              :direction="directionFor('name')"
              @click="toggleSort('name')"
            >
              Name
            </ListHeaderCellSort>
            <ListHeaderCellSort
              v-if="columns.type"
              :direction="directionFor('type')"
              @click="toggleSort('type')"
            >
              Type
            </ListHeaderCellSort>
            <ListHeaderCellSort
              v-if="columns.owner"
              :direction="directionFor('owner')"
              @click="toggleSort('owner')"
            >
              Owner
            </ListHeaderCellSort>
            <ListHeaderCellSort
              v-if="columns.location"
              :direction="directionFor('location')"
              @click="toggleSort('location')"
            >
              Location
            </ListHeaderCellSort>
            <ListHeaderCellSort
              v-if="columns.shared"
              :direction="directionFor('shared')"
              @click="toggleSort('shared')"
            >
              Shared
            </ListHeaderCellSort>
            <ListHeaderCellSort
              v-if="columns.size"
              align="end"
              :direction="directionFor('size')"
              @click="toggleSort('size')"
            >
              Size
            </ListHeaderCellSort>
            <ListHeaderCellSort
              v-if="columns.modified"
              align="end"
              :direction="directionFor('modified')"
              @click="toggleSort('modified')"
            >
              Modified
            </ListHeaderCellSort>
          </ListHeader>

          <ListRows :items="sorted" row-key="id" />

          <component
            :is="section.label ? ListGroup : 'div'"
            v-for="section in sections"
            :key="section.label || 'flat'"
            :label="section.label || undefined"
          >
            <ListRow
              v-for="file in section.files"
              :key="file.id"
              :value="file.id"
              :to="rowTo(file)"
              @click="() => {}"
            >
              <ListCell>
                <span
                  class="mr-2 size-4 shrink-0"
                  :class="fileIcon(file)"
                  aria-hidden="true"
                />
                <span class="truncate text-base text-ink-gray-8">{{ file.name }}</span>
                <span
                  v-if="file.starred"
                  class="lucide-star ml-1.5 size-3.5 shrink-0 text-ink-amber-6"
                  aria-hidden="true"
                />
              </ListCell>
              <ListCell v-if="columns.type">
                <span class="truncate text-base text-ink-gray-7">{{ typeLabel(file) }}</span>
              </ListCell>
              <ListCell v-if="columns.owner">
                <Avatar
                  size="xs"
                  :label="file.owner"
                  :image="PEOPLE[file.owner]"
                  class="mr-2 shrink-0"
                />
                <span class="truncate text-base text-ink-gray-7">{{ file.owner }}</span>
              </ListCell>
              <ListCell v-if="columns.location">
                <span class="lucide-folder mr-2 size-4 shrink-0 text-ink-gray-4" aria-hidden="true" />
                <span class="truncate text-base text-ink-gray-7">{{ locationOf(file) }}</span>
              </ListCell>
              <ListCell v-if="columns.shared">
                <span
                  class="mr-2 size-4 shrink-0 text-ink-gray-5"
                  :class="file.shared ? 'lucide-users' : 'lucide-lock'"
                  aria-hidden="true"
                />
                <span class="truncate text-base text-ink-gray-7">
                  {{ file.shared ? 'Shared' : 'Private' }}
                </span>
              </ListCell>
              <ListCell v-if="columns.size" class="justify-end">
                <span class="truncate text-base text-ink-gray-5">{{ sizeLabel(file) }}</span>
              </ListCell>
              <ListCell v-if="columns.modified" class="justify-end">
                <span class="truncate text-base text-ink-gray-5">{{ file.modified }}</span>
              </ListCell>
            </ListRow>
          </component>
        </List>

        <!-- Grid -->
        <template v-else>
          <div
            v-for="section in sections"
            :key="section.label || 'flat'"
            class="pt-5 first:pt-0"
          >
            <div v-if="section.label" class="px-1 pb-2 text-base text-ink-gray-5">
              {{ section.label }}
            </div>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
              <component
                :is="rowTo(file) ? RouterLink : NativeButton"
                v-for="file in section.files"
                :key="file.id"
                :to="rowTo(file)"
                :data-file-id="file.id"
                class="relative flex select-none flex-col items-start gap-3 rounded-5 border p-3 text-start transition-colors"
                :class="tileClass(file)"
              >
                <span class="size-4.5 shrink-0" :class="fileIcon(file)" aria-hidden="true" />
                <span class="flex w-full min-w-0 flex-col gap-0.5">
                  <span class="flex w-full min-w-0 items-center">
                    <span class="truncate text-base font-medium text-ink-gray-8">
                      {{ file.name }}
                    </span>
                    <span
                      v-if="file.starred"
                      class="lucide-star ml-1.5 size-3.5 shrink-0 text-ink-amber-6"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="truncate text-xs text-ink-gray-5">
                    {{ file.owner }} · {{ file.modified }}
                  </span>
                </span>
                <Checkbox
                  v-if="selectionMode"
                  :model-value="selection.includes(file.id)"
                  tabindex="-1"
                  aria-hidden="true"
                  class="pointer-events-none absolute end-3 top-3"
                />
              </component>
            </div>
          </div>
        </template>

        <div
          v-if="!sorted.length"
          class="flex flex-col items-center justify-center gap-2 py-16"
        >
          <span class="lucide-folder-open size-6 text-ink-gray-4" aria-hidden="true" />
          <span class="text-base text-ink-gray-5">{{ emptyMessage }}</span>
        </div>
      </div>
    </ContextMenu>
  </div>
  </ScrollArea>
  </AppSplit>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import {
  Avatar,
  Breadcrumbs,
  Button,
  Checkbox,
  ContextMenu,
  Dropdown,
  PageHeader,
  PageHeaderBackButton,
  PageHeaderMobile,
  ScrollArea,
  TextInput,
} from 'frappe-ui'
import {
  List,
  ListCell,
  ListGroup,
  ListHeader,
  ListHeaderCellSort,
  ListRow,
  ListRows,
  type ListSortDirection,
} from 'frappe-ui/list'

import {
  DOC_KIND_META,
  FOLDERS,
  PEOPLE,
  childrenOf,
  filesInView,
  pathTo,
  pdfRef,
  type FileRow,
} from '../fixtures'
import AppSplit from '../parts/AppSplit.vue'
import FilesPanel from '../parts/panels/FilesPanel.vue'
import NewMenu from '../parts/NewMenu.vue'
import { isMobile } from '../useIsMobile'
import { useShellNav } from '../useShellNav'
import { workspaceId } from '../workspaceState'

const { folder, folderPath, areaTo, docTo, folderTo, go } = useShellNav()

/**
 * Where a row goes when it is clicked. Folders descend the tree; a PDF opens
 * the shell's own preview; the rest of the fixture tree is inert, which is
 * what `undefined` leaves them as.
 */
function rowTo(file: FileRow): RouteLocationRaw | undefined {
  if (file.kind === 'folder') return folderTo(pathIds(file))
  if (file.kind === 'pdf') return docTo(pdfRef(file.name))
  return file.doc ? docTo(file.doc) : undefined
}

type GroupKey = 'none' | 'type' | 'owner' | 'modified'
type ColumnKey = 'type' | 'owner' | 'location' | 'shared' | 'size' | 'modified'
/** Name is always on, so it sorts without being a column choice. */
type SortColumn = 'name' | ColumnKey

const search = ref('')
const sort = ref<{ column: SortColumn; direction: ListSortDirection }>({
  column: 'name',
  direction: 'asc',
})
const groupBy = ref<GroupKey>('none')
// The grid's tiles already wrap to a single full-width column below ~13rem,
// which reads better on a narrow screen than a table squeezed into rem-sized
// tracks, so mobile opens there instead of List.
const view = ref<'list' | 'grid'>(isMobile.value ? 'grid' : 'list')
const selectionMode = ref(false)
const selection = ref<string[]>([])

// Name carries the row, so it is not a toggle. Owner and Modified are the pair
// a file list is expected to open with; the rest are there when they are
// wanted.
const columns = ref<Record<ColumnKey, boolean>>({
  type: false,
  owner: !isMobile.value,
  location: false,
  shared: false,
  size: false,
  modified: true,
})

const TYPE_LABELS = ['Folder', ...Object.values(DOC_KIND_META).map((m) => m.label)]
const AGE_BUCKETS = ['Today', 'This week', 'This month', 'Older']

// `<component :is="'button'">` resolves the string through the app's component
// registry, where a globally registered Button would hijack the tile. h() with
// a tag string always creates the native element.
const NativeButton = defineComponent({
  setup(_, { slots }) {
    return () => h('button', { type: 'button' }, slots.default?.())
  },
})

const columnTracks = computed(() => [
  'minmax(0,1fr)',
  ...COLUMN_CHOICES.filter((choice) => columns.value[choice.key]).map(
    (choice) => choice.track,
  ),
])

function setColumn(key: ColumnKey, visible: boolean) {
  columns.value = { ...columns.value, [key]: visible }
  if (!visible && sort.value.column === key) {
    sort.value = { column: 'name', direction: 'asc' }
  }
}

const GROUP_CHOICES: { key: GroupKey; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'type', label: 'Type' },
  { key: 'owner', label: 'Owner' },
  { key: 'modified', label: 'Modified' },
]

const COLUMN_CHOICES: { key: ColumnKey; label: string; track: string }[] = [
  { key: 'type', label: 'Type', track: '8rem' },
  { key: 'owner', label: 'Owner', track: '12rem' },
  { key: 'location', label: 'Location', track: '10rem' },
  { key: 'shared', label: 'Shared', track: '7rem' },
  { key: 'size', label: 'Size', track: '6rem' },
  { key: 'modified', label: 'Modified', track: '8rem' },
]

const viewSettings = computed(() => [
  {
    group: 'View',
    options: [
      {
        label: 'List',
        icon: 'lucide-list',
        selected: view.value === 'list',
        onClick: () => (view.value = 'list'),
      },
      {
        label: 'Grid',
        icon: 'lucide-layout-grid',
        selected: view.value === 'grid',
        onClick: () => (view.value = 'grid'),
      },
    ],
  },
  {
    group: 'Group by',
    options: GROUP_CHOICES.map((choice) => ({
      label: choice.label,
      selected: groupBy.value === choice.key,
      onClick: () => (groupBy.value = choice.key),
    })),
  },
  ...(view.value === 'list'
    ? [
        {
          group: 'Columns',
          options: COLUMN_CHOICES.map((choice) => ({
            label: choice.label,
            switch: true,
            switchValue: columns.value[choice.key],
            onClick: (visible: boolean) => setColumn(choice.key, visible),
          })),
        },
      ]
    : []),
])

const bulkActions = computed(() =>
  folder.value === 'trash'
    ? [
        { label: 'Restore', icon: 'lucide-undo-2' },
        { label: 'Delete permanently', icon: 'lucide-trash-2' },
      ]
    : [
        { label: 'Download', icon: 'lucide-download' },
        { label: 'Move', icon: 'lucide-folder-input' },
        { label: 'Share', icon: 'lucide-user-plus' },
        { label: 'Star', icon: 'lucide-star' },
        { label: 'Delete', icon: 'lucide-trash-2' },
      ],
)

const moreOptions = computed(() => [
  {
    label: 'Select rows',
    icon: 'lucide-square-check',
    onClick: () => (selectionMode.value = true),
  },
])

const chain = computed(() => {
  const current = folderPath.value[folderPath.value.length - 1]
  return current ? pathTo(current, workspaceId.value) : []
})

watch(workspaceId, () => {
  if (folderPath.value.length) go('files')
})

const viewLabel = computed(
  () => FOLDERS.find((item) => item.id === folder.value)?.label ?? 'All files',
)

const locationLabel = computed(() =>
  chain.value.length ? chain.value[chain.value.length - 1].name : viewLabel.value,
)

function pathIds(file: FileRow) {
  return pathTo(file.id, workspaceId.value).map((step) => step.id)
}

const crumbs = computed(() => {
  const root = { label: 'Files', route: folderTo([]) }
  if (chain.value.length) {
    return [
      root,
      ...chain.value.map((step) => ({
        label: step.name,
        route: folderTo(pathIds(step)),
      })),
    ]
  }
  if (folder.value === 'all') return [root]
  return [root, { label: viewLabel.value, route: areaTo('files', folder.value) }]
})

watch(
  () => `${workspaceId.value}:${folder.value}:${folderPath.value.join('/')}`,
  () => {
    search.value = ''
    exitSelection()
  },
)

function ageBucket(minutesAgo: number) {
  if (minutesAgo < 60 * 24) return 'Today'
  if (minutesAgo < 60 * 24 * 7) return 'This week'
  if (minutesAgo < 60 * 24 * 30) return 'This month'
  return 'Older'
}

function typeLabel(file: FileRow) {
  return file.kind === 'folder' ? 'Folder' : DOC_KIND_META[file.kind].label
}

function plural(label: string) {
  return `${label}s`
}

function locationOf(file: FileRow) {
  const path = pathTo(file.id, workspaceId.value)
  return path.length > 1 ? path[path.length - 2].name : 'Files'
}

function sizeLabel(file: FileRow) {
  if (file.bytes === undefined) return '–'
  if (file.bytes < 1000) return `${file.bytes} B`
  if (file.bytes < 1000_000) return `${Math.round(file.bytes / 1000)} KB`
  return `${(file.bytes / 1000_000).toFixed(1)} MB`
}

const rows = computed(() =>
  chain.value.length
    ? childrenOf(chain.value[chain.value.length - 1].id, workspaceId.value)
    : filesInView(folder.value || 'all', workspaceId.value),
)

const matched = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return rows.value
  return rows.value.filter((file) => file.name.toLowerCase().includes(query))
})

function directionFor(column: SortColumn) {
  return sort.value.column === column ? sort.value.direction : null
}

const DEFAULT_DIRECTION: Record<SortColumn, ListSortDirection> = {
  name: 'asc',
  type: 'asc',
  owner: 'asc',
  location: 'asc',
  shared: 'desc',
  size: 'desc',
  modified: 'desc',
}

function toggleSort(column: SortColumn) {
  sort.value =
    sort.value.column === column
      ? { column, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: DEFAULT_DIRECTION[column] }
}

function compare(a: FileRow, b: FileRow) {
  const column = sort.value.column
  if (column === 'type') return typeLabel(a).localeCompare(typeLabel(b))
  if (column === 'owner') return a.owner.localeCompare(b.owner)
  if (column === 'location') return locationOf(a).localeCompare(locationOf(b))
  if (column === 'shared') return Number(!!a.shared) - Number(!!b.shared)
  if (column === 'size') return (a.bytes ?? 0) - (b.bytes ?? 0)
  if (column === 'modified') return b.minutesAgo - a.minutesAgo
  return a.name.localeCompare(b.name)
}

const sorted = computed(() =>
  [...matched.value].sort((a, b) => {
    const byKind = rank(a) - rank(b)
    if (byKind) return byKind
    const byColumn = sort.value.direction === 'asc' ? compare(a, b) : -compare(a, b)
    return byColumn || a.name.localeCompare(b.name)
  }),
)

function rank(file: FileRow) {
  return file.kind === 'folder' ? 0 : 1
}

const GROUP_ORDER: Record<GroupKey, string[]> = {
  none: [],
  type: TYPE_LABELS.map(plural),
  owner: [],
  modified: AGE_BUCKETS,
}

function sectionLabel(file: FileRow) {
  if (groupBy.value === 'type') return plural(typeLabel(file))
  if (groupBy.value === 'owner') return file.owner
  return ageBucket(file.minutesAgo)
}

const sections = computed(() => {
  if (groupBy.value === 'none') return [{ label: '', files: sorted.value }]

  const groups = new Map<string, FileRow[]>()
  for (const file of sorted.value) {
    const label = sectionLabel(file)
    const bucket = groups.get(label)
    if (bucket) bucket.push(file)
    else groups.set(label, [file])
  }

  const order = GROUP_ORDER[groupBy.value]
  return [...groups.keys()]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b))
    .map((label) => ({ label, files: groups.get(label)! }))
})

const emptyMessage = computed(() => {
  if (search.value.trim()) return 'No files match the search'
  return chain.value.length
    ? `${locationLabel.value} is empty`
    : `Nothing in ${locationLabel.value.toLowerCase()}`
})

const displayOrder = computed(() =>
  sections.value.flatMap((section) => section.files.map((file) => file.id)),
)

const anchor = ref<string | null>(null)

function rowIdFromEvent(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const tile = target?.closest?.('[data-file-id]')
  if (tile) return tile.getAttribute('data-file-id')

  const row = target?.closest?.('[data-slot="list-row"]')
  const list = row?.closest('[data-slot="list"]')
  if (!row || !list) return null
  const index = [...list.querySelectorAll('[data-slot="list-row"]')].indexOf(row)
  return displayOrder.value[index] ?? null
}

function onListClick(event: MouseEvent) {
  const id = rowIdFromEvent(event)
  if (!id) return

  if (event.shiftKey && selectionMode.value) {
    event.preventDefault()
    event.stopPropagation()
    selectRange(id)
    return
  }

  if (event.metaKey || event.ctrlKey) {
    event.preventDefault()
    event.stopPropagation()
    selectionMode.value = true
    toggleSelection(id)
    anchor.value = id
    return
  }

  if (!selectionMode.value) return

  anchor.value = id
  if (view.value === 'grid') {
    event.preventDefault()
    event.stopPropagation()
    toggleSelection(id)
  }
}

const contextIds = ref<string[]>([])
const contextRow = ref<string | null>(null)
const menuOpen = ref(false)

const highlightedRow = computed(() =>
  menuOpen.value ? (contextRow.value ?? undefined) : undefined,
)

function onListContextMenu(event: MouseEvent) {
  const id = rowIdFromEvent(event)
  if (!id) {
    event.stopPropagation()
    return
  }
  contextIds.value = selection.value.includes(id) ? [...selection.value] : [id]
  contextRow.value = id
}

const contextMenuOptions = computed(() => {
  const count = contextIds.value.length
  const suffix = count > 1 ? ` ${count} items` : ''
  const noop = () => {}

  if (folder.value === 'trash') {
    return [
      { label: `Restore${suffix}`, icon: 'lucide-undo-2', onClick: noop },
      { label: `Delete permanently${suffix}`, icon: 'lucide-trash-2', onClick: noop },
    ]
  }

  return [
    ...(count > 1
      ? []
      : [
          { label: 'Open', icon: 'lucide-external-link', onClick: noop },
          { label: 'Rename', icon: 'lucide-pencil', onClick: noop },
        ]),
    { label: `Download${suffix}`, icon: 'lucide-download', onClick: noop },
    { label: `Move${suffix}`, icon: 'lucide-folder-input', onClick: noop },
    { label: `Share${suffix}`, icon: 'lucide-user-plus', onClick: noop },
    { label: `Star${suffix}`, icon: 'lucide-star', onClick: noop },
    { label: `Delete${suffix}`, icon: 'lucide-trash-2', onClick: noop },
  ]
})

function onListMousedown(event: MouseEvent) {
  if (event.shiftKey) event.preventDefault()
}

function toggleSelection(id: string) {
  selection.value = selection.value.includes(id)
    ? selection.value.filter((value) => value !== id)
    : [...selection.value, id]
}

function selectRange(id: string) {
  const ids = displayOrder.value
  const end = ids.indexOf(id)
  const start = anchor.value ? ids.indexOf(anchor.value) : -1
  const from = start === -1 ? end : start
  const [lo, hi] = from <= end ? [from, end] : [end, from]
  selection.value = ids.slice(lo, hi + 1)
}

function exitSelection() {
  selectionMode.value = false
  selection.value = []
  anchor.value = null
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !selectionMode.value) return
  if (document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]')) return
  exitSelection()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function fileIcon(file: FileRow) {
  if (file.kind === 'folder') return 'lucide-folder text-ink-gray-6'
  const meta = DOC_KIND_META[file.kind]
  return `${meta.icon} ${meta.tint}`
}

function tileClass(file: FileRow) {
  if (selection.value.includes(file.id) || highlightedRow.value === file.id) {
    return 'border-outline-gray-3 bg-surface-gray-2'
  }
  return 'border-outline-gray-1 bg-surface-base hover:bg-surface-gray-1'
}
</script>
