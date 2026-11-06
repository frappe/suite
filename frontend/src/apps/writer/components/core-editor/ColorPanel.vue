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
import { toRef } from 'vue'

import { translate as __ } from '@/platform/translation'

import { highlightSwatchStyle, PALETTE, paletteVariables, swatchBorder, SWATCHES } from './palette'
import { useLiveEditorState } from './useEditorVersion'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ pick: [] }>()

const palette = paletteVariables(props.editor.view.dom)

const { live } = useLiveEditorState(toRef(props, 'editor'))

function activeName(mark: string) {
  return PALETTE.find((name) => props.editor.isActive(mark, { color: name })) ?? null
}

const sections = live(() => [
  {
    label: 'Text color',
    remove: 'Remove text color',
    letter: true,
    active: activeName('textStyle'),
    style: (name: string | null) => ({
      color: name ? `var(--prose-color-${name})` : 'var(--ink-gray-9)',
      borderColor: swatchBorder(name),
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
    style: highlightSwatchStyle,
    set: (name: string | null) =>
      name
        ? props.editor.chain().focus().setMark('namedHighlight', { color: name }).run()
        : props.editor.chain().focus().unsetHighlight().run(),
  },
])

function pick(set: (name: string | null) => boolean, name: string | null) {
  set(name)
  emit('pick')
}
</script>
