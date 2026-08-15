<!--
  PROTOTYPE — remove. Fake Files list. It shows either a sidebar saved view or
  one folder's contents, walking the fixture tree from the path in the URL.
-->
<template>
  <PageHeader>
    <Breadcrumbs :items="crumbs" />
    <NewMenu />
  </PageHeader>

  <div class="px-5 py-4">
    <!-- Both bars are h-7, so entering selection mode swaps the controls
         without moving the list underneath. -->
    <div class="flex h-7 items-center justify-between gap-2">
      <template v-if="selectionMode">
        <div class="flex items-center gap-2">
          <span class="pr-1 text-base text-ink-gray-7">
            {{ selection.length }} selected
          </span>
          <!-- Prototype: every bulk action is a no-op. -->
          <Button
            v-for="action in bulkActions"
            :key="action.label"
            :label="action.label"
            :icon-left="action.icon"
            :disabled="!selection.length"
            @click="() => {}"
          />
        </div>
        <Button variant="solid" label="Done" @click="exitSelection" />
      </template>

      <template v-else>
        <TextInput
          v-model="search"
          placeholder="Search files"
          class="w-64"
          aria-label="Search files"
        >
          <template #prefix>
            <span class="lucide-search size-4" aria-hidden="true" />
          </template>
        </TextInput>

        <div class="flex items-center gap-2">
          <Popover align="end">
            <!-- PopoverTrigger is as-child, so it wires the click itself; an
                 extra @click here would toggle twice and never open. -->
            <template #trigger>
              <Button label="Filter" icon-left="lucide-list-filter">
                <template v-if="chips.length" #suffix>
                  <Badge
                    theme="gray"
                    variant="solid"
                    :label="String(chips.length)"
                  />
                </template>
              </Button>
            </template>

            <div class="w-80 p-3">
              <div
                v-for="field in FILTER_FIELDS"
                :key="field.field"
                class="flex items-center gap-3 pb-2 last:pb-0"
              >
                <span class="w-20 shrink-0 text-base text-ink-gray-6">
                  {{ field.label }}
                </span>
                <Select
                  :model-value="filters[field.field] ?? ''"
                  :options="valueOptions(field)"
                  :aria-label="field.label"
                  class="flex-1"
                  @update:model-value="setFilter(field.field, $event)"
                />
              </div>
            </div>
          </Popover>

          <Dropdown :options="groupOptions" align="end">
            <Button :label="groupLabel" icon-left="lucide-rows-3" />
          </Dropdown>
          <Dropdown :options="moreOptions" align="end">
            <Button icon="lucide-ellipsis" aria-label="More actions" />
          </Dropdown>
        </div>
      </template>
    </div>

    <!-- The filter panel hides its conditions behind a click, so the active
         ones also read as chips here; clicking a chip drops that condition. -->
    <div v-if="chips.length" class="flex flex-wrap items-center gap-2 pt-3">
      <Button
        v-for="chip in chips"
        :key="chip.field"
        :label="chip.label"
        icon-right="lucide-x"
        @click="removeFilter(chip.field)"
      />
      <Button variant="ghost" label="Clear all" @click="filters = {}" />
    </div>

    <!-- One trigger around the whole list, not one per row: as-child stamps
         reka's own `data-state` on the trigger, which on a row would overwrite
         the List family's `data-state="selected"`. -->
    <ContextMenu :options="contextMenuOptions">
      <!-- list-row-px-3 puts the column header, the group headers and the rows on
           one content inset, so nothing drifts against the row hover surface. -->
      <List
        v-model:selection="selection"
        :selectable="selectionMode"
        :columns="['minmax(0,1fr)', '12rem', '8rem']"
        :row-height="40"
        class="mt-3 list-row-px-3"
        @click.capture="onListClick"
        @mousedown="onListMousedown"
        @contextmenu.capture="onListContextMenu"
      >
        <ListHeader>
          <ListHeaderCellSort
            :direction="directionFor('name')"
            @click="toggleSort('name')"
          >
            Name
          </ListHeaderCellSort>
          <ListHeaderCellSort
            :direction="directionFor('owner')"
            @click="toggleSort('owner')"
          >
            Owner
          </ListHeaderCellSort>
          <!-- align="end" right-aligns the cell and moves the sort glyph to the
               leading side, so the label stays flush with the column edge. -->
          <ListHeaderCellSort
            align="end"
            :direction="directionFor('modified')"
            @click="toggleSort('modified')"
          >
            Modified
          </ListHeaderCellSort>
        </ListHeader>

        <!-- Renders nothing: it exists to hand the List the full set of row values
             so the header's select-all knows its universe. The rows themselves are
             a v-for, because ListRows cannot straddle the ListGroup wrappers. -->
        <ListRows :items="sorted" row-key="id" />

        <!-- Ungrouped, the wrapper drops to a plain div: one flat run of rows
             with no group heading and no rowgroup semantics. -->
        <component
          :is="section.label ? ListGroup : 'div'"
          v-for="section in sections"
          :key="section.label || 'flat'"
          :label="section.label || undefined"
        >
          <!-- Folders navigate, so they render as real links (middle-click, back
               and forward all work). The no-op keeps file rows rendering as
               buttons, so they still take hover and focus; opening a document is
               out of scope. Modified clicks are claimed by the List's capture
               handler before they reach here. -->
          <ListRow
            v-for="file in section.files"
            :key="file.id"
            :value="file.id"
            :to="file.kind === 'folder' ? folderTo(pathIds(file)) : undefined"
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
            <ListCell>
              <Avatar
                size="xs"
                :label="file.owner"
                :image="PEOPLE[file.owner]"
                class="mr-2 shrink-0"
              />
              <span class="truncate text-base text-ink-gray-7">{{ file.owner }}</span>
            </ListCell>
            <ListCell class="justify-end">
              <span class="truncate text-base text-ink-gray-5">{{ file.modified }}</span>
            </ListCell>
          </ListRow>
        </component>

        <div
          v-if="!sorted.length"
          class="flex flex-col items-center justify-center gap-2 py-16"
        >
          <span class="lucide-folder-open size-6 text-ink-gray-4" aria-hidden="true" />
          <span class="text-base text-ink-gray-5">{{ emptyMessage }}</span>
        </div>
      </List>
    </ContextMenu>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  ContextMenu,
  Dropdown,
  PageHeader,
  Popover,
  Select,
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
  OWNERS,
  PEOPLE,
  childrenOf,
  filesInView,
  pathTo,
  type FileRow,
} from '../fixtures'
import NewMenu from '../parts/NewMenu.vue'
import { useShellNav } from '../useShellNav'

