<template>
  <!-- Presses here can draw a selection rectangle, and right-clicks open the
       page's context menu. The listing fills the pane, so its empty space below
       the last item takes both.
       A new sort reorders the rows in place. The browser's scroll anchoring
       would follow the top row to its new place and move the page, so no row
       is an anchor. -->
  <div
    ref="listing"
    class="relative pt-3 [overflow-anchor:none]"
    @keydown="onKeydown"
    @pointerdown="onPointerdown"
    @contextmenu="onContextMenu"
  >
    <!-- The root holds the gap above every state, so the listing does not move
         when the skeleton gives way to rows, an empty state or an error. -->
    <!-- A fast load shows nothing rather than a skeleton that flashes. -->
    <div v-if="loading && !showSkeleton" aria-busy="true" />
    <div
      v-else-if="!loading && query.error && !query.rows.length"
      class="flex flex-col items-center gap-3 py-16"
    >
      <ErrorMessage :message="query.error?.message" />
      <Button label="Retry" @click="query.refetch()" />
    </div>
    <div
      v-else-if="!loading && !query.rows.length"
      class="flex flex-col items-center justify-center gap-2 py-16 text-center"
    >
      <span class="lucide-folder-open size-6 text-ink-gray-4" aria-hidden="true" />
      <p class="text-base text-ink-gray-5">{{ emptyTitle }}</p>
      <p class="text-p-sm text-ink-gray-5">{{ emptyDescription }}</p>
      <slot name="empty-action" />
    </div>

    <template v-else-if="presentation.view === 'list'">
      <!-- Selection is drawn here, not by the List's own checkbox column: that
           column pushes every name 32px right, and its checkboxes carry no name.
           In selection mode the checkbox takes the type icon's place instead. -->
      <!-- `-mx-3` pulls the rows out by their own padding, so names and dividers line up
           with the toolbar and the hover background reaches into the pane's padding. -->
      <List
        :columns="columnTracks"
        :row-height="40"
        class="-mx-3 list-row-px-3"
        :aria-busy="loading || undefined"
      >
        <ListHeader>
          <div class="flex min-w-0 items-center">
            <span
              v-if="selectionMode"
              role="checkbox"
              :aria-checked="allSelected ? 'true' : someSelected ? 'mixed' : 'false'"
              aria-label="Select all"
              tabindex="0"
              class="mr-2 flex size-4 shrink-0 cursor-pointer items-center rounded-1 focus-visible:focus-ring"
              @click="toggleAll"
              @keydown.enter.prevent="toggleAll"
              @keydown.space.prevent="toggleAll"
            >
              <Checkbox
                :model-value="allSelected"
                :indeterminate="someSelected"
                tabindex="-1"
                aria-hidden="true"
                class="pointer-events-none"
              />
            </span>
            <component :is="headerCell" v-bind="headerProps('title')">Name</component>
          </div>
          <component
            :is="headerCell"
            v-if="shows('kind')"
            :class="wideOnly('kind')"
            v-bind="headerProps('kind')"
            >Type</component
          >
          <component
            :is="headerCell"
            v-if="shows('owner')"
            :class="wideOnly('owner')"
            v-bind="headerProps('owner')"
            >Owner</component
          >
          <component
            :is="headerCell"
            v-if="shows('size')"
            :class="wideOnly('size')"
            v-bind="headerProps('size', 'end')"
            >Size</component
          >
          <component
            :is="headerCell"
            v-if="shows('modified')"
            :class="wideOnly('modified')"
            v-bind="headerProps('modified', 'end')"
            >{{ byOpened ? 'Opened' : 'Modified' }}</component
          >
          <ListHeaderCell><span class="sr-only">Actions</span></ListHeaderCell>
        </ListHeader>
        <!-- Placeholder rows share the real rows' tracks, so nothing moves when data arrives. -->
        <template v-if="loading">
          <ListRow v-for="(width, index) in SKELETON_NAMES" :key="index" aria-hidden="true">
            <ListCell>
              <Skeleton class="mr-2 size-4 shrink-0 rounded-1" :class="SKELETON_BAR" />
              <Skeleton class="h-2 max-w-full rounded-full" :class="[SKELETON_BAR, width]" />
            </ListCell>
            <ListCell v-if="shows('kind')" :class="wideOnly('kind')" />
            <ListCell v-if="shows('owner')" :class="wideOnly('owner')" />
            <ListCell v-if="shows('size')" :class="wideOnly('size')" />
            <ListCell v-if="shows('modified')" class="justify-end" :class="wideOnly('modified')">
              <Skeleton
                class="h-2 rounded-full"
                :class="[SKELETON_BAR, index % 3 ? 'w-14' : 'w-10']"
              />
            </ListCell>
            <ListCell />
          </ListRow>
        </template>
        <template v-else>
          <ListRow
            v-for="(row, index) in rows"
            :key="row.name"
            :value="row.name"
            tabindex="0"
            :data-node="row.name"
            :data-listing-item="row.name"
            :class="['select-none', runClasses(index)]"
            v-bind="rowDrop?.(row) ?? {}"
            @click="onRowClick($event, row)"
            @dblclick="$emit('open', row)"
            @pointerdown="startLongPress($event, row)"
            @pointerup="cancelLongPress"
            @pointercancel="cancelLongPress"
          >
            <ListCell>
              <!-- Clicks fall through to the row, which toggles in selection mode. -->
              <span
                v-if="selectionMode"
                role="checkbox"
                :aria-checked="isSelected(row)"
                :aria-label="`Select ${row.title}`"
                tabindex="0"
                class="mr-2 flex size-4 shrink-0 items-center rounded-1 focus-visible:focus-ring"
                @keydown.enter.prevent.stop="$emit('select', row, $event.shiftKey)"
                @keydown.space.prevent.stop="$emit('select', row, $event.shiftKey)"
              >
                <Checkbox
                  :model-value="isSelected(row)"
                  tabindex="-1"
                  aria-hidden="true"
                  class="pointer-events-none"
                />
              </span>
              <span
                v-else
                class="mr-2 size-4 shrink-0"
                :class="[nodeIcon(row), nodeIconTint(row)]"
                aria-hidden="true"
              />
              <span class="min-w-0 truncate text-base text-ink-gray-8" :title="row.title">{{
                row.title
              }}</span>
              <span
                v-if="row.favourite"
                class="lucide-star ml-1.5 size-3.5 shrink-0 text-ink-amber-6"
                aria-hidden="true"
              />
              <span v-if="showBreadcrumbs" class="ml-2 truncate text-p-sm text-ink-gray-5">{{
                breadcrumbText(row)
              }}</span>
            </ListCell>
            <ListCell v-if="shows('kind')" :class="wideOnly('kind')"
              ><span class="truncate text-base text-ink-gray-7">{{
                nodeTypeLabel(row)
              }}</span></ListCell
            >
            <ListCell v-if="shows('owner')" :class="wideOnly('owner')">
              <Avatar
                size="xs"
                :image="row.owner.user_image ?? undefined"
                :label="row.owner.full_name"
                class="mr-2 shrink-0"
              />
              <span class="truncate text-base text-ink-gray-7">{{ row.owner.full_name }}</span>
            </ListCell>
            <ListCell v-if="shows('size')" class="justify-end" :class="wideOnly('size')"
              ><span class="truncate text-base text-ink-gray-5">{{
                row.size ? formatBytes(row.size) : ''
              }}</span></ListCell
            >
            <ListCell v-if="shows('modified')" class="justify-end" :class="wideOnly('modified')"
              ><span class="truncate text-base text-ink-gray-5">{{ rowDate(row) }}</span></ListCell
            >
            <ListCell class="justify-end">
              <Dropdown :options="menuOptions(row)" align="end">
                <Button
                  icon="lucide-ellipsis"
                  variant="ghost"
                  :aria-label="`Actions for ${row.title}`"
                  @click.stop
                />
              </Dropdown>
            </ListCell>
          </ListRow>
        </template>
      </List>
    </template>

    <template v-else>
      <section v-if="loading" aria-busy="true">
        <div
          class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-3"
          aria-hidden="true"
        >
          <!-- The plain card's box: icon, then the name and meta lines, with the bar on the name line. -->
          <div
            v-for="(width, index) in SKELETON_CARD_NAMES"
            :key="index"
            class="flex aspect-[1.7] flex-col items-start justify-between gap-3 rounded-5 border border-outline-gray-1 bg-surface-elevation-1 p-3"
          >
            <Skeleton class="size-4.5 rounded-1" :class="SKELETON_BAR" />
            <span class="flex h-8 w-full items-start pt-1.5">
              <Skeleton class="h-2 max-w-full rounded-full" :class="[SKELETON_BAR, width]" />
            </span>
          </div>
        </div>
      </section>
      <section v-else>
        <div
          class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-3"
          role="list"
        >
          <div
            v-for="row in rows"
            :key="row.name"
            role="listitem"
            class="flex min-w-0"
            :data-listing-item="row.name"
            v-bind="rowDrop?.(row) ?? {}"
          >
            <FileCard
              :node="row"
              :meta="cardMeta(row)"
              :selected="isHighlighted(row)"
              @click="onRowClick($event, row)"
              @dblclick="$emit('open', row)"
              @pointerdown="startLongPress($event, row)"
              @pointerup="cancelLongPress"
              @pointercancel="cancelLongPress"
              @preview-error="$emit('preview-error', row)"
            >
              <template v-if="showBreadcrumbs" #meta>
                <span class="lucide-folder size-3 shrink-0" aria-hidden="true" />
                <span class="truncate" :title="breadcrumbText(row)">{{ folderOf(row) }}</span>
              </template>
              <!-- Inside the card's button, so the corner it covers still toggles. -->
              <Checkbox
                v-if="selectionMode"
                :model-value="isSelected(row)"
                tabindex="-1"
                aria-hidden="true"
                class="pointer-events-none absolute end-3 top-3"
              />
              <template #actions="{ onImage }">
                <Dropdown v-if="!selectionMode" :options="menuOptions(row)" align="end">
                  <!-- Over a thumbnail the button gets a dark backdrop, so it reads on any image. -->
                  <Button
                    class="absolute end-2 top-2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/card:opacity-100 [@media(hover:hover)]:group-focus-within/card:opacity-100 [@media(hover:hover)]:data-[state=open]:opacity-100"
                    :class="[
                      onImage && '!bg-black/30 !text-white backdrop-blur-sm hover:!bg-black/50',
                      isHighlighted(row) && '[@media(hover:hover)]:opacity-100',
                    ]"
                    icon="lucide-ellipsis"
                    variant="ghost"
                    :aria-label="`Actions for ${row.title}`"
                    @click.stop
                  />
                </Dropdown>
              </template>
            </FileCard>
          </div>
        </div>
      </section>
    </template>

    <Alert
      v-if="query.error && query.rows.length"
      class="mt-3"
      theme="amber"
      title="Could not refresh files"
      description="The files already loaded are still shown."
    />
    <div ref="sentinel" class="flex min-h-12 items-center justify-center py-3">
      <LoadingIndicator v-if="query.isFetchingNext" />
      <Button
        v-else-if="query.error && query.rows.length"
        label="Retry loading more"
        @click="loadMore"
      />
    </div>
    <div
      v-if="marqueeBox"
      class="pointer-events-none absolute z-10 rounded-2 border border-outline-blue-3 bg-surface-blue-2/50"
      :style="{
        left: `${marqueeBox.left}px`,
        top: `${marqueeBox.top}px`,
        width: `${marqueeBox.right - marqueeBox.left}px`,
        height: `${marqueeBox.bottom - marqueeBox.top}px`,
      }"
      aria-hidden="true"
    />
  </div>
