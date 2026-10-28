<template>
  <div class="grid grid-cols-6 gap-1.5 p-1" :style="palette" role="group" :aria-label="__('Color')">
    <!-- A native title: frappe-ui's Tooltip does not open on hover inside the menu -->
    <button
      v-for="swatch in SWATCHES"
      :key="swatch.label"
      type="button"
      class="writer-swatch"
      :class="!swatch.name && 'is-none'"
      :style="{
        backgroundColor: swatch.name ? `var(--prose-highlight-${swatch.name})` : undefined,
        borderColor: swatch.name
          ? `color-mix(in srgb, var(--prose-color-${swatch.name}) 35%, transparent)`
          : 'var(--outline-gray-2)',
      }"
      :aria-label="__(swatch.label)"
      :title="__(swatch.label)"
      @click="emit('pick', swatch.name)"
    />
  </div>
</template>

<script setup lang="ts">
import { translate as __ } from '@/platform/translation'

const props = defineProps<{ editorElement: Element }>()
const emit = defineEmits<{ pick: [name: string | null] }>()

// frappe-ui's named palette, as the bubble menu's colour panel offers it
const PALETTE = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'gray',
] as const

const SWATCHES = [
  { name: null, label: 'Default' },
  ...PALETTE.map((name) => ({ name, label: name[0].toUpperCase() + name.slice(1) })),
]

// The palette's variables are set on the editor's element, and the menu opens outside it
const style = getComputedStyle(props.editorElement)
const palette = Object.fromEntries(
  PALETTE.flatMap((name) =>
    ['color', 'highlight'].map((kind) => {
      const variable = `--prose-${kind}-${name}`
      return [variable, style.getPropertyValue(variable)]
    }),
  ),
)
</script>
