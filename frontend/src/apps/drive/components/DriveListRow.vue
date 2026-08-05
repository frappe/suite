<template>
  <template v-for="item in items" :key="item.key">
    <ListRow v-if="item.placeholder === 'loading'" class="pointer-events-none">
      <ListCell />
      <ListCell>
        <div class="flex items-center" :style="indent(item.depth)">
          <Skeleton class="h-[16px] w-[16px] shrink-0 mr-2 rounded-sm" />
          <Skeleton class="h-3.5 w-40 rounded" />
        </div>
      </ListCell>
      <ListCell>
        <Skeleton class="size-5 shrink-0 mr-2 rounded-full" />
        <Skeleton class="h-3 w-16 rounded" />
      </ListCell>
      <ListCell><Skeleton class="h-3 w-20 rounded" /></ListCell>
      <ListCell><Skeleton class="h-3 w-12 rounded" /></ListCell>
      <ListCell />
    </ListRow>
    <ListRow v-else-if="item.placeholder" class="pointer-events-none">
      <ListCell />
      <ListCell>
        <span class="text-base text-ink-gray-5" :style="indent(item.depth, 24)">
          {{ __('Empty folder') }}
        </span>
      </ListCell>
      <ListCell />
      <ListCell />
      <ListCell />
      <ListCell />
    </ListRow>
    <template v-else>
      <ListRow
        v-for="row in [item.row]"
        :key="item.key"
        class="group"
        :class="[
          row.name === selectedName || selections.has(row.name)
            ? 'bg-surface-gray-2 hover:!bg-surface-gray-3'
            : 'bg-surface-base',
          draggingNames.has(row.name) ? 'opacity-60 hover:shadow-none' : '',
          dragOverItem === row.name ? '!bg-surface-gray-3' : '',
        ]"
        :draggable="renamingEntity !== row.name"
        :to="routeFor(row)"
        :data-testid="`drive-entity-${row.name}`"
        :data-selected="selections.has(row.name) || undefined"
        @contextmenu="(e) => !selections.size && contextMenu(e, row)"
        @click="isModKey($event) ? props.toggleSelection(row, $event) : !selections.size && open(row)"
        @dragstart="onDragStart($event, row)"
        @dragend="draggedItem = null"
        @dragover="
          (e) => {
            if (row.is_folder && !isVirtual(row)) {
              e.preventDefault()
              dragOverItem = row.name
            }
          }
        "
        @dragleave="dragOverItem = null"
        @drop="
          $emit(
            'dropped',
            row,
            $event.dataTransfer.getData('application/x-filename')
          )
        "
      >
        <ListCell>
          <Checkbox
            class="shrink-0"
            :class="selections.size > 0 || selections.has(row.name) ? '' : 'invisible group-hover:visible'"
            :model-value="selections.has(row.name)"
            :aria-label="__('Select {0}', [row.file_name])"
            @click.stop="props.toggleSelection(row, $event)"
          />
        </ListCell>
        <ListCell>
          <div
            class="relative h-[16px] w-[16px] shrink-0 mr-2"
            :class="canExpand(row) ? 'cursor-pointer' : ''"
            :data-testid="canExpand(row) ? `drive-expand-${row.name}` : undefined"
            :style="indent(item.depth)"
            @click.stop.prevent="canExpand(row) && toggleFolder(row)"
          >
            <div
              class="absolute inset-0"
              :class="canExpand(row) ? (isExpanded(row) ? 'opacity-0' : 'group-hover:opacity-0') : ''"
            >
              <img
                v-if="!loadedThumbnails.has(row.name)"
                loading="lazy"
                class="absolute inset-0 h-[16px] w-[16px] rounded-sm"
                :src="thumbnail(row).fallback"
                :draggable="false"
              />
              <img
                loading="lazy"
                decoding="async"
                class="absolute inset-0 h-[16px] w-[16px] object-cover rounded-sm"
                :class="loadedThumbnails.has(row.name) ? 'opacity-100' : 'opacity-0'"
                :src="thumbnail(row).src"
                :draggable="false"
                @load="loadedThumbnails.add(row.name)"
              />
            </div>
            <LucideChevronRight
              v-if="canExpand(row)"
              class="absolute inset-0 size-4 text-ink-gray-7 transition-transform duration-150"
              :class="isExpanded(row) ? '' : 'opacity-0 group-hover:opacity-100'"
              :style="{ transform: `rotate(${isExpanded(row) ? 90 : 0}deg)` }"
            />
          </div>
          <InlineRenameInput :entity="row">
            <Tooltip :text="nameTooltip(row)" :disabled="!nameTooltip(row)" class="min-w-0 flex-1">
              <div class="truncate text-base">{{ displayName(row) }}</div>
            </Tooltip>
          </InlineRenameInput>
          <div v-if="(row.is_favourite && $route.name !== 'Favourites') || shareIcon(row)"
            class="ml-auto flex min-w-8 shrink-0 flex-row justify-end gap-2 pr-3">
            <LucideStar
              v-if="row.is_favourite && $route.name !== 'Favourites'"
              width="16"
              height="16"
              class="my-auto shrink-0 text-ink-amber-6 stroke-current fill-current"
            />
            <Tooltip v-if="shareIcon(row)" :text="shareIcon(row).tooltip" class="shrink-0">
              <component :is="shareIcon(row).icon" class="size-4 shrink-0" />
            </Tooltip>
          </div>
        </ListCell>
        <ListCell class="hidden sm:flex">
          <Avatar
            v-if="row.owner"
            shape="circle"
            :image="row.owner_image"
            :label="row.owner_full_name || row.owner"
            size="sm"
            class="mr-2 shrink-0"
          />
          <span class="truncate text-base">{{ ownerLabel(row) }}</span>
        </ListCell>
        <ListCell>
          <Tooltip :text="formatDate(row.modified)">
            <span class="truncate text-base">{{ row.relativeModified }}</span>
          </Tooltip>
        </ListCell>
        <ListCell class="hidden sm:flex">
          <span class="truncate text-base">{{ sizeLabel(row) }}</span>
        </ListCell>
        <ListCell class="justify-end">
          <Button
            v-if="!selections.size"
            :label="__('Actions for {0}', [row.file_name])"
            class="!bg-inherit sm:invisible sm:group-hover:visible"
            @click="(e) => contextMenu(e, row)"
          >
            <LucideMoreHorizontal class="size-4" />
          </Button>
        </ListCell>
        </ListRow>
    </template>
  </template>