</template>

<script setup lang="ts">
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  Dropdown,
  ErrorMessage,
  LoadingIndicator,
  Skeleton,
  type DropdownItem,
} from 'frappe-ui'
import {
  List,
  ListCell,
  ListHeader,
  ListHeaderCell,
  ListHeaderCellSort,
  ListRow,
} from 'frappe-ui/list'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { InfiniteQueryState } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'
import { formatBytes, formatModified } from '@/apps/drive/files/internal/format'
import { nodeIcon, nodeIconTint, nodeTypeLabel } from '@/apps/drive/files/internal/icons'
import { useLocationTitle } from '@/apps/drive/files/internal/locations'
import { useSession } from '@/platform/session'

import FileCard from './FileCard.vue'
import { loadUntilVisible } from './listingWindows'
import type { FilesDateColumn, FilesSort, PresentationState } from './presentation'
import type { DropHandlers } from './uploads/drop'
import { LISTING_ITEM, useMarquee } from './useMarquee'

const props = defineProps<{
  query: InfiniteQueryState<DriveNode>
  presentation: PresentationState
  selection: string[]
  selectionMode: boolean
  emptyTitle: string
  emptyDescription: string
  showBreadcrumbs?: boolean
  /** False where the server fixes the order (search, Recent, Starred…): headers then only label. */
  sortable?: boolean
  menuOptions: (node: DriveNode) => DropdownItem[]
  /** Drop handlers for a row that takes dropped files. `null` leaves the drop to the pane. */
  rowDrop?: (node: DriveNode) => DropHandlers | null
  /** The item whose right-click menu is open. It looks selected while the menu shows. */
  menuTarget?: string | null
  dateColumn?: FilesDateColumn
}>()
const emit = defineEmits<{
  'update:selection': [value: string[]]
  sort: [column: FilesSort]
  open: [node: DriveNode]
  select: [node: DriveNode, range: boolean]
  /**
   * A right-click: on an item, or on empty space (`null`). The menu opens unless
   * a listener stops the event, which leaves the browser's own menu.
   */
  menu: [node: DriveNode | null, event: MouseEvent]
  'preview-error': [node: DriveNode]
}>()
const listing = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let longPress: ReturnType<typeof setTimeout> | null = null
let longPressFired = false
/** The last press came from touch or a pen, not a mouse. */
let touchPress = false
const session = useSession()
const locationTitle = useLocationTitle()
const { box: marqueeBox, onPointerdown: startMarquee } = useMarquee({
  area: listing,
  selection: () => props.selection,
  select: (ids) => emit('update:selection', ids),
  onStart() {
    // A drag is not a long press, and the click it ends with is swallowed.
    cancelLongPress()
    longPressFired = false
  },
  onEmptyClick() {
    if (props.selection.length) emit('update:selection', [])
  },
})

