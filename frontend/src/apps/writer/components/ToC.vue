<template>
  <div v-if="editor && (hasContent || editor.isEditable)"
    class="gap-2 hidden md:block overflow-y-auto overflow-x-hidden flex-shrink-0 h-full transition-[width] duration-300 ease-in-out"
    :class="[show ? 'w-56 p-2' : 'w-12 p-2.5']">
    <div v-if="!show" class="flex justify-center">
      <Button variant="ghost" :icon="LucideTableOfContents" tooltip="Table of Contents" @click="show = !show" />
    </div>
    <div v-if="show" class="grow flex flex-col gap-0.5 w-52">
      <div v-if="hasContent" class="flex justify-between items-center ps-2 pr-1 pb-1">
        <span class="text-base-medium text-ink-gray-8 select-none whitespace-nowrap">Table of Contents</span>
        <Button :icon="LucideLeftClose" variant="ghost" @click="show = !show" tooltip="Hide" />
      </div>
      <div v-if="tabs.length > 0" class="flex flex-col gap-0.5 mb-2" @drop.prevent="onDrop">
        <div v-for="(tab, index) in tabs" :key="tab.id" :class="[
          'relative transition-all duration-200',
          dragState.isDragging &&
          dragState.draggedId === tab.id &&
          'opacity-0',
        ]" @dragover.prevent="onDragOver($event, index)">
          <div v-if="
            dragState.isDragging &&
            dragState.dropIndex === index &&
            dragState.dropIndex !== dragState.draggedIndex &&
            dragState.dropIndex !== dragState.draggedIndex + 1
          " class="h-8 my-0.5 border border-dashed rounded-1 mx-2" />
          <div v-if="editingTabId === tab.id && delayedEdit" class="flex items-center">
            <TextInput v-model="editingTabLabel" v-on-outside-click="() => finishRenaming(false)" autofocus
              aria-label="Tab name" @keydown.enter="finishRenaming(false)" @keydown.esc="finishRenaming(true)"
              class="w-full">
              <template #prefix>
                <LucideFileText class="size-4" />
              </template>
            </TextInput>
          </div>
          <component v-else :is="tab.id === activeTabId ? ContextMenu : 'div'" :options="tabActions">
            <div class="relative">
              <Button variant="ghost" class="w-full !text-ink-gray-5 !justify-start cursor-grab active:cursor-grabbing"
                :class="[
                  tab.id === activeTabId && 'font-medium !text-ink-gray-8',
                  tab.id === activeTabId && editor.isEditable && 'pr-7',
                ]" :label="tab.label" @click="
                  tab.id !== activeTabId && editor.commands.changeTab(tab.id)
                  " :draggable="editor.isEditable" @dragstart="onDragStart($event, tab, index)"
                @dragend.prevent="onDragEnd">
                <template #prefix>
                  <span v-if="tab.id === activeTabId && currentTabAnchors.length" role="button"
                    class="shrink-0 cursor-pointer" @click.stop="showHeadings = !showHeadings">
                    <LucideChevronRight class="size-4 transition-transform duration-200"
                      :class="showHeadings && 'rotate-90'" />
                  </span>
                  <LucideFileText v-else class="size-4 shrink-0" />
                </template>
              </Button>
              <Button v-if="tab.id === activeTabId && editor.isEditable" variant="ghost"
                class="absolute right-0.5 top-1/2 -translate-y-1/2" :icon="LucideEllipsisVertical" label="Tab options"
                @click.stop="openTabMenu" />
            </div>
          </component>
          <template v-if="tab.id === activeTabId && currentTabAnchors.length">
            <div v-if="showHeadings" class="table-of-contents flex flex-col gap-0.5 ms-6 my-1">
              <div v-for="anchor in currentTabAnchors" class="flex pr-2.5">
                <a :href="'#' + anchor.id"
                  class="link text-ink-gray-5 hover:bg-surface-gray-2 text-sm px-2 py-1 rounded-1 cursor-pointer truncate grow"
                  :title="anchor.textContent" :data-item-index="anchor.itemIndex"
                  @click.prevent="onAnchorClick(anchor.id)" :key="anchor.id" :class="anchor.isActive &&
                    'text-ink-gray-8 bg-surface-gray-3 hover:bg-surface-gray-4'
                    " :style="{ '--level': anchor.level - maxLevel }">
                  {{ anchor.textContent }}
                </a>
              </div>
            </div>
          </template>
        </div>
        <div v-if="dragState.isDragging && dragState.dropIndex === tabs.length" @dragover.prevent
          class="h-8 my-0.5 border border-dashed rounded-1 mx-2" />
      </div>
      <div v-else-if="anchors.length > 1" class="table-of-contents flex flex-col gap-0.5 mb-2 px-0.5 pr-2.5">
        <div v-for="anchor in anchors" class="flex">
          <a :href="'#' + anchor.id"
            class="link text-ink-gray-5 hover:bg-surface-gray-2 text-sm px-2 py-1 rounded-1 cursor-pointer truncate grow"
            :title="anchor.textContent" :data-item-index="anchor.itemIndex" @click.prevent="onAnchorClick(anchor.id)"
            :key="anchor.id" :class="anchor.isActive && 'text-ink-gray-8'"
            :style="{ '--level': anchor.level - maxLevel }">
            {{ anchor.textContent }}
          </a>
        </div>
      </div>
      <div v-if="editor.isEditable" class="flex items-center gap-1 pr-1">
        <Button class="grow !justify-start text-xs opacity-50 hover:opacity-100"
          :icon-left="h(LucidePlus, { class: 'size-4' })" :label="tabs.length ? 'Add tab' : 'Create tab'"
          variant="ghost" @click="
            tabs.length
              ? editor.commands.createTab({ label: 'Untitled' })
              : editor.commands.wrapInTab()
            " />
        <Button v-if="!hasContent" :icon="LucideLeftClose" variant="ghost" @click="show = !show" tooltip="Hide" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick } from 'vue'