const { folder, folderPath, areaTo, folderTo } = useShellNav()

type SortColumn = 'name' | 'owner' | 'modified'
type GroupKey = 'none' | 'type' | 'owner' | 'modified'

/** Field id → chosen value. A missing or empty value means "no condition". */
type Filters = Record<string, string>

const search = ref('')
const filters = ref<Filters>({})
const sort = ref<{ column: SortColumn; direction: ListSortDirection }>({
  column: 'name',
  direction: 'asc',
})
const groupBy = ref<GroupKey>('none')
const selectionMode = ref(false)
const selection = ref<string[]>([])

const TYPE_LABELS = ['Folder', ...Object.values(DOC_KIND_META).map((m) => m.label)]
const AGE_BUCKETS = ['Today', 'This week', 'This month', 'Older']

// The library ships ListFilter, but it reads DocFields, renders its value
// picker against a real doctype endpoint, and is built on the deprecated
// Autocomplete — it logs three deprecation warnings and fails to resolve its
// own Button outside a globally registered FrappeUI app. So the panel is a
// Popover of Selects instead; both are current components.
const FILTER_FIELDS = [
  { field: 'kind', label: 'Type', values: TYPE_LABELS },
  { field: 'owner', label: 'Owner', values: OWNERS },
  { field: 'age', label: 'Modified', values: AGE_BUCKETS },
  { field: 'starred', label: 'Starred', values: ['Yes', 'No'] },
  { field: 'shared', label: 'Shared', values: ['Yes', 'No'] },
]

type FilterField = (typeof FILTER_FIELDS)[number]

function valueOptions(field: FilterField) {
  return [
    { label: 'Any', value: '' },
    ...field.values.map((value) => ({ label: value, value })),
  ]
}

function setFilter(field: string, value: string | number | undefined) {
  filters.value = { ...filters.value, [field]: String(value ?? '') }
}

