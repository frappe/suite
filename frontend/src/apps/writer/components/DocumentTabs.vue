<template>
  <div
    v-if="tabs.length"
    class="hidden h-9 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-outline-gray-1 px-3 md:flex"
    @drop.prevent="onDrop"
    @dragover.prevent
  >
    <div
      v-for="(tab, index) in tabs"
      :key="tab.id"
      class="relative flex shrink-0 items-center"
      :class="tab.id === draggedId && 'opacity-40'"
      @dragover.prevent="onDragOver($event, index)"
    >
      <span
        v-if="isDropBefore(index)"
        class="absolute -start-0.5 inset-y-2 w-0.5 bg-surface-gray-7"
        aria-hidden="true"
      />
      <span
        v-if="isDropAfter(index)"
        class="absolute -end-0.5 inset-y-2 w-0.5 bg-surface-gray-7"
        aria-hidden="true"
      />
      <TextInput
        v-if="renamingId === tab.id && isRenameReady"
        v-model="renamedLabel"
        v-on-outside-click="() => finishRenaming()"
        class="w-40"
        size="sm"
        autofocus
        aria-label="Tab name"
        @keydown.enter="finishRenaming()"
        @keydown.esc="stopRenaming()"
      />
      <component :is="tab.id === activeTabId ? ContextMenu : 'div'" v-else :options="tabActions">
        <div class="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            :class="tab.id === activeTabId ? '!text-ink-gray-8 font-medium' : '!text-ink-gray-5'"
            :label="tab.label"
            :draggable="editor.isEditable"
            :aria-current="tab.id === activeTabId ? 'page' : undefined"
            @click="selectTab(tab.id)"
            @dragstart="onDragStart($event, tab.id, index)"
            @dragend="stopDragging"
          />
          <Button
            v-if="tab.id === activeTabId && editor.isEditable"
            variant="ghost"
            size="sm"
            icon="lucide-ellipsis"
            aria-label="Tab options"
            @click.stop="openTabMenu"
          />
        </div>
      </component>
      <span
        v-if="tab.id === activeTabId"
        class="absolute inset-x-1 bottom-0 h-[1.5px] bg-surface-gray-7"
        aria-hidden="true"
      />
    </div>
    <Button
      v-if="editor.isEditable"
      class="shrink-0 self-center"
      variant="ghost"
      size="sm"
      icon="lucide-plus"
      :tooltip="__('Add tab')"
      :aria-label="__('Add tab')"
      @click="addTab"
    />
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Button, ContextMenu, TextInput, vOnOutsideClick } from 'frappe-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { FIRST_TAB_ID } from '@/apps/writer/extensions/tabs'

import { useDocumentTabs } from './useDocumentTabs'

const props = defineProps<{ editor: Editor }>()

const { tabs, activeTabId } = useDocumentTabs(props.editor)

function selectTab(id: string) {
  if (id !== activeTabId.value) props.editor.commands.changeTab(id)
}

function addTab() {
  props.editor.commands.createTab({ label: 'Untitled' })
}

/** The menu lives on the tab's ContextMenu trigger, so the button replays a contextmenu event on it, anchored to the button. */
function openTabMenu(event: MouseEvent) {
  const button = event.currentTarget as HTMLElement
  const { left, width, bottom } = button.getBoundingClientRect()
  button.parentElement?.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: left + width / 2,
      clientY: bottom,
    }),
  )
}

const renamingId = ref<string | null>(null)
const renamedLabel = ref('')
// The field waits for the closing menu, whose click would otherwise count as a click outside it
const isRenameReady = ref(false)

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

watch(activeTabId, () => finishRenaming(false))

const draggedId = ref<string | null>(null)
const draggedIndex = ref(-1)
const dropIndex = ref(-1)

function onDragStart(event: DragEvent, id: string, index: number) {
  if (!props.editor.isEditable || !event.dataTransfer) return
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

function isDropAfter(index: number) {
  return movesTab.value && index === tabs.value.length - 1 && dropIndex.value === tabs.value.length
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

function copyTabLink() {
  const [page] = window.location.href.split('#')
  return navigator.clipboard.writeText(`${page}#${activeTabId.value}`)
}

const tabActions = computed(() => {
  const id = activeTabId.value ?? ''
  const isOnlyFirstTab = id === FIRST_TAB_ID && tabs.value.length === 1
  return [
    ...(props.editor.can().renameTab(id, '')
      ? [{ label: 'Rename', icon: 'lucide-pencil', onClick: () => void startRenaming(id) }]
      : []),
    { label: 'Copy link', icon: 'lucide-link', onClick: copyTabLink },
    ...(isOnlyFirstTab
      ? []
      : [
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
        ]),
  ]
})
</script>