import { TextSelection } from '@tiptap/pm/state'
import LucidePlus from '~icons/lucide/plus'
import LucideChevronRight from '~icons/lucide/chevron-right'
import LucidePanelLeftClose from '~icons/lucide/panel-left-close'
import LucideFileText from '~icons/lucide/file-text'
import LucideTableOfContents from '~icons/lucide/table-of-contents'
import LucidePencil from '~icons/lucide/pencil'
import LucideLink from '~icons/lucide/link'
import LucideTrash from '~icons/lucide/trash'
import LucideLeftClose from '~icons/lucide/panel-left-close'
import LucideEllipsisVertical from '~icons/lucide/ellipsis-vertical'
import { ref, watch, computed, h, onMounted, onBeforeUnmount } from 'vue'
import { Button, TextInput, ContextMenu, vOnOutsideClick } from 'frappe-ui'
import { copyToClipboard } from '@/apps/drive/sdk'
import { orderedTabs, findTab } from '@/apps/writer/extensions/tabs'

const props = defineProps({
  editor: Object,
  anchors: {
    type: Array,
    default: () => [],
  },
})

const hasContent = computed(
  () => tabs.value.length > 0 || props.anchors.length > 1,
)

const show = ref(JSON.parse(localStorage.getItem('showToc') || 'false'))
watch(show, (v) => localStorage.setItem('showToc', v))
const showHeadings = ref(true)

// Get all tabs from the document
const tabs = ref([])

const updateTabs = () => {
  tabs.value = orderedTabs(props.editor.state.doc).map(({ node }) => ({
    id: node.attrs.id,
    label: node.attrs.label,
  }))
}

// Get active tab ID
const activeTabId = ref()
onMounted(() => {
  updateTabs()
  props.editor.on('update', updateTabs)

  const handleTabChange = (e) => {
    activeTabId.value = e.detail.tabId
    finishRenaming(false, false)
  }

  props.editor.view.dom.addEventListener('tab-changed', handleTabChange)
  onBeforeUnmount(() => {
    props.editor.off('update', updateTabs)
    props.editor.view.dom.removeEventListener('tab-changed', handleTabChange)
  })
})

// Filter anchors to only show those in the current tab
const currentTabAnchors = computed(() => {
  if (tabs.value.length === 0) return props.anchors
  if (!activeTabId.value) return props.anchors

  const tab = findTab(props.editor.state.doc, activeTabId.value)
  if (!tab) return []
  const tabStart = tab.pos
  const tabEnd = tab.pos + tab.node.nodeSize

  // Filter anchors that are within the active tab's position range
  return props.anchors.filter((anchor) => {
    const element = props.editor.view.dom.querySelector(
      `[data-toc-id="${anchor.id}"]`,
    )
    if (!element) return false

    const pos = props.editor.view.posAtDOM(element, 0)
    return pos >= tabStart && pos < tabEnd
  })
})

const maxLevel = computed(() =>
  currentTabAnchors.value.length
    ? Math.min(...currentTabAnchors.value.map((k) => k.level)) - 1
    : 0,
)

const onAnchorClick = (id) => {
  if (!props.editor) return
  const view = props.editor.view
  const tr = view.state.tr

  const element = view.dom.querySelector(`[data-toc-id="${id}"]`)
  const pos = view.posAtDOM(element, 0)
  tr.setSelection(new TextSelection(tr.doc.resolve(pos)))
  props.editor.view.dispatch(tr)
  props.editor.view.focus()
  if (history.pushState) {
    history.pushState(null, null, `#${id}`)
  }

  const editorEl = document.querySelector('#editor-scroll-container')
  editorEl.scrollTo({
    top: element.offsetTop,
  })
}

