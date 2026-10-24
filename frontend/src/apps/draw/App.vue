<script setup lang="ts">
import './styles.css'

import { Button, TextInput } from 'frappe-ui'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { translate as __ } from '@/platform/translation'

import { useDrawingPersistence } from './canvas/persistence'
import type { DrawingTool } from './canvas/tools'
import DrawingToolbar from './components/DrawingToolbar.vue'
import InfiniteCanvas from './components/InfiniteCanvas.vue'
import drawLogo from './logo.svg'

const persistence = useDrawingPersistence()
const { drawingTitle, editable, dirty, saving, drawingLoading, loadError } = persistence
const title = drawingTitle
const titleDraft = ref(title.value)
const editingTitle = ref(false)
const titleInput = ref<InstanceType<typeof TextInput> | null>(null)
const canvas = ref<InstanceType<typeof InfiniteCanvas> | null>(null)
const activeTool = ref<DrawingTool | null>('select')
let lastTool: DrawingTool = 'select'

function startRenaming() {
  titleDraft.value = title.value
  editingTitle.value = true
  nextTick(() => {
    titleInput.value?.inputElement?.focus()
    titleInput.value?.inputElement?.select()
  })
}

async function finishRenaming() {
  if (!editingTitle.value) return
  editingTitle.value = false
  if (editable.value && titleDraft.value.trim() && titleDraft.value.trim() !== title.value) {
    try {
      await persistence.session.rename(titleDraft.value.trim())
    } catch (error) {
      persistence.error.value =
        error instanceof Error ? error.message : __('Could not rename the drawing.')
    }
  }
  nextTick(() => document.querySelector<HTMLElement>('.infinite-canvas')?.focus())
}
function cancelRenaming() {
  titleDraft.value = title.value
  editingTitle.value = false
}
defineExpose({
  flush: async () => {
    await canvas.value?.flush()
  },
})

function selectTool(tool: DrawingTool) {
  if (!editable.value) return
  if (tool === 'eraser' && activeTool.value !== 'eraser') lastTool = activeTool.value ?? 'select'
  activeTool.value = tool
  if (tool === 'image') canvas.value?.openImagePicker()
}

function finishTool() {
  activeTool.value = 'select'
}

function cancelTool() {
  activeTool.value = activeTool.value === 'eraser' ? lastTool : 'select'
}

function onToolShortcut(event: KeyboardEvent) {
  if (!editable.value) return
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
  const shortcuts: Record<string, DrawingTool> = {
    r: 'rectangle',
    d: 'diamond',
    c: 'ellipse',
    o: 'ellipse',
    l: 'line',
    a: 'arrow',
    t: 'text',
    i: 'image',
    k: 'laser',
    p: 'draw',
    e: 'eraser',
    '0': 'eraser',
  }
  const tool = shortcuts[event.key.toLowerCase()]
  if (tool) {
    event.preventDefault()
    selectTool(tool)
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
    <header class="drawing-header" :aria-label="__('Drawing header')">
      <RouterLink to="/home" :aria-label="__('Back to Suite')">
        <img class="draw-logo" :src="drawLogo" :alt="__('Draw')" width="24" height="24" />
      </RouterLink>
      <h1 class="drawing-title">
        <TextInput
          v-if="editingTitle"
          ref="titleInput"
          v-model="titleDraft"
          class="title-field"
          :aria-label="__('Drawing title')"
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
          :aria-label="__('Rename drawing')"
          :disabled="!editable"
          @click="startRenaming"
        >
          {{ title }}
        </button>
      </h1>
      <DrawingToolbar
        :active-tool="activeTool"
        :inert="!editable || undefined"
        @select="selectTool"
      />
      <span
        class="ml-auto whitespace-nowrap text-sm text-ink-gray-5"
        role="status"
        aria-live="polite"
      >
        {{
          drawingLoading
            ? __('Loading…')
            : loadError
              ? __('Could not load')
              : saving
                ? __('Saving…')
                : dirty
                  ? __('Unsaved changes')
                  : __('Saved')
        }}
      </span>
      <Button
        v-if="persistence.session.canShare.value"
        :label="__('Share')"
        @click="persistence.session.share()"
      />
    </header>
    <InfiniteCanvas
      ref="canvas"
      :active-tool="activeTool"
      @cancel-tool="cancelTool"
      @rectangle-created="finishTool"
      @diamond-created="finishTool"
      @ellipse-created="finishTool"
      @line-created="finishTool"
    />
  </main>
</template>
