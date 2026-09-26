<script setup lang="ts">
import './styles.css'
import { drawingTitle } from './canvas/persistence'
import { TextInput } from 'frappe-ui'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import drawLogo from './assets/draw-logo.svg'
import type { DrawingTool } from './canvas/tools'
import DrawingToolbar from './components/DrawingToolbar.vue'
import InfiniteCanvas from './components/InfiniteCanvas.vue'

const title = drawingTitle
const titleDraft = ref(title.value)
const editingTitle = ref(false)
const titleInput = ref<{ el: HTMLInputElement | null } | null>(null)
const activeTool = ref<DrawingTool | null>('select')
let lastTool: DrawingTool = 'select'

function startRenaming() {
  titleDraft.value = title.value
  editingTitle.value = true
  nextTick(() => {
    titleInput.value?.el?.focus()
    titleInput.value?.el?.select()
  })
}

function finishRenaming() {
  if (!editingTitle.value) return
  title.value = titleDraft.value.trim() || 'Untitled Drawing'
  editingTitle.value = false
  nextTick(() => document.querySelector<HTMLElement>('.infinite-canvas')?.focus())
}
function cancelRenaming() { titleDraft.value = title.value; finishRenaming() }

function selectTool(tool: DrawingTool) {
  if (tool === 'eraser' && activeTool.value !== 'eraser') lastTool = activeTool.value ?? 'select'
  activeTool.value = tool
}

function finishTool() {
  activeTool.value = 'select'
}

function cancelTool() {
  activeTool.value = activeTool.value === 'eraser' ? lastTool : 'select'
}

function onToolShortcut(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
  if (event.key.toLowerCase() === 't') {
    event.preventDefault()
    selectTool('text')
  } else if (event.key.toLowerCase() === 'i') {
    event.preventDefault()
    selectTool('image')
  } else if (event.key.toLowerCase() === 'k') {
    event.preventDefault()
    selectTool('laser')
  } else if (event.key.toLowerCase() === 'p') {
    event.preventDefault()
    selectTool('draw')
  } else if (event.key.toLowerCase() === 'e' || event.key === '0') {
    event.preventDefault()
    selectTool('eraser')
  } else if (event.key.toLowerCase() === 'd') {
    event.preventDefault()
    selectTool('diamond')
  } else if (event.key.toLowerCase() === 'a') {
    event.preventDefault()
    selectTool('arrow')
  }
}

function isPageZoomShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  return ['+', '-', '=', '0', 'Add', 'Subtract'].includes(event.key)
}

function preventPageZoom(event: WheelEvent | KeyboardEvent) {
  if (event instanceof WheelEvent) {
    if (event.ctrlKey || event.metaKey) event.preventDefault()
    return
  }
  if (isPageZoomShortcut(event)) event.preventDefault()
}

function preventPagePinch(event: Event) {
  event.preventDefault()
}

onMounted(() => {
  window.addEventListener('wheel', preventPageZoom, { capture: true, passive: false })
  window.addEventListener('keydown', preventPageZoom, true)
  window.addEventListener('keydown', onToolShortcut, true)
  window.addEventListener('gesturestart', preventPagePinch, { passive: false })
  window.addEventListener('gesturechange', preventPagePinch, { passive: false })
})

onBeforeUnmount(() => {
  window.removeEventListener('wheel', preventPageZoom, true)
  window.removeEventListener('keydown', preventPageZoom, true)
  window.removeEventListener('keydown', onToolShortcut, true)
  window.removeEventListener('gesturestart', preventPagePinch)
  window.removeEventListener('gesturechange', preventPagePinch)
})
</script>

<template>
  <main class="app-shell">
    <header class="drawing-header" aria-label="Drawing header">
      <div class="header-side header-left">
        <RouterLink to="/suite" aria-label="Back to Suite">
          <img class="draw-logo" :src="drawLogo" alt="Draw" width="24" height="24" />
        </RouterLink>
      </div>
      <h1 class="drawing-title">
        <TextInput
          v-if="editingTitle"
          ref="titleInput"
          v-model="titleDraft"
          class="title-field"
          aria-label="Drawing title"
          spellcheck="false"
          variant="outline"
          @blur="finishRenaming"
          @keyup.enter="finishRenaming"
          @keydown.esc.stop.prevent="cancelRenaming"
        />
        <button
          v-else
          class="title-button"
          type="button"
          aria-label="Rename drawing"
          @click="startRenaming"
        >
          {{ title }}
        </button>
      </h1>
    </header>
    <DrawingToolbar :active-tool="activeTool" @select="selectTool" />
    <InfiniteCanvas
      :active-tool="activeTool"
      @activate-rectangle="activeTool = 'rectangle'"
      @activate-diamond="activeTool = 'diamond'"
      @activate-ellipse="activeTool = 'ellipse'"
      @activate-line="activeTool = 'line'"
      @activate-arrow="activeTool = 'arrow'"
      @activate-text="activeTool = 'text'"
      @activate-image="activeTool = 'image'"
      @activate-draw="activeTool = 'draw'"
      @activate-eraser="selectTool('eraser')"

      @cancel-tool="cancelTool"
      @rectangle-created="finishTool"
      @diamond-created="finishTool"
      @ellipse-created="finishTool"
      @line-created="finishTool"
    />
  </main>
</template>
