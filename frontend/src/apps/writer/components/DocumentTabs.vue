<template>
  <div
    v-if="tabs.length"
    class="hidden h-9 shrink-0 items-center border-b border-outline-gray-1 px-3 md:flex"
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
            <TextInput
              v-if="isRenaming(tab.id)"
              v-model="renamedLabel"
              v-on-outside-click="() => finishRenaming()"
              class="shrink-0"
              :style="{ width: `${Math.max(renamedLabel.length + 4, 10)}ch` }"
              size="sm"
              autofocus
              aria-label="Tab name"
              @keydown.enter="finishRenaming()"
              @keydown.esc="stopRenaming()"
            />
            <!-- Stays mounted while renaming: Tabs selects the first tab when the selected trigger goes away. -->
            <ContextMenu :options="tabActions(tab.id)">
              <TabTrigger
                v-show="!isRenaming(tab.id)"
                :value="tab.id"
                :label="tab.label"
                class="shrink-0"
                :class="tab.id === draggedId && 'opacity-40'"
                :draggable="editable"
                @dblclick="editable && startRenaming(tab.id)"
                @dragstart="onDragStart($event, tab.id, index)"
                @dragover.prevent="onDragOver($event, index)"
                @dragend="stopDragging"
              />
            </ContextMenu>
          </template>
          <span v-if="isDropBefore(tabs.length)" class="drop-mark" aria-hidden="true" />
        </TabList>
      </div>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { ContextMenu, TabList, Tabs, TabTrigger, TextInput, vOnOutsideClick } from 'frappe-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { useDocumentTabs } from './useDocumentTabs'

const props = defineProps<{ editor: Editor; editable: boolean }>()

const { tabs, activeTabId } = useDocumentTabs(props.editor)

function selectTab(id: string) {
  if (id !== activeTabId.value) props.editor.commands.changeTab(id)
}

const renamingId = ref<string | null>(null)
const renamedLabel = ref('')
// The field waits for the closing menu, whose click would otherwise count as a click outside it
const isRenameReady = ref(false)

function isRenaming(id: string) {
  return renamingId.value === id && isRenameReady.value
}

async function startRenaming(id: string) {
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
  if (renamingId.value && label) props.editor.commands.renameTab(renamingId.value, label, refocus)
  stopRenaming(refocus)
}

// Moving to another tab keeps a rename; the first click of a double-click selects the tab being renamed.
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

function tabActions(id: string) {
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
/* No position of its own: the sliding highlight measures tabs against the list. */
.drop-mark {
  @apply -mx-px h-4 w-0.5 shrink-0 bg-surface-gray-7;
}
</style>