const GROUP_CHOICES: { key: GroupKey; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'type', label: 'Type' },
  { key: 'owner', label: 'Owner' },
  { key: 'modified', label: 'Modified' },
]

// The button carries the current grouping, so an active grouping is readable
// without opening the menu.
const groupLabel = computed(() => {
  if (groupBy.value === 'none') return 'Group by'
  const choice = GROUP_CHOICES.find((item) => item.key === groupBy.value)
  return `Grouped by ${choice!.label.toLowerCase()}`
})

const groupOptions = computed(() =>
  GROUP_CHOICES.map((choice) => ({
    label: choice.label,
    selected: groupBy.value === choice.key,
    onClick: () => (groupBy.value = choice.key),
  })),
)

// Trash holds deleted rows, so moving or sharing them reads as broken; it gets
// its own pair instead. Sort stays reachable in the column headers while
// selecting — only the toolbar controls are replaced.
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

// Derived from the tree, not from the URL, so a hand-typed or truncated path
// still resolves to the real ancestor chain.
const chain = computed(() => {
  const current = folderPath.value[folderPath.value.length - 1]
  return current ? pathTo(current) : []
})

const viewLabel = computed(
  () => FOLDERS.find((item) => item.id === folder.value)?.label ?? 'All files',
)

const locationLabel = computed(() =>
  chain.value.length ? chain.value[chain.value.length - 1].name : viewLabel.value,
)

function pathIds(file: FileRow) {
  return pathTo(file.id).map((step) => step.id)
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

// A query and a set of conditions belong to the place they were set. Carrying
// them into the next folder makes that folder look half empty, and a selection
// of rows you can no longer see is worse.
watch(
  () => `${folder.value}:${folderPath.value.join('/')}`,
  () => {
    search.value = ''
    filters.value = {}
    exitSelection()
  },
)

/** Buckets both the Modified filter and the Modified grouping, so they agree. */
function ageBucket(minutesAgo: number) {
  if (minutesAgo < 60 * 24) return 'Today'
  if (minutesAgo < 60 * 24 * 7) return 'This week'
  if (minutesAgo < 60 * 24 * 30) return 'This month'
  return 'Older'
}

function typeLabel(file: FileRow) {
  return file.kind === 'folder' ? 'Folder' : DOC_KIND_META[file.kind].label
}

/** The value a filter condition compares against, in the option's own wording. */
function fieldValue(file: FileRow, field: string) {
  if (field === 'kind') return typeLabel(file)
  if (field === 'owner') return file.owner
  if (field === 'age') return ageBucket(file.minutesAgo)
  if (field === 'starred') return file.starred ? 'Yes' : 'No'
  if (field === 'shared') return file.shared ? 'Yes' : 'No'
  return ''
}

const chips = computed(() =>
  FILTER_FIELDS.filter((field) => filters.value[field.field]).map((field) => ({
    field: field.field,
    label: `${field.label}: ${filters.value[field.field]}`,
  })),
)

function removeFilter(field: string) {
  setFilter(field, '')
}

const rows = computed(() =>
  chain.value.length
    ? childrenOf(chain.value[chain.value.length - 1].id)
    : filesInView(folder.value || 'all'),
)

const matched = computed(() => {
  const query = search.value.trim().toLowerCase()
  const conditions = Object.entries(filters.value).filter(([, value]) => value)
  return rows.value.filter((file) => {
    if (query && !file.name.toLowerCase().includes(query)) return false
    return conditions.every(([field, value]) => fieldValue(file, field) === value)
  })
})

function directionFor(column: SortColumn) {
  return sort.value.column === column ? sort.value.direction : null
}

// A fresh column starts in the direction that reads right for it: names and
// owners A–Z, dates newest first.
const DEFAULT_DIRECTION: Record<SortColumn, ListSortDirection> = {
  name: 'asc',
  owner: 'asc',
  modified: 'desc',
}

function toggleSort(column: SortColumn) {
  sort.value =
    sort.value.column === column
      ? { column, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: DEFAULT_DIRECTION[column] }
}

/** Ascending order for a column. Ascending on Modified means oldest first. */
function compare(a: FileRow, b: FileRow) {
  if (sort.value.column === 'owner') return a.owner.localeCompare(b.owner)
  if (sort.value.column === 'modified') return b.minutesAgo - a.minutesAgo
  return a.name.localeCompare(b.name)
}

// Folders read above documents whatever the sort, the convention every file
// browser follows — including inside a group.
const sorted = computed(() =>
  [...matched.value].sort((a, b) => {
    const byKind = rank(a) - rank(b)
    if (byKind) return byKind
    return sort.value.direction === 'asc' ? compare(a, b) : -compare(a, b)
  }),
)

function rank(file: FileRow) {
  return file.kind === 'folder' ? 0 : 1
}

// Groups a filtered, sorted list rather than re-deriving it, so the three
// controls compose instead of each owning its own pass over the rows.
const GROUP_ORDER: Record<GroupKey, string[]> = {
  none: [],
  type: ['Folders', 'Files'],
  owner: [],
  modified: ['Today', 'This week', 'This month', 'Older'],
}

function sectionLabel(file: FileRow) {
  if (groupBy.value === 'type') return file.kind === 'folder' ? 'Folders' : 'Files'
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

  // Fixed order where the buckets have one (type, date); alphabetical where
  // they are open-ended (owner), since indexOf returns -1 for every label.
  const order = GROUP_ORDER[groupBy.value]
  return [...groups.keys()]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b))
    .map((label) => ({ label, files: groups.get(label)! }))
})

