<template>
  <!-- Presses here can draw a selection rectangle, and right-clicks open the
       page's context menu. The listing fills the pane, so its empty space below
       the last item takes both.
       A new sort reorders the rows in place. The browser's scroll anchoring
       would follow the top row to its new place and move the page, so no row
       is an anchor. -->
  <!-- With one Tab stop, the listing itself takes focus when its last item leaves. -->
  <div
    ref="listing"
    class="relative pt-3 [overflow-anchor:none]"
    tabindex="-1"
    @focusin="focus.onFocusin"
    @keydown="onKeydown"
    @pointerdown="onPointerdown"
    @contextmenu="onContextMenu"
  >
    <!-- The root holds the gap above every state, so the listing does not move
         when the skeleton gives way to rows, an empty state or an error. -->
    <!-- A fast load shows nothing rather than a skeleton that flashes. -->
    <div v-if="isBlank" aria-busy="true" />
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
      :class="emptyFades && FADE_IN"
    >
      <span
        :class="[emptyIcon ?? 'lucide-folder-open', 'size-6 text-ink-gray-4']"
        aria-hidden="true"
      />
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
        :class="[loading && FADE_IN, 'md:list-gap-6']"
        :aria-busy="loading || undefined"
        role="grid"
        aria-multiselectable="true"
      >
        <ListHeader>
          <div class="flex min-w-0 items-center">
            <span
              v-if="selectionMode || checkboxOnHover"
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
          <!-- Access orders nothing, so its header only labels. -->
          <ListHeaderCell
            v-if="shows('access')"
            class="text-sm-medium text-ink-gray-5"
            :class="columnClass('access')"
            >{{ __('Access') }}</ListHeaderCell
          >
          <component
            :is="headerCell"
            v-if="shows('kind')"
            :class="columnClass('kind')"
            v-bind="headerProps('kind')"
            >Type</component
          >
          <component
            :is="headerCell"
            v-if="shows('owner')"
            :class="columnClass('owner')"
            v-bind="headerProps('owner')"
            >Owner</component
          >
          <component
            :is="headerCell"
            v-if="shows('size')"
            :class="columnClass('size')"
            v-bind="headerProps('size', 'end')"
            >Size</component
          >
          <component
            :is="headerCell"
            v-if="shows('modified')"
            :class="columnClass('modified')"
            v-bind="headerProps('modified', 'end')"
            >{{ byOpened ? 'Opened' : 'Modified' }}</component
          >
          <ListHeaderCell><span class="sr-only">Actions</span></ListHeaderCell>
        </ListHeader>
        <ListSkeletonRows v-if="loading" :cells="skeletonCells()" />
        <template v-else>
          <ListRow
            v-for="(row, index) in rows"
            :key="row.name"
            :value="row.name"
            :tabindex="stopIndex(row)"
            :aria-selected="isSelected(row)"
            :data-node="row.name"
            :data-listing-item="row.name"
            :data-drop-target="drag && row.kind === 'folder' ? row.name : undefined"
            :class="[
              'select-none',
              runClasses(index),
              checkboxOnHover && 'group/row',
              flashClasses(row),
              drag && dragClasses(row, DROP_ROW),
            ]"
            v-bind="rowDrop?.(row) ?? {}"
            @click="onRowClick($event, row)"
            @dblclick="$emit('open', row)"
            @pointerdown="startLongPress($event, row)"
            @pointerup="cancelLongPress"
            @pointercancel="cancelLongPress"
          >
            <ListCell>
              <!-- Hovering the icon or the name, not the whole row, shows the checkbox. -->
              <span class="group/name flex min-w-0 items-center">
                <!-- The checkbox takes the icon's place while the row is hovered or focused. -->
                <span
                  v-if="selectionMode || checkboxOnHover"
                  role="checkbox"
                  :aria-checked="isSelected(row)"
                  :aria-label="`Select ${row.title}`"
                  tabindex="-1"
                  class="mr-2 size-4 shrink-0 items-center rounded-1 focus-visible:focus-ring"
                  :class="
                    selectionMode
                      ? 'flex'
                      : ['relative hidden before:absolute before:-inset-2', rowCheckboxShows]
                  "
                  @click="onCheckboxClick($event, row)"
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
                  v-if="!selectionMode"
                  class="mr-2 size-4 shrink-0"
                  :class="[nodeIcon(row), nodeIconTint(row), checkboxOnHover && rowIconHides]"
                  :data-drag-handle="drag ? '' : undefined"
                  aria-hidden="true"
                />
                <!-- With drag to move, the icon and name are the row's drag handle; the rest of the row draws the marquee. -->
                <component
                  :is="nameLink(row) ? 'a' : 'span'"
                  class="min-w-0 truncate text-base text-ink-gray-8"
                  :title="row.title"
                  :data-drag-handle="drag ? '' : undefined"
                  v-bind="nameLink(row)"
                  >{{ row.title }}</component
                >
              </span>
              <StarredIcon v-if="row.favourite" class="ml-1.5 size-3.5 shrink-0" />
              <span v-if="showBreadcrumbs" class="ml-2 truncate text-p-sm text-ink-gray-5">{{
                breadcrumbText(row)
              }}</span>
            </ListCell>
            <ListCell v-if="shows('access')" :class="columnClass('access')">
              <!-- A click opens the share dialog where the user may share; elsewhere it is the row's. -->
              <span
                v-if="row.audience"
                class="flex min-w-0 items-center gap-1.5 text-base text-ink-gray-7"
                :class="canShare?.(row) && !selectionMode && 'cursor-pointer hover:text-ink-gray-9'"
                @click="onAccessClick($event, row)"
                @dblclick="onAccessDblclick($event, row)"
              >
                <span
                  :class="[audienceIcon(row.audience), 'size-4 shrink-0 text-ink-gray-5']"
                  aria-hidden="true"
                />
                <span class="truncate">{{ audienceLabel(row.audience) }}</span>
              </span>
            </ListCell>
            <ListCell v-if="shows('kind')" :class="columnClass('kind')"
              ><span class="truncate text-base text-ink-gray-7">{{
                typeLabel(row)
              }}</span></ListCell
            >
            <ListCell v-if="shows('owner')" :class="columnClass('owner')">
              <Avatar
                size="xs"
                :image="row.owner.user_image ?? undefined"
                :label="row.owner.full_name"
                class="mr-2 shrink-0"
              />
              <span class="truncate text-base text-ink-gray-7">{{ row.owner.full_name }}</span>
            </ListCell>
            <ListCell v-if="shows('size')" class="justify-end" :class="columnClass('size')"
              ><span class="truncate text-base text-ink-gray-5 tabular-nums">{{
                rowSize(row)
              }}</span></ListCell
            >
            <ListCell v-if="shows('modified')" class="justify-end" :class="columnClass('modified')"
              ><span class="truncate text-base text-ink-gray-5">{{ rowDate(row) }}</span></ListCell
            >
            <ListCell class="justify-end">
              <Dropdown :options="menuOptions(row)" align="end">
                <Button
                  icon="lucide-ellipsis"
                  variant="ghost"
                  :aria-label="`Actions for ${row.title}`"
                  :tabindex="stopIndex(row)"
                  @click.stop
                />
              </Dropdown>
            </ListCell>
          </ListRow>
        </template>
      </List>
    </template>

    <template v-else>
      <section v-if="loading" aria-busy="true" :class="FADE_IN">
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
            :data-drop-target="drag && row.kind === 'folder' ? row.name : undefined"
            v-bind="rowDrop?.(row) ?? {}"
          >
            <!-- With drag to move, the whole card is its drag handle. -->
            <FileCard
              :node="row"
              :meta="cardMeta(row)"
              :selected="isHighlighted(row)"
              :icon-class="cardIconClass"
              :title-link="nameLink(row)"
              :class="drag ? [flashClasses(row), dragClasses(row, DROP_CARD)] : flashClasses(row)"
              :data-drag-handle="drag ? '' : undefined"
              :data-node="row.name"
              :tabindex="stopIndex(row)"
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
              <span v-if="isSelected(row)" class="sr-only">{{ __('Selected') }}</span>
              <template #actions="{ onImage }">
                <!-- A control of its own, in the type icon's place, with a wider hit area.
                     A soft shadow keeps it readable on a thumbnail. -->
                <span
                  v-if="selectionMode || checkboxOnHover"
                  role="checkbox"
                  :aria-checked="isSelected(row)"
                  :aria-label="`Select ${row.title}`"
                  tabindex="-1"
                  data-card-checkbox
                  class="absolute start-3 top-3 flex size-5 cursor-pointer items-center justify-center before:absolute before:-inset-2"
                  :class="[
                    !selectionMode && cardCheckboxShows,
                    onImage && 'drop-shadow-[0_1px_2px_rgb(0_0_0/0.4)]',
                  ]"
                  @click="onCheckboxClick($event, row)"
                >
                  <Checkbox
                    :model-value="isSelected(row)"
                    tabindex="-1"
                    aria-hidden="true"
                    class="pointer-events-none"
                  />
                </span>
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
                    :tabindex="stopIndex(row)"
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
    <!-- The measured columns' labels, unseen, so each column sizes to its widest even while it is hidden. -->
    <div
      ref="ruler"
      class="pointer-events-none invisible absolute left-0 top-0 text-base"
      aria-hidden="true"
    >
      <div v-for="(labels, column) in rulerLabels" :key="column" :data-column="column">
        <span v-for="label in labels" :key="label" class="block w-max">{{ label }}</span>
      </div>
    </div>
    <DragMoveLayer v-if="drag" :drag="drag" />
  </div>
