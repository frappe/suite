<template>
  <Popover side="bottom" align="start">
    <template #trigger>
      <ToolbarButton :label="__('Custom spacing')">
        <span class="lucide-align-vertical-space-around size-4" aria-hidden="true" />
        <span class="lucide-chevron-down size-3.5" aria-hidden="true" />
      </ToolbarButton>
    </template>
    <template #default>
      <div class="flex w-64 flex-col gap-3 p-3">
        <FormControl
          type="number"
          v-model.number="local.lineSpacing"
          autocomplete="off"
          min="0.5"
          max="10"
          step="0.05"
          @update:modelValue="applyLineSpacing"
          :label="__('Line spacing')"
        />
        <div class="grid grid-cols-2 gap-2">
          <FormControl
            type="number"
            autocomplete="off"
            v-model.number="local.spacingBefore"
            @update:modelValue="applySpacing"
            placeholder="0"
            :label="__('Space above')"
          />
          <FormControl
            type="number"
            autocomplete="off"
            v-model.number="local.spacingAfter"
            @update:modelValue="applySpacing"
            placeholder="0"
            :label="__('Space below')"
          />
        </div>
      </div>
    </template>
  </Popover>
</template>

<script setup>
import { FormControl, Popover } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

import ToolbarButton from '@/apps/writer/components/core-editor/ToolbarButton.vue'
import { DEFAULT_LINE_HEIGHT, toCssLineHeight, toLineSpacing } from '@/apps/writer/utils/typography'
import { translate as __ } from '@/platform/translation'

const props = defineProps({
  editor: Object,
  settings: Object,
})

const current = computed(() => {
  const { $from } = props.editor.state.selection
  const node = $from.node($from.depth)

  if (node.type.name === 'paragraph') {
    return node.attrs
  }

  // Walk up until we find a paragraph
  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d)
    if (n.type.name === 'paragraph') return n.attrs
  }

  return {} // fallback
})

function parseNumber(value, fallback) {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

// What the paragraph falls back to when it carries no override of its own.
const defaults = computed(() => ({
  lineHeight: parseNumber(props.settings?.line_height, DEFAULT_LINE_HEIGHT),
  spacingBefore: parseNumber(props.settings?.paragraph_spacing_before, 0),
  spacingAfter: parseNumber(props.settings?.paragraph_spacing_after, 0),
}))

function fromAttrs(attrs) {
  return {
    lineSpacing: toLineSpacing(parseNumber(attrs.lineHeight, defaults.value.lineHeight)),
    spacingBefore: parseNumber(attrs.spacingBefore, defaults.value.spacingBefore),
    spacingAfter: parseNumber(attrs.spacingAfter, defaults.value.spacingAfter),
  }
}

const local = reactive(fromAttrs(current.value))

watch(current, (attrs) => Object.assign(local, fromAttrs(attrs)))

function applyLineSpacing() {
  if (!Number.isFinite(local.lineSpacing) || local.lineSpacing <= 0) return
  const lineHeight = toCssLineHeight(local.lineSpacing)
  props.editor.commands.updateAttributes('paragraph', {
    lineHeight: lineHeight === defaults.value.lineHeight ? null : lineHeight,
  })
}

function applySpacing() {
  const attrs = {}
  for (const key of ['spacingBefore', 'spacingAfter']) {
    if (!Number.isFinite(local[key])) continue
    attrs[key] = local[key] === defaults.value[key] ? null : `${local[key]}px`
  }
  props.editor.commands.updateAttributes('paragraph', attrs)
}
</script>
