<script setup lang="ts">
import { defineComponent, h } from 'vue'
import { Button } from 'frappe-ui'
import { Dropdown } from 'frappe-ui'

import { Tooltip } from 'frappe-ui'
import { TooltipProvider } from 'frappe-ui'
import { ArrowRight, Circle, Diamond, Eraser, ImagePlus, Minus, MousePointer2, Pencil, Square, Type } from 'lucide-vue-next'
import laserPointerIcon from '../assets/laser-pointer.svg?no-inline'
import type { DrawingTool } from '../canvas/tools'

const tools: ReadonlyArray<{ label: string; icon?: typeof Square; value: DrawingTool; shortcut?: string }> = [
  { label: 'Select', icon: MousePointer2, value: 'select', shortcut: 'Escape' },
  { label: 'Rectangle', icon: Square, value: 'rectangle', shortcut: 'R' },
  { label: 'Diamond', icon: Diamond, value: 'diamond', shortcut: 'D' },
  { label: 'Ellipse', icon: Circle, value: 'ellipse', shortcut: 'O' },
  { label: 'Line', icon: Minus, value: 'line', shortcut: 'L' },
  { label: 'Arrows', icon: ArrowRight, value: 'arrow', shortcut: 'A' },
  { label: 'Draw', icon: Pencil, value: 'draw', shortcut: 'P' },
  { label: 'Eraser', icon: Eraser, value: 'eraser', shortcut: 'E' },
  { label: 'Text', icon: Type, value: 'text', shortcut: 'T' },
]

defineProps<{ activeTool: DrawingTool | null }>()

const emit = defineEmits<{ select: [tool: DrawingTool] }>()

const LaserPointerIcon = defineComponent(() => () => h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, [
  h('use', { href: `${laserPointerIcon}#laser-pointer` }),
]))

const overflowTools = [
  { label: 'Insert image', icon: ImagePlus, onClick: () => emit('select', 'image') },
  { label: 'Laser pointer', icon: LaserPointerIcon, onClick: () => emit('select', 'laser') },
]
</script>

<template>
  <nav class="drawing-toolbar" aria-label="Drawing tools">
    <TooltipProvider>
      <div class="drawing-toolbar__surface" role="toolbar" aria-label="Drawing tools">
        <Tooltip v-for="tool in tools" :key="tool.label" :text="tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label" placement="top">
          <Button
            class="drawing-tool"
            size="sm"
            variant="ghost"
            theme="gray"
            :label="tool.label"
            :aria-label="tool.label"
            :class="{ 'is-active': activeTool === tool.value }"
            :icon="tool.icon"
            :aria-pressed="activeTool === tool.value"
            :aria-keyshortcuts="tool.shortcut"
            @click="emit('select', tool.value)"
          />
        </Tooltip>
        <Dropdown
          class="drawing-tool"
          align="end"
          :offset="12"
          :options="overflowTools"
          :button="{ icon: 'lucide-more-horizontal', label: 'More tools', size: 'md', variant: 'ghost', theme: 'gray' }"
        />
      </div>
    </TooltipProvider>
  </nav>
</template>

<style scoped>
.drawing-toolbar {
  position: fixed;
  top: 56px;
  right: 0;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  pointer-events: none;
}

.drawing-toolbar__surface {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 36px;
  padding: 3px;
  border: 1px solid var(--outline-gray-1);
  border-radius: 10px;
  background: var(--surface-base);
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
  pointer-events: none;
}

.drawing-toolbar__surface :deep(button) {
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  pointer-events: auto;
}

.drawing-toolbar__surface :deep(button svg),
.drawing-toolbar__surface :deep(button [class*='lucide-']) {
  width: 16px;
  height: 16px;
}

.drawing-toolbar__surface :deep(button.drawing-tool svg) {
  stroke-width: 1.5;
}

.drawing-tool.is-active {
  color: var(--ink-gray-8);
  background: var(--surface-gray-3);
}

@media (pointer: coarse) {
  .drawing-toolbar__surface {
    height: 52px;
  }

  .drawing-toolbar__surface :deep(button) {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }
}
</style>