</template>

<script setup lang="ts">
import { useMediaQuery, useResizeObserver } from '@vueuse/core'
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
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
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
  type AnchorHTMLAttributes,
} from 'vue'

import type { InfiniteQueryState } from '@/api'
import type { DriveAudience, DriveNode } from '@/apps/drive/client/types'
import { formatBytes, formatModified } from '@/apps/drive/files/internal/format'
import { nodeIcon, nodeIconTint, useNodeTypeLabel } from '@/apps/drive/files/internal/icons'
import { useLocationTitle } from '@/apps/drive/files/internal/locations'
import StarredIcon from '@/apps/drive/files/internal/StarredIcon.vue'
import { Dropdown } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import DragMoveLayer from './DragMoveLayer.vue'
import FileCard from './FileCard.vue'
import {
  fitColumns,
  FITTED_WIDTHS,
  isMeasuredColumn,
  LIST_COLUMNS,
  MEASURED_COLUMNS,
  measuredWidth,
  WIDE_ONLY,
  type MeasuredColumn,
} from './listColumns'
import { loadUntilVisible } from './listingWindows'
import { SKELETON_BAR, useSkeletonDelay, type SkeletonCell } from './listSkeleton'
import ListSkeletonRows from './ListSkeletonRows.vue'
import { watchNewTabKey } from './newTabKey'
import type { FilesDateColumn, FilesSort, PresentationState } from './presentation'
import type { DropHandlers } from './uploads/drop'
import type { DragMove } from './useDragMove'
import { useListingFocus } from './useListingFocus'
import { LISTING_ITEM, useMarquee } from './useMarquee'
import { useWorkspaceName } from './useWorkspaceName'