const emptyMessage = computed(() => {
  if (search.value.trim() || chips.value.length) return 'No files match the filters'
  return chain.value.length
    ? `${locationLabel.value} is empty`
    : `Nothing in ${locationLabel.value.toLowerCase()}`
})

// Rows in the order they are on screen, after filtering, sorting and grouping.
// Shift-ranges measure against this, so a range crosses group boundaries the
// way it looks like it should.
const displayOrder = computed(() =>
  sections.value.flatMap((section) => section.files.map((file) => file.id)),
)

/** Anchor for Shift-ranges: the last row clicked without Shift. */
const anchor = ref<string | null>(null)

// The row's own value is not on the DOM node, but the rows render in
// `displayOrder`, so the node's position in the list is its index.
function rowIdFromEvent(event: MouseEvent) {
  const row = (event.target as HTMLElement | null)?.closest?.(
    '[data-slot="list-row"]',
  )
  const list = row?.closest('[data-slot="list"]')
  if (!row || !list) return null
  const index = [...list.querySelectorAll('[data-slot="list-row"]')].indexOf(row)
  return displayOrder.value[index] ?? null
}

// Capture phase, so a modified click is claimed before ListRow turns it into a
// plain toggle — ListRow owns the click once the list is selectable.
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
    // The row may be an <a>; without this the modified click opens a new tab.
    event.preventDefault()
    event.stopPropagation()
    selectionMode.value = true
    toggleSelection(id)
    anchor.value = id
    return
  }

  // A plain click in selection mode is ListRow's to handle; this only records
  // where the next Shift+click should measure from.
  if (selectionMode.value) anchor.value = id
}

// What the context menu acts on. Right-clicking a selected row targets the
// whole selection; right-clicking any other row targets that row alone, the
// way every file manager behaves.
const contextIds = ref<string[]>([])

// Capture phase, so the target is settled before ContextMenuTrigger opens the
// menu. Anything that is not a row — the column header, a group header, the
// empty state — is stopped here, so the trigger never sees it and the browser's
// own menu survives outside the rows.
function onListContextMenu(event: MouseEvent) {
  const id = rowIdFromEvent(event)
  if (!id) {
    event.stopPropagation()
    return
  }
  contextIds.value = selection.value.includes(id) ? [...selection.value] : [id]
}

// Prototype: every context action is a no-op. Open and Rename are dropped for
// a multi-row target, where neither has a meaning.
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
  // Shift+mousedown otherwise extends the browser's own text selection across
  // the rows it passes over.
  if (event.shiftKey) event.preventDefault()
}

function toggleSelection(id: string) {
  selection.value = selection.value.includes(id)
    ? selection.value.filter((value) => value !== id)
    : [...selection.value, id]
}

// The anchor stays put across repeated Shift+clicks, so the second one moves
// the end of the range instead of starting a new one.
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
  // Esc belongs to whatever is on top first — the context menu, a dropdown, the
  // filter panel. Leaving selection mode is what it means once nothing is open.
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
</script>