</template>
<script setup>
import { ListRow, ListCell } from 'frappe-ui/list'
import { Avatar, Button, Checkbox, Skeleton, Tooltip } from 'frappe-ui'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionStore } from '@/boot/session'
import { activeEntity, renamingEntity } from '@/apps/drive/data/selection'
import InlineRenameInput from './InlineRenameInput.vue'
import { openEntity, isModKey, isVirtual, folderRoute, getThumbnailUrl, displayFileName } from '@/apps/drive/utils/files'
import { formatDate } from '@/apps/drive/utils/format'
import { expandedFolders } from '@/apps/drive/data/folderTree'
import LucideStar from '~icons/lucide/star'
import LucideChevronRight from '~icons/lucide/chevron-right'
import LucideMoreHorizontal from '~icons/lucide/more-horizontal'
import LucideGlobe2 from '~icons/lucide/globe-2'
import LucideBuilding2 from '~icons/lucide/building-2'
import LucideUsers from '~icons/lucide/users'

const props = defineProps({
  items: Array,
  contextMenu: Function,
  selections: Set,
  toggleSelection: Function,
  toggleFolder: Function,
  rootEntity: Object,
})
defineEmits(['dropped'])

const route = useRoute()

const draggedItem = ref()
const dragOverItem = ref()

