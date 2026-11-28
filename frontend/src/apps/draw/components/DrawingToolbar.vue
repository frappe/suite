<script setup lang="ts">
import { Button, Dropdown, Tooltip, TooltipProvider } from 'frappe-ui'
import {
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  ImagePlus,
  LassoSelect,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Type,
} from 'lucide-vue-next'
import { computed, defineComponent, h } from 'vue'

import { translate as __ } from '@/platform/translation'

import laserPointerIcon from '../assets/laser-pointer.svg?no-inline'
import type { DrawingTool } from '../canvas/tools'

const tools: ReadonlyArray<{
  label: string
  icon?: typeof Square
  value: DrawingTool
  shortcut?: string
}> = [
  { label: __('Select'), icon: MousePointer2, value: 'select', shortcut: 'Escape' },
  { label: __('Rectangle'), icon: Square, value: 'rectangle', shortcut: 'R' },
  { label: __('Diamond'), icon: Diamond, value: 'diamond', shortcut: 'D' },
  { label: __('Ellipse'), icon: Circle, value: 'ellipse', shortcut: 'O' },
  { label: __('Line'), icon: Minus, value: 'line', shortcut: 'L' },
  { label: __('Arrows'), icon: ArrowRight, value: 'arrow', shortcut: 'A' },
  { label: __('Draw'), icon: Pencil, value: 'draw', shortcut: 'P' },
  { label: __('Eraser'), icon: Eraser, value: 'eraser', shortcut: 'E' },
  { label: __('Text'), icon: Type, value: 'text', shortcut: 'T' },
]

const props = defineProps<{ activeTool: DrawingTool | null }>()

const emit = defineEmits<{ select: [tool: DrawingTool] }>()

const LaserPointerIcon = defineComponent(
  () => () =>
    h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true', class: 'text-ink-gray-8' }, [
      h('use', { href: `${laserPointerIcon}#laser-pointer` }),
    ]),
)

const overflowTools = computed(() =>
  (
    [
      { value: 'image', label: __('Insert Image'), icon: ImagePlus },
      { value: 'laser', label: __('Laser Pointer'), icon: LaserPointerIcon },
      { value: 'lasso', label: __('Lasso Select'), icon: LassoSelect },
    ] as const
  ).map(({ value, ...tool }) => ({
    ...tool,
    selected: props.activeTool === value,
    onClick: () => emit('select', value),
  })),
)
</script>

<template>
  <nav class="drawing-toolbar" :aria-label="__('Drawing tools')">
    <TooltipProvider>
      <div class="drawing-toolbar__surface" role="toolbar" :aria-label="__('Drawing tools')">
        <Tooltip
          v-for="tool in tools"
          :key="tool.label"
          :text="
            tool.value === 'select'
              ? 'Pointer - Esc'
              : tool.shortcut
                ? `${tool.label} - ${tool.shortcut}`
                : tool.label
          "
          placement="top"
        >
          <Button
            class="drawing-tool"
            size="sm"
            variant="ghost"
            theme="gray"
            :label="tool.label"
            :aria-label="tool.label"
            :data-state="activeTool === tool.value ? 'active' : undefined"
            :icon="tool.icon"
            :aria-pressed="activeTool === tool.value"
            :aria-keyshortcuts="tool.shortcut"
            @click="emit('select', tool.value)"
          />
        </Tooltip>
        <Dropdown
          class="drawing-tool"
          :aria-pressed="overflowTools.some((tool) => tool.selected)"
          align="end"
          :offset="12"
          :options="overflowTools"
          :button="{
            icon: 'lucide-more-horizontal',
            label: __('More tools'),
            size: 'md',
            variant: 'ghost',
            theme: 'gray',
          }"
        />
      </div>
    </TooltipProvider>
  </nav>
</template>

<style scoped>
.drawing-toolbar {
  position: absolute;
  top: 12px;
  right: 0;
  left: 0;
  z-index: 1;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.drawing-toolbar__surface {
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 32px);
  height: 36px;
  padding: 3px;
  overflow-x: auto;
  scrollbar-width: none;
  border: 1px solid var(--outline-elevation-2);
  border-radius: 10px;
  background: var(--surface-elevation-2);
  box-shadow: var(--shadow-sm);
  pointer-events: auto;
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

.drawing-toolbar__surface :deep(button[aria-pressed='true']) {
  color: var(--ink-gray-8);
  background: var(--surface-gray-4);
  box-shadow: inset 0 0 0 1px var(--outline-gray-3);
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
