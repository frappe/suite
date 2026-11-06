<template>
  <div
    v-if="tabs.length"
    class="hidden h-11 shrink-0 items-center px-3 md:flex"
    @drop.prevent="onDrop"
    @dragover.prevent
  >
    <Tabs
      :model-value="activeTabId"
      class="min-w-0"
      @update:model-value="selectTab(String($event))"
    >
      <div class="min-w-0 overflow-x-auto [scrollbar-width:none]">
        <TabList variant="ghost" size="sm">
          <template v-for="(tab, index) in tabs" :key="tab.id">
            <span v-if="isDropBefore(index)" class="drop-mark" aria-hidden="true" />
            <!-- One cell: the trigger sizes it to the name, and the field lies exactly over the trigger. No position of its own, as the sliding highlight measures tabs against the list. -->
            <span class="tab-cell grid min-w-10 max-w-60 shrink-0">
              <ContextMenu :options="tabActions(tab.id)">
                <TabTrigger
                  :value="tab.id"
                  :label="isRenaming(tab.id) ? renamedLabel : tab.label"
                  class="min-w-0 max-w-full [&>*]:max-w-full"
                  :class="[
                    tab.id === draggedId && 'opacity-40',
                    isRenaming(tab.id) && 'opacity-0 [&_span]:whitespace-pre',
                  ]"
                  :draggable="editable"
                  @dblclick="editable && startRenaming(tab.id)"
                  @dragstart="onDragStart($event, tab.id, index)"
                  @dragover.prevent="onDragOver($event, index)"
                  @dragend="stopDragging"
                />
              </ContextMenu>
              <input
                v-if="isRenaming(tab.id)"
                v-model="renamedLabel"
                v-on-outside-click="() => finishRenaming()"
                v-select-on-mount
                class="tab-name-field"
                :aria-label="__('Tab name')"
                @keydown.enter="finishRenaming()"
                @keydown.esc="stopRenaming()"
              />
            </span>
          </template>
          <span v-if="isDropBefore(tabs.length)" class="drop-mark" aria-hidden="true" />
        </TabList>
      </div>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import {
  ContextMenu,
  TabList,
  Tabs,
  TabTrigger,
  vOnOutsideClick,
  type ContextMenuOptions,
} from 'frappe-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { useDocumentTabs } from './useDocumentTabs'

const props = defineProps<{ editor: Editor; editable: boolean }>()

const { tabs, activeTabId, selectTab } = useDocumentTabs(props.editor)

const renamingId = ref<string | null>(null)
const renamedLabel = ref('')
// The field waits for the closing menu, whose click would otherwise count as a click outside it
const isRenameReady = ref(false)

function isRenaming(id: string) {
  return renamingId.value === id && isRenameReady.value
}

const vSelectOnMount = {
  mounted(input: HTMLInputElement) {
    input.focus()
    input.select()
  },
}

async function startRenaming(id: string) {
  selectTab(id)
  renamingId.value = id
  renamedLabel.value = tabs.value.find((tab) => tab.id === id)?.label ?? ''
  await nextTick()
  setTimeout(() => (isRenameReady.value = true), 50)
}

function stopRenaming(refocus = true) {
  renamingId.value = null
  renamedLabel.value = ''
  isRenameReady.value = false
  if (refocus) props.editor.commands.focus()
}

function finishRenaming(refocus = true) {
  const label = renamedLabel.value.trim()
  // An unchanged name stays automatic, so it keeps following the tab's first heading
  const current = tabs.value.find((tab) => tab.id === renamingId.value)
  if (current && label && label !== current.label) {
    props.editor.commands.renameTab(current.id, label, refocus)
  }
  stopRenaming(refocus)
}

// Moving to another tab ends a rename.
watch(activeTabId, (id) => {
  if (renamingId.value && renamingId.value !== id) finishRenaming(false)
})

const draggedId = ref<string | null>(null)
const draggedIndex = ref(-1)
const dropIndex = ref(-1)

function onDragStart(event: DragEvent, id: string, index: number) {
  if (!props.editable || !event.dataTransfer) return
  draggedId.value = id
  draggedIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(event: DragEvent, index: number) {
  if (!draggedId.value) return
  const { left, width } = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropIndex.value = event.clientX < left + width / 2 ? index : index + 1
}

const movesTab = computed(
  () =>
    !!draggedId.value &&
    dropIndex.value !== -1 &&
    dropIndex.value !== draggedIndex.value &&
    dropIndex.value !== draggedIndex.value + 1,
)

function isDropBefore(index: number) {
  return movesTab.value && dropIndex.value === index
}

function onDrop() {
  if (draggedId.value && movesTab.value) {
    const target = dropIndex.value > draggedIndex.value ? dropIndex.value - 1 : dropIndex.value
    props.editor.commands.reorderTab(draggedId.value, target)
  }
  stopDragging()
}

function stopDragging() {
  draggedId.value = null
  draggedIndex.value = -1
  dropIndex.value = -1
}

function copyTabLink(id: string) {
  const [page] = window.location.href.split('#')
  return navigator.clipboard.writeText(`${page}#${id}`)
}

function tabActions(id: string): ContextMenuOptions {
  const copy = { label: 'Copy link', icon: 'lucide-link', onClick: () => copyTabLink(id) }
  if (!props.editable) return [copy]
  return [
    { label: 'Rename', icon: 'lucide-pencil', onClick: () => void startRenaming(id) },
    copy,
    {
      group: '',
      hideLabel: true,
      options: [
        {
          label: 'Delete',
          icon: 'lucide-trash',
          theme: 'red',
          onClick: () => props.editor.commands.deleteTab(id),
        },
      ],
    },
  ]
}
</script>

<style scoped>
.tab-cell > * {
  grid-area: 1 / 1;
}

/* Text sits exactly where the tab's own label sits, and the field adds no width of its own, so renaming starts in place. */
.tab-name-field {
  @apply w-0 min-w-full rounded-[7px] border-0 bg-transparent px-2 py-0 text-base leading-tighter text-ink-gray-8 outline-none ring-1 ring-inset ring-outline-gray-3;
}

.tab-name-field:focus {
  @apply border-0 shadow-none outline-none ring-1 ring-inset ring-outline-gray-3;
}

/* No position of its own: the sliding highlight measures tabs against the list. */
.drop-mark {
  @apply -mx-px h-4 w-0.5 shrink-0 bg-surface-gray-7;
}
</style>