// The set of rows visually "picked up" during a drag: the whole selection when
// the grabbed row is part of it, otherwise just that row.
const draggingNames = computed(() => {
  if (!draggedItem.value) return new Set()
  return props.selections.has(draggedItem.value)
    ? props.selections
    : new Set([draggedItem.value])
})

const onDragStart = (e, row) => {
  draggedItem.value = row.name
  e.dataTransfer?.setData('application/x-filename', row.name)
  e.dataTransfer?.setData(
    'application/x-filenames',
    JSON.stringify([...draggingNames.value])
  )
  const count = draggingNames.value.size
  if (count <= 1) return
  // Native drag image is just the grabbed row; swap in a badge so a multi-file
  // drag reads as multiple items.
  const ghost = document.createElement('div')
  ghost.textContent = `${count} items`
  ghost.className =
    'fixed -top-full left-0 rounded-md bg-surface-gray-7 px-2.5 py-1.5 text-sm font-medium text-ink-white shadow-lg'
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, -8, -8)
  requestAnimationFrame(() => ghost.remove())
}

// Used as right-click doesn't trigger active in frappe-ui
const selectedName = computed(() => activeEntity.value?.name)
// Folders get a real `:to` route below — RouterLink handles the navigation
// (and gives cmd/ctrl-click-to-open-in-new-tab, right-click-copy-link for
// free) — so this only drives non-folder clicks. Suppressed during an active
// selection so clicking elsewhere in the row doesn't navigate away (matches
// the existing !selections.size click guard).
// `!renamingEntity`: the rename input sits inside the row's <button>, so a
// keystroke there must never activate the row.
const open = (row) =>
  !renamingEntity.value &&
  !row.is_folder &&
  route.name !== 'Trash' &&
  openEntity(row)
const routeFor = (row) =>
  row.is_folder && !props.selections.size ? folderRoute(row) : undefined

// Virtual nodes have no Drive children to fetch — expanding one would ask for
// the contents of a File that doesn't exist.
const canExpand = (row) =>
  row.is_folder &&
  !row.external &&
  !isVirtual(row) &&
  row.child_count !== 0 &&
  route.name !== 'drive-Trash'
const isExpanded = (row) => expandedFolders.value.has(row.name)
// 24px = icon width + its gutter, so text lines up with sibling file names
const indent = (depth, offset = 0) =>
  depth || offset ? { marginLeft: depth * 20 + offset + 'px' } : null

const loadedThumbnails = ref(new Set())
function thumbnail(row) {
  return getThumbnailUrl(row)
}

function displayName(row) {
  return displayFileName(row)
}
function nameTooltip(row) {
  const display = displayFileName(row)
  return display === row.file_name ? '' : row.file_name
}

function shareIcon(row) {
  if (row.share_count === props.rootEntity?.share_count) return null
  if (row.share_count === -2) return { icon: LucideGlobe2, tooltip: __('Public') }
  if (row.share_count === -1) return { icon: LucideBuilding2, tooltip: __('Organization') }
  if (row.share_count > 0)
    return { icon: LucideUsers, tooltip: __('Shared with {0} users', [row.share_count]) }
  return null
}

function ownerLabel(row) {
  return row.owner === useSessionStore().user
    ? __('You')
    : row.owner_full_name || row.owner || '-'
}

function sizeLabel(row) {
  if (row.is_folder)
    return row.child_count
      ? row.child_count + ' item' + (row.child_count === 1 ? '' : 's')
      : 'empty'
  if (row.slide_count != null)
    return row.slide_count
      ? row.slide_count + ' slide' + (row.slide_count === 1 ? '' : 's')
      : 'empty'
  return row.file_size_pretty || '-'
}
</script>
<style>
[data-slot='list-row'][data-selected] + [data-slot='list-row'][data-selected] {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
[data-slot='list-row'][data-selected]:has(+ [data-slot='list-row'][data-selected]) {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
[data-slot='list-row'][data-selected] + [data-slot='list-row'][data-selected] [data-slot='list-divider'] {
  opacity: 0;
}
</style>
