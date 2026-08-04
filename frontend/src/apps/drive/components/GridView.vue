<template>
  <!-- pt-1 to accomodate borders -->
  <div
    v-if="rows?.length"
    ref="scrollContainer"
    class="grid-container content-start gap-3 p-3 pb-[60px] sm:gap-5 sm:p-5 sm:pb-[60px] overflow-auto select-none flex-1 min-h-0"
  >
    <div
      v-for="file in rows"
      :id="file.name"
      :key="file.name"
      :data-testid="`drive-entity-${file.name}`"
      class="grid-item rounded-md group select-none entity cursor-pointer relative h-40 sm:h-[172px] border bg-surface-base"
      :class="[
        selections.has(file.name) || selectedRow?.name === file.name
          ? 'border-outline-gray-3 bg-surface-gray-2 shadow-sm'
          : 'border-outline-gray-2 hover:bg-surface-gray-1 hover:shadow-sm',
        draggingNames.has(file.name) ? 'opacity-60 hover:shadow-none' : '',
        dragOverItem === file.name ? '!bg-surface-gray-3' : '',
      ]"
      :draggable="renamingEntity !== file.name"
      @dragstart="onDragStart($event, file)"
      @dragend="draggedItem = null"
      @dragleave="dragOverItem = null"
      @dragover="
        (e) => {
          if (file.is_folder) {
            e.preventDefault()
            dragOverItem = file.name
          }
        }
      "
      @drop="$emit('dropped', file, draggedItem)"
      @click="isModKey($event) ? toggleSelection(file) : open(file)"
      @contextmenu="contextMenu($event, file)"
      @mousedown.stop
    >
      <LucideStar
        v-if="$route.name !== 'Favourites' && file.is_favourite"
        class="z-10 text-ink-amber-6 stroke-current fill-current absolute top-2 left-2 h-4"
        :class="selections.size ? 'invisible' : 'group-hover:invisible'"
        width="16"
        height="16"
      />
      <Checkbox
        class="z-10 absolute top-1 left-1 cursor-pointer"
        :class="
          selections.size > 0 || selections.has(file.name)
            ? ''
            : 'invisible group-hover:visible'
        "
        :model-value="selections.has(file.name)"
        @click.stop="toggleSelection(file)"
      />
      <Button
        :variant="'subtle'"
        :label="`Actions for ${file.file_name}`"
        class="z-10 duration-300 absolute top-2 right-2"
        :class="[
          selections.size > 0 ? '' : '!bg-surface-gray-3 hover:shadow-lg',
          selectedRow?.name === file.name
            ? ''
            : 'sm:invisible sm:group-hover:visible',
        ]"
        @click.stop="contextMenu($event, file)"
      >
        <LucideMoreHorizontal class="size-4" />
      </Button>
      <GridItem :file="file" />
    </div>
  </div>
  <NoFilesSection v-else description="Nothing found - try something else?" />
  <div v-if="loadingMore" class="pointer-events-none px-3 pb-5 sm:px-5">
    <Skeleton class="h-3 w-24 rounded" />
  </div>
  <ContextMenu
    v-if="rowEvent && selectedRow"
    :key="selectedRow.name"
    v-on-outside-click="() => ((rowEvent = false), (selectedRow = null))"
    :close="() => ((rowEvent = false), (selectedRow = null))"
    :action-items="dropdownActionItems(selectedRow)"
    :event="rowEvent"
  />
</template>

<script setup>
import GridItem from '@/apps/drive/components/GridItem.vue'
import ContextMenu from '@/apps/drive/components/ContextMenu.vue'
import NoFilesSection from '@/apps/drive/components/NoFilesSection.vue'
import { Button, Checkbox, Skeleton } from 'frappe-ui'
import { ref, computed } from 'vue'
import { openEntity, isModKey } from '@/apps/drive/utils/files'
import { useRoute } from 'vue-router'
import { setActiveEntity, renamingEntity } from '@/apps/drive/data/selection'
import { settings } from '@/apps/drive/resources/permissions'
import { onOutsideClickDirective as vOnOutsideClick } from 'frappe-ui'

const props = defineProps({
  folderContents: Object,
  actionItems: Array,
  loadingMore: Boolean,
})
defineEmits(['dropped'])
const route = useRoute()
const selections = defineModel(new Set())

const rows = computed(() => props.folderContents)

const scrollContainer = ref(null)
defineExpose({ scrollEl: scrollContainer })

const selectedRow = ref(null)
const rowEvent = ref(null)

// Duplication, redesign
const contextMenu = (event, row) => {
  if (selections.value.size > 0) return
  // Ctrl + click triggers context menu on Mac
  if (isModKey(event)) openEntity(row, true)
  rowEvent.value = event
  selectedRow.value = row
  event.stopPropagation()
  event.preventDefault()
}

const dropdownActionItems = (row) => {
  if (!row) return []
  return props.actionItems
    .filter((a) => !a.isEnabled || a.isEnabled(row))
    .map((a) => ({
      ...a,
      handler: () => {
        rowEvent.value = false
        setActiveEntity(row)
        a.action([row])
      },
    }))
}
const toggleSelection = (file) => {
  if (selections.value.has(file.name)) selections.value.delete(file.name)
  else selections.value.add(file.name)
}

const open = (row) =>
  !selections.value.size && route.name !== 'Trash' && openEntity(row)

const draggedItem = ref(null)
const dragOverItem = ref(null)

// The set of tiles that are visually "picked up" during a drag: the whole
// selection when the grabbed tile is part of it, otherwise just that tile.
const draggingNames = computed(() => {
  if (!draggedItem.value) return new Set()
  return selections.value.has(draggedItem.value)
    ? selections.value
    : new Set([draggedItem.value])
})

const onDragStart = (e, file) => {
  draggedItem.value = file.name
  e.dataTransfer?.setData('application/x-filename', file.name)
  e.dataTransfer?.setData(
    'application/x-filenames',
    JSON.stringify([...draggingNames.value])
  )
  const count = draggingNames.value.size
  if (count <= 1) return
  // Native drag image is a screenshot of the grabbed tile only; swap in a
  // small badge so a multi-file drag reads as multiple items.
  const ghost = document.createElement('div')
  ghost.textContent = `${count} items`
  ghost.className =
    'fixed -top-full left-0 rounded-md bg-surface-gray-7 px-2.5 py-1.5 text-sm font-medium text-ink-white shadow-lg'
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, -8, -8)
  requestAnimationFrame(() => ghost.remove())
}

</script>
<style scoped>
.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  grid-auto-columns: minmax(170px, 1fr);
}

</style>