// The menu lives on the row's ContextMenu trigger, so the button replays a
// contextmenu event on it — that way it opens anchored to the button.
const openTabMenu = (event) => {
  const trigger = event.currentTarget.parentElement
  const rect = event.currentTarget.getBoundingClientRect()
  trigger.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom,
    }),
  )
}

const editingTabId = ref(null)
const editingTabLabel = ref('')
const delayedEdit = ref(false)

const startRenaming = (tabId) => {
  editingTabId.value = tabId
  editingTabLabel.value = tabs.value.find((tab) => tab.id === tabId).label
  nextTick(() => {
    setTimeout(() => {
      delayedEdit.value = true
    }, 50)
  })
}

const finishRenaming = (esc = false, refocus = true) => {
  if (!esc && editingTabId.value && editingTabLabel.value.trim()) {
    props.editor.commands.renameTab(
      editingTabId.value,
      editingTabLabel.value.trim(),
      refocus,
    )
  }
  editingTabId.value = null
  editingTabLabel.value = ''
  delayedEdit.value = false
  if (refocus) props.editor.commands.focus()
}

// Drag and drop state
const dragState = ref({
  isDragging: false,
  draggedId: null,
  draggedIndex: null,
  dropIndex: null,
})

let ghostElement = null

const onDragStart = (event, tab, index) => {
  if (!props.editor.isEditable) return

  dragState.value.isDragging = true
  dragState.value.draggedId = tab.id
  dragState.value.draggedIndex = index

  // Create ghost element
  const target = event.target.closest('button')
  ghostElement = target.cloneNode(true)
  ghostElement.style.position = 'fixed'
  ghostElement.style.pointerEvents = 'none'
  ghostElement.style.opacity = '0.6'
  document.body.appendChild(ghostElement)

  event.dataTransfer.setDragImage(ghostElement, 0, 0)
  event.dataTransfer.effectAllowed = 'move'
}

const onDragOver = (event, index) => {
  if (!dragState.value.isDragging) return

  const rect = event.currentTarget.getBoundingClientRect()
  const midpoint = rect.top + rect.height / 2

  // Determine if we should drop before or after this element
  if (event.clientY < midpoint) {
    dragState.value.dropIndex = index
  } else {
    dragState.value.dropIndex = index + 1
  }
}

const onDrop = () => {
  if (!dragState.value.isDragging) return

  const fromIndex = dragState.value.draggedIndex
  const toIndex = dragState.value.dropIndex

  // Only reorder if position actually changed
  if (fromIndex !== toIndex && toIndex !== fromIndex + 1) {
    const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex
    props.editor.commands.reorderTab(dragState.value.draggedId, adjustedToIndex)
  }

  onDragEnd()
}

const onDragEnd = (event) => {
  if (event?.target?._cleanupDrag) {
    event.target._cleanupDrag()
  }

  if (ghostElement) {
    document.body.removeChild(ghostElement)
    ghostElement = null
  }

  dragState.value.isDragging = false
  dragState.value.draggedId = null
  dragState.value.draggedIndex = null
  dragState.value.dropIndex = null
}

const activeAnchorId = computed(() => {
  if (!currentTabAnchors.value.length) return null
  let activeId = null
  const curPos = props.editor.isFocused
    ? props.editor.view.domAtPos(props.editor.state.selection.from).top
    : props.editor.storage.tableOfContents?.scrollPosition + 25

  for (let i = 0; i < currentTabAnchors.value.length; i++) {
    const anchor = currentTabAnchors.value[i]

    if (anchor.dom.offsetTop <= curPos) {
      activeId = anchor.id
    } else {
      break
    }
  }

  // If no anchor is active yet, use the first one
  return activeId
})

const tabActions = [
  {
    label: 'Rename',
    icon: LucidePencil,
    onClick: () => startRenaming(activeTabId.value),
  },
  {
    label: 'Copy Link',
    icon: LucideLink,
    onClick: () =>
      copyToClipboard(
        window.location.href.split('#')[0] + '#' + activeTabId.value,
      ),
  },
  {
    group: '',
    hideLabel: true,
    options: [
      {
        label: 'Delete',
        icon: LucideTrash,
        theme: 'red',
        onClick: () => props.editor.commands.deleteTab(activeTabId.value),
      },
    ],
  },
]
</script>

<style scoped>
.table-of-contents {
  overflow: auto;
  text-decoration: none;
}

.table-of-contents a {
  text-decoration: none;

  &::before {
    content: '';
  }
}

.table-of-contents .link {
  border-radius: 0.25rem;
  margin-left: calc(0.875rem * (var(--level) - 1));
  transition: all 0.2s cubic-bezier(0.65, 0.05, 0.36, 1);
}
</style>