/** Faint enough to read as structure, not content. */
const SKELETON_BAR = '!bg-surface-gray-2 motion-reduce:animate-none'
/** Name bar widths, varied so the placeholder reads as a list of names. */
const SKELETON_NAMES = [
  'w-40',
  'w-28',
  'w-52',
  'w-36',
  'w-24',
  'w-44',
  'w-32',
  'w-48',
  'w-28',
  'w-36',
]
/** Cards are narrow on a phone, so their bars are a share of the card. */
const SKELETON_CARD_NAMES = [
  'w-3/4',
  'w-1/2',
  'w-2/3',
  'w-2/5',
  'w-4/5',
  'w-3/5',
  'w-1/2',
  'w-2/3',
  'w-3/4',
  'w-2/5',
]
const SKELETON_DELAY = 180

const loading = computed(() => props.query.status === 'pending' && !props.query.rows.length)
const showSkeleton = ref(false)
let skeletonTimer: ReturnType<typeof setTimeout> | undefined
watch(
  loading,
  (isLoading) => {
    clearTimeout(skeletonTimer)
    showSkeleton.value = false
    if (isLoading)
      skeletonTimer = setTimeout(() => {
        showSkeleton.value = true
      }, SKELETON_DELAY)
  },
  { immediate: true },
)
const rows = computed(() => props.query.rows)
const COLUMN_TRACKS: Record<string, string> = {
  owner: '12rem',
  modified: '8rem',
  kind: '8rem',
  size: '6rem',
}
/** Columns a phone has no room for. Name takes their width. */
const WIDE_ONLY = new Set(['owner', 'modified', 'kind'])
const columns = computed(() => props.presentation.columns)
const columnTracks = computed(() => {
  const tracks = (list: string[]) => [
    'minmax(0,1fr)',
    ...list.map((column) => COLUMN_TRACKS[column] ?? '8rem'),
    '2.5rem',
  ]
  return {
    base: tracks(columns.value.filter((column) => !WIDE_ONLY.has(column))),
    md: tracks(columns.value),
  }
})
const byOpened = computed(() => props.dateColumn === 'opened')
const headerCell = computed(() => (props.sortable === false ? ListHeaderCell : ListHeaderCellSort))
const allSelected = computed(() => rows.value.length > 0 && rows.value.every(isSelected))
const someSelected = computed(() => !allSelected.value && rows.value.some(isSelected))

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) void loadMore()
    },
    { rootMargin: '240px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelLongPress()
  clearTimeout(skeletonTimer)
})