const props = defineProps<{
  query: InfiniteQueryState<DriveNode>
  presentation: PresentationState
  selection: string[]
  selectionMode: boolean
  emptyTitle: string
  emptyDescription: string
  /** The empty state's icon class; an open folder when not given. */
  emptyIcon?: string
  showBreadcrumbs?: boolean
  /** False where the server fixes the order (search, Recent, Starred…): headers then only label. */
  sortable?: boolean
  menuOptions: (node: DriveNode) => DropdownItem[]
  /** Drop handlers for a row that takes dropped files. `null` leaves the drop to the pane. */
  rowDrop?: (node: DriveNode) => DropHandlers | null
  /** The item whose right-click menu is open. It looks selected while the menu shows. */
  menuTarget?: string | null
  dateColumn?: FilesDateColumn
  /** Drag to move, where the page allows it. Without it a press on an item draws the marquee. */
  drag?: DragMove
  /** Whether a click on an item's Access cell opens its share dialog. */
  canShare?: (node: DriveNode) => boolean
  /** The address an item's name links to, for Cmd/Ctrl-click and middle-click. None keeps plain text. */
  nodeHref?: (node: DriveNode) => string | undefined
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
  /** Shift and an arrow key moved focus from one item to another, which grows or shrinks the range. */
  extend: [from: DriveNode, to: DriveNode]
  share: [node: DriveNode]
}>()
const listing = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
const sentinelVisible = ref(false)
let observer: IntersectionObserver | null = null
let longPress: ReturnType<typeof setTimeout> | null = null
let longPressFired = false
/** The last press came from touch or a pen, not a mouse. */
let touchPress = false
const session = useSession()
const workspaceName = useWorkspaceName()
const locationTitle = useLocationTitle()
const typeLabel = useNodeTypeLabel()
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
const focus = useListingFocus({
  root: listing,
  rows: () => props.query.rows,
  selection: () => props.selection,
  grid: () => props.presentation.view === 'grid',
  extend: (from, to) => emit('extend', from, to),
})
/**
 * Loads windows until the item is in the listing, ten at most, then focuses it.
 * With `highlight`, its background flashes. Answers whether it could.
 */
