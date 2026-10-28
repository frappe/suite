<template>
  <div
    :style="palette"
    class="flex w-[190px] flex-col gap-4 rounded-6 border border-outline-gray-1 bg-surface-elevation-2 p-2 shadow-lg"
  >
    <div v-for="section in sections" :key="section.label" class="flex flex-col gap-2">
      <div class="flex h-4 items-center justify-between text-sm leading-[15px]">
        <span class="text-ink-gray-5">{{ __(section.label) }}</span>
        <button
          v-if="section.active"
          type="button"
          class="rounded-2 px-1 text-ink-gray-6 hover:bg-surface-gray-2 hover:text-ink-gray-8"
          :aria-label="__(section.remove)"
          @click="pick(section.set, null)"
        >
          {{ __('Remove') }}
        </button>
      </div>
      <div class="grid grid-cols-6 gap-1.5">
        <button
          v-for="swatch in SWATCHES"
          :key="swatch.label"
          type="button"
          class="writer-swatch"
          :style="section.style(swatch.name)"
          :aria-label="__(swatch.label)"
          :title="__(swatch.label)"
          :aria-pressed="section.active === swatch.name"
          @click="pick(section.set, swatch.name)"
        >
          {{ section.letter ? 'A' : '' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { computed, toRef } from 'vue'

import { translate as __ } from '@/platform/translation'

import { useEditorVersion } from './useEditorVersion'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ pick: [] }>()

// frappe-ui's named palette; the editor stores the name and draws it with these variables
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

type Swatch = { name: string | null; label: string }

const SWATCHES: readonly Swatch[] = [
  { name: null, label: 'Default' },
  ...PALETTE.map((name) => ({ name, label: name[0].toUpperCase() + name.slice(1) })),
]

// The palette's variables are set on the editor's element, and this panel opens outside it
const palette = Object.fromEntries(
  PALETTE.flatMap((name) =>
    ['color', 'highlight'].map((kind) => {
      const variable = `--prose-${kind}-${name}`
      return [variable, getComputedStyle(props.editor.view.dom).getPropertyValue(variable)]
    }),
  ),
)

const version = useEditorVersion(toRef(props, 'editor'))

function activeName(mark: string) {
  return PALETTE.find((name) => props.editor.isActive(mark, { color: name })) ?? null
}

const sections = computed(() => {
  void version.value
  return [
    {
      label: 'Text color',
      remove: 'Remove text color',
      letter: true,
      active: activeName('textStyle'),
      style: (name: string | null) => ({
        color: name ? `var(--prose-color-${name})` : 'var(--ink-gray-9)',
        borderColor: lineOf(name),
      }),
      set: (name: string | null) =>
        name
          ? props.editor.chain().focus().setColorByName(name).run()
          : props.editor.chain().focus().unsetColor().run(),
    },
    {
      label: 'Background color',
      remove: 'Remove background color',
      letter: false,
      active: activeName('namedHighlight'),
      style: (name: string | null) => ({
        backgroundColor: name ? `var(--prose-highlight-${name})` : undefined,
        borderColor: lineOf(name),
      }),
      set: (name: string | null) =>
        name
          ? props.editor.chain().focus().setMark('namedHighlight', { color: name }).run()
          : props.editor.chain().focus().unsetHighlight().run(),
    },
  ]
})

function lineOf(name: string | null) {
  return name
    ? `color-mix(in srgb, var(--prose-color-${name}) 35%, transparent)`
    : 'var(--outline-gray-2)'
}

function pick(set: (name: string | null) => boolean, name: string | null) {
  set(name)
  emit('pick')
}
</script>