function shows(column: string) {
  return columns.value.includes(column)
}
function wideOnly(column: string) {
  return WIDE_ONLY.has(column) ? 'hidden md:flex' : undefined
}
function isSelected(row: DriveNode) {
  return props.selection.includes(row.name)
}
function isHighlighted(row: DriveNode) {
  return isSelected(row) || row.name === props.menuTarget
}
/** Hides the divider a list row draws along its top edge. */
const NO_DIVIDER = '[&_[data-slot=list-divider]]:!opacity-0'
/**
 * Consecutive highlighted rows read as one block: only the block's outer
 * corners are rounded, and no divider shows inside it or along its edges. A
 * focused row takes back all four corners, so its focus ring stays rounded.
 */
function runClasses(index: number) {
  const highlighted = (at: number) => {
    const row = rows.value[at]
    return row !== undefined && isHighlighted(row)
  }
  const prevHighlighted = highlighted(index - 1)
  if (!highlighted(index)) return prevHighlighted ? NO_DIVIDER : undefined
  return [
    '!bg-surface-gray-2',
    NO_DIVIDER,
    prevHighlighted && 'sm:!rounded-t-none',
    highlighted(index + 1) && 'sm:!rounded-b-none',
    'sm:focus-visible:!rounded-[10px]',
  ]
}
function toggleAll() {
  const names = new Set(rows.value.map((row) => row.name))
  emit(
    'update:selection',
    allSelected.value
      ? props.selection.filter((name) => !names.has(name))
      : [...new Set([...props.selection, ...names])],
  )
}
function headerProps(column: FilesSort, align?: 'end') {
  // The sort cell's label type lives on its button, so a plain cell repeats it.
  if (props.sortable === false)
    return { class: ['text-sm-medium text-ink-gray-5', align === 'end' && 'justify-end'] }
  return {
    align,
    direction: props.presentation.sort === column ? props.presentation.dir : null,
    onClick: () => emit('sort', column),
  }
}
function rowDate(row: DriveNode) {
  return formatModified(byOpened.value ? (row.opened_at ?? null) : row.modified)
}
function folderOf(row: DriveNode) {
  const parent = row.breadcrumbs?.at(-1)
  return parent ? locationTitle(parent) : ''
}
function breadcrumbText(row: DriveNode) {
  return row.breadcrumbs?.map(locationTitle).join(' / ') ?? ''
}
/** Who owns a card's file, when it is not the user, and its listing date. */
function cardMeta(row: DriveNode) {
  const date = rowDate(row)
  return row.owner.id === session.user.value?.id ? date : `${row.owner.full_name} · ${date}`
}
function itemAt(target: EventTarget | null) {
  const id = (target as Element | null)?.closest(`[${LISTING_ITEM}]`)?.getAttribute(LISTING_ITEM)
  return id ? (rows.value.find((row) => row.name === id) ?? null) : null
}
function onPointerdown(event: PointerEvent) {
  touchPress = event.pointerType !== 'mouse'
  // On touch a long press selects (see `startLongPress`). Marking the press
  // handled keeps the page's context menu from opening on its own long press.
  if (touchPress) event.preventDefault()
  else startMarquee(event)
}
function onContextMenu(event: MouseEvent) {
  // A phone sends `contextmenu` after a long press, which already selected.
  if (touchPress) {
    event.preventDefault()
    return
  }
  emit('menu', itemAt(event.target), event)
}
function onRowClick(event: MouseEvent, row: DriveNode) {
  if (takeLongPressClick(event)) return
  if (props.selectionMode || event.metaKey || event.ctrlKey || event.shiftKey)
    emit('select', row, event.shiftKey)
  else emit('open', row)
}
async function loadMore() {
  if (!props.query.hasNext || props.query.isFetchingNext) return
  // A failed window ends the walk. Without the flag the loop retries the same
  // cursor forever and the inline retry control never appears. The flag is
  // local, so pressing Retry starts a fresh walk.
  let failed = false
  await loadUntilVisible({
    get rows() {
      return props.query.rows
    },
    get hasNext() {
      return props.query.hasNext && !failed
    },
    async fetchNext() {
      await props.query.fetchNext()
      failed = Boolean(props.query.error)
      return this
    },
  })
}
function startLongPress(event: PointerEvent, row: DriveNode) {
  cancelLongPress()
  // A mouse selects with a drag or a modifier click. A press on a control inside
  // the item, such as the menu button, belongs to that control: its menu opens
  // on the press, so the release lands on the menu and never cancels the timer.
  // A card is itself a button, so its own element does not count.
  const control = (event.target as Element).closest('button, [role="checkbox"]')
  if (event.pointerType === 'mouse' || (control && control !== event.currentTarget)) return
  longPress = setTimeout(() => {
    // The press already answered. Swallow the click that follows the release,
    // or it toggles the row straight back off.
    longPressFired = true
    emit('select', row, false)
  }, 500)
}
function takeLongPressClick(event: MouseEvent) {
  if (!longPressFired) return false
  longPressFired = false
  event.preventDefault()
  event.stopPropagation()
  return true
}
function cancelLongPress() {
  if (longPress) clearTimeout(longPress)
  longPress = null
}
function onKeydown(event: KeyboardEvent) {
  // Only keys pressed on the row itself. Enter and Space on its menu button or
  // checkbox belong to that control.
  const target = event.target as HTMLElement
  const node = rows.value.find((row) => row.name === target.dataset.node)
  if (!node) return
  if (event.key === 'Enter') {
    event.preventDefault()
    emit('open', node)
  }
  if (event.key === ' ') {
    event.preventDefault()
    emit('select', node, event.shiftKey)
  }
}
</script>