async function reveal(id: string, { highlight = false } = {}): Promise<boolean> {
  const has = () => props.query.rows.some((row) => row.name === id)
  for (let windows = 0; !has() && props.query.hasNext && windows < 10; windows++) {
    await props.query.fetchNext()
    if (props.query.error) break
  }
  await nextTick()
  const found = focus.focusRow(id, { reveal: true })
  if (found && highlight) startFlash(id)
  return found
}
const FLASH_MS = 1500
const FLASH_FADE_MS = 700
/** The item a reveal highlights, and whether its highlight is fading out. */
const flash = ref<{ id: string; fading: boolean } | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined
function startFlash(id: string) {
  clearTimeout(flashTimer)
  flash.value = { id, fading: false }
  flashTimer = setTimeout(() => {
    flash.value = { id, fading: true }
    flashTimer = setTimeout(() => (flash.value = null), FLASH_FADE_MS)
  }, FLASH_MS)
}
onBeforeUnmount(() => clearTimeout(flashTimer))
function flashClasses(row: DriveNode) {
  if (flash.value?.id !== row.name) return undefined
  return [
    'transition-colors duration-700 motion-reduce:transition-none',
    !flash.value.fading && '!bg-surface-blue-1',
  ]
}
defineExpose({ focusRow: focus.focusRow, focusedRow: focus.focusedRow, reveal })
/** Where a mouse can hover, an item's checkbox shows on hover and the header's always. */
const checkboxOnHover = useMediaQuery('(hover: hover) and (pointer: fine)')
/**
 * Where a checkbox shows outside selection mode: while the pointer is over the
 * icon and name (a card's corner and title), or keyboard focus is on the item.
 * The icon hides with the same rule, so the two never show together.
 */
const rowCheckboxShows = 'group-hover/name:flex group-focus-visible/row:flex'
const rowIconHides = 'group-hover/name:hidden group-focus-visible/row:hidden'
const cardCheckboxShows =
  'opacity-0 hover:opacity-100 group-has-[[data-card-title]:hover]/card:opacity-100 group-has-[:focus-visible]/card:opacity-100'
