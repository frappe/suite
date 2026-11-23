<script setup lang="ts">
import './styles.css'

import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useDrawingPersistence } from './canvas/persistence'
import type { DrawingTool } from './canvas/tools'
import DrawingToolbar from './components/DrawingToolbar.vue'
import InfiniteCanvas from './components/InfiniteCanvas.vue'

const { editable } = useDrawingPersistence()
const canvas = ref<InstanceType<typeof InfiniteCanvas> | null>(null)
const activeTool = ref<DrawingTool | null>('select')
let lastTool: DrawingTool = 'select'

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
  const shortcuts = new Map<string, DrawingTool>(
    Object.entries({
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
    } satisfies Record<string, DrawingTool>),
  )
  const tool = shortcuts.get(event.key.toLowerCase())
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
    <InfiniteCanvas
      ref="canvas"
      :active-tool="activeTool"
      @cancel-tool="cancelTool"
      @rectangle-created="finishTool"
      @diamond-created="finishTool"
      @ellipse-created="finishTool"
      @line-created="finishTool"
    />
    <DrawingToolbar
      :active-tool="activeTool"
      :inert="!editable || undefined"
      @select="selectTool"
    />
  </main>
</template>