/** A card's type icon steps aside while its checkbox shows in the icon's place. */
const cardIconClass = computed(() => {
  if (props.selectionMode) return 'invisible'
  if (!checkboxOnHover.value) return undefined
  return 'group-has-[[data-card-checkbox]:hover]/card:invisible group-has-[[data-card-title]:hover]/card:invisible group-has-[:focus-visible]/card:invisible'
})
/** A click on the checkbox selects without opening. */
function onCheckboxClick(event: MouseEvent, row: DriveNode) {
  event.stopPropagation()
  emit('select', row, event.shiftKey)
}
/** Only the item that holds the Tab stop is tabbable, with its menu button. */
function stopIndex(row: DriveNode) {
  return row.name === focus.tabStop.value ? 0 : -1
}

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

const loading = computed(() => props.query.status === 'pending' && !props.query.rows.length)
const isBlank = useSkeletonDelay(loading, () => 200)
/** A 150 ms fade as an element appears, none under reduced motion. Placeholders a load soon replaces barely show. */
const FADE_IN = 'motion-safe:animate-[files-listing-fade-in_150ms_ease-out]'
/**
 * The empty state fades in when a load ends in it, so it does not snap in after
 * the blank or the placeholders. One the cache already knew shows at once.
 */
const emptyFades = shallowRef(false)
let emptyFadeTimer: ReturnType<typeof setTimeout> | undefined
watch(
  loading,
  (isLoading) => {
    clearTimeout(emptyFadeTimer)
    if (isLoading) emptyFades.value = true
    else emptyFadeTimer = setTimeout(() => (emptyFades.value = false), 300)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(emptyFadeTimer))
const rows = computed(() => props.query.rows)
const columns = computed(() => props.presentation.columns)
/** The chosen columns in the rows' order, whatever order they were chosen in. */
const shownColumns = computed(() => LIST_COLUMNS.filter(shows))
/** The listing's width, once the browser has measured it. */
const listingWidth = shallowRef<number>()
useResizeObserver(listing, ([entry]) => (listingWidth.value = entry?.contentRect.width))
/** The measured columns' widths, from their widest labels. */
const measured = shallowRef<Partial<Record<MeasuredColumn, number>>>({})
function trackWidth(column: string) {
  if (isMeasuredColumn(column)) return measured.value[column] ?? MEASURED_COLUMNS[column].max
  return FITTED_WIDTHS[column] ?? 128
}
/**
 * The columns the desktop layout shows. A chosen column the list has no room
 * for is hidden until there is room again; it stays chosen.
 */
const desktopColumns = computed(() => {
  const width = listingWidth.value
  if (width === undefined) return shownColumns.value
  return fitColumns(shownColumns.value, width, trackWidth)
})
/** Each shown measured column's labels in the rows, once each. */
const rulerLabels = computed(() => {
  const labels: Partial<Record<MeasuredColumn, string[]>> = {}
  const labelsOf = (column: MeasuredColumn): string[] =>
    rows.value.flatMap((row) => {
      if (column === 'kind') return [typeLabel(row)]
      if (column === 'owner') return [row.owner.full_name]
      return row.audience ? [audienceLabel(row.audience)] : []
    })
  for (const column of shownColumns.value) {
    if (isMeasuredColumn(column)) labels[column] = [...new Set(labelsOf(column))]
  }
  return labels
})
const ruler = useTemplateRef('ruler')
watch([rulerLabels, ruler], measureColumns, { flush: 'post', immediate: true })
// Labels measured before the web font loads have the fallback font's widths.
onMounted(() => void document.fonts?.ready.then(measureColumns))
/** Sizes each measured column to its widest label. A label with no width has had no layout, so it says nothing. */
function measureColumns() {
  const next = { ...measured.value }
  for (const group of ruler.value?.children ?? []) {
    const column = group.getAttribute('data-column')
    if (!isMeasuredColumn(column)) continue
    const widths = [...group.children].map((label) => label.getBoundingClientRect().width)
    if (widths.some(Boolean)) next[column] = measuredWidth(column, widths.filter(Boolean))
  }
  measured.value = next
}
const columnTracks = computed(() => {
  const tracks = (list: string[]) => [
    'minmax(0,1fr)',
    ...list.map((column) => `${trackWidth(column)}px`),
    '2.5rem',
  ]
  return {
    base: tracks(shownColumns.value.filter((column) => !WIDE_ONLY.has(column))),
    md: tracks(desktopColumns.value),
  }
})
const byOpened = computed(() => props.dateColumn === 'opened')
const headerCell = computed(() => (props.sortable === false ? ListHeaderCell : ListHeaderCellSort))
const allSelected = computed(() => rows.value.length > 0 && rows.value.every(isSelected))
const someSelected = computed(() => !allSelected.value && rows.value.some(isSelected))

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      sentinelVisible.value = entry?.isIntersecting ?? false
    },
    { rootMargin: '240px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})
// A refresh can finish while the sentinel stays visible. Resume then without
// requiring another intersection, but leave a failed window for explicit Retry.
watch(
  [sentinelVisible, () => props.query.isFetching, () => props.query.hasNext],
  () => {
    if (sentinelVisible.value && !props.query.error) void loadMore()
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelLongPress()
})

function shows(column: string) {
  return columns.value.includes(column)
}
/** Hides a chosen column the phone layout, the desktop layout or both leave out. */
function columnClass(column: string) {
  const onDesktop = desktopColumns.value.includes(column)
  if (!WIDE_ONLY.has(column)) return onDesktop ? undefined : 'md:hidden'
  return onDesktop ? 'hidden md:flex' : 'hidden'
}

function skeletonCells() {
  return shownColumns.value.map((column): SkeletonCell =>
    column === 'modified'
      ? { class: ['justify-end', columnClass(column)], hasDate: true }
      : { class: columnClass(column) },
  )
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
const AUDIENCE_ICONS: Record<DriveAudience['kind'], string> = {
  public: 'lucide-globe',
  organization: 'lucide-building-2',
  link: 'lucide-link',
  people: 'lucide-users',
}
function audienceIcon(audience: DriveAudience) {
  return audience.kind === 'people' && audience.people <= 1
    ? 'lucide-lock'
    : AUDIENCE_ICONS[audience.kind]
}
/** How widely an item is shared, in a few words. */
function audienceLabel(audience: DriveAudience) {
  if (audience.kind === 'public') return __('Public')
  if (audience.kind === 'organization') return workspaceName.value || __('Your organization')
  if (audience.kind === 'link') return __('Anyone with the link')
  return audience.people <= 1 ? __('Only you') : __('{0} people', [audience.people])
}
type NameLink = AnchorHTMLAttributes & {
  onClick: (event: MouseEvent) => void
  onPointerenter: (event: PointerEvent) => void
}
/**
 * An item's name as a link: no Tab stop of its own and no native drag. It
 * looks like a link, underlined in the link colour, only while the pointer is
 * on it and Cmd/Ctrl is held. Cmd/Ctrl-click opens it in a new tab and leaves
 * the selection alone; middle-click opens one natively. Any other click is the
 * item's, as before, and does not follow the link.
 */
function nameLink(row: DriveNode): NameLink | undefined {
  const href = props.nodeHref?.(row)
  if (!href) return undefined
  return {
    href,
    tabindex: -1,
    draggable: false,
    class:
      'underline-offset-2 data-[new-tab]:text-ink-blue-link data-[new-tab]:underline [-webkit-touch-callout:none]',
    onClick: onNameClick,
    onPointerenter: watchNewTabKey,
  }
}
function onNameClick(event: MouseEvent) {
  if (event.metaKey || event.ctrlKey) event.stopPropagation()
  else event.preventDefault()
}
/** Whether a click on an item's Access cell is the share dialog's rather than the row's. */
function sharesOnClick(event: MouseEvent, row: DriveNode) {
  if (props.selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) return false
  return !!props.canShare?.(row)
}
function onAccessClick(event: MouseEvent, row: DriveNode) {
  if (!sharesOnClick(event, row)) return
  event.stopPropagation()
  emit('share', row)
}
/** A double click there opens Share once, not the item as well. */
function onAccessDblclick(event: MouseEvent, row: DriveNode) {
  if (sharesOnClick(event, row)) event.stopPropagation()
}
function rowDate(row: DriveNode) {
  return formatModified(byOpened.value ? (row.opened_at ?? null) : row.modified)
}
/** A folder shows the total of its files when the listing read it, and nothing when it holds none. */
function rowSize(row: DriveNode) {
  const bytes = row.kind === 'folder' ? row.contents_size : row.size
  return bytes ? formatBytes(bytes) : ''
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
  const id =
    target instanceof Element
      ? target.closest(`[${LISTING_ITEM}]`)?.getAttribute(LISTING_ITEM)
      : null
  return id ? (rows.value.find((row) => row.name === id) ?? null) : null
}
function onPointerdown(event: PointerEvent) {
  touchPress = event.pointerType !== 'mouse'
  // On touch a long press selects (see `startLongPress`). Marking the press
  // handled keeps the page's context menu from opening on its own long press.
  if (touchPress) event.preventDefault()
  else if (!startDrag(event)) startMarquee(event)
}
/** A press on an item's drag handle that the drag takes. */
function startDrag(event: PointerEvent) {
  const row = props.drag && itemAt(event.target)
  return !!row && !!props.drag?.press(event, row)
}
/** A dragged item fades; a folder under the pointer that takes the drop lights up. */
const DROP_ROW = '!bg-surface-blue-2 ring-1 ring-inset ring-outline-blue-3'
const DROP_CARD = '!border-outline-blue-3 !bg-surface-blue-2'
function dragClasses(row: DriveNode, accepting: string) {
  if (props.drag?.isDragged(row.name)) return 'opacity-50'
  return props.drag?.accepts(row.name) ? accepting : undefined
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
  if (!props.query.hasNext || props.query.isFetching || props.query.isFetchingNext) return
  // A failed window ends the walk. Without the flag the loop retries the same
  // cursor forever and the inline retry control never appears. The flag is
  // local, so pressing Retry starts a fresh walk.
  let failed = false
  try {
    await loadUntilVisible({
      get rows() {
        return props.query.rows
      },
      get hasNext() {
        return props.query.hasNext && !props.query.isFetching && !failed
      },
      async fetchNext() {
        await props.query.fetchNext()
        failed = Boolean(props.query.error)
        return this
      },
    })
  } catch (error) {
    // A new search or place cancels the window being loaded, which ends the walk.
    if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
  }
}
function startLongPress(event: PointerEvent, row: DriveNode) {
  const checkedEventTarget = event.target
  if (!(checkedEventTarget instanceof Element)) return

  cancelLongPress()
  // A mouse selects with a drag or a modifier click. A press on a control inside
  // the item, such as the menu button, belongs to that control: its menu opens
  // on the press, so the release lands on the menu and never cancels the timer.
  // A card is itself a button, so its own element does not count.
  const control = checkedEventTarget.closest('button, [role="checkbox"]')
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
  if (focus.onKeydown(event)) return
  const checkedEventTarget = event.target
  if (!(checkedEventTarget instanceof HTMLElement)) return

  // Only keys pressed on the row itself. Enter and Space on its menu button or
  // checkbox belong to that control.
  const target = checkedEventTarget
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

<style>
/* Not scoped: a scoped name would not match the Tailwind class that uses it. */
@keyframes files-listing-fade-in {
  from {
    opacity: 0;
  }
}
</style>
