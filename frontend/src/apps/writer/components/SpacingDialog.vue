<template>
  <Popover>
    <!-- MenuItems.vue renders the toolbar Button through its #default slot, but
         that button gets no tooltip (only plain command items do), so we render
         our own — same as DropdownMenuGroup.vue. It has to stay the direct child
         of #trigger: PopoverTrigger wires the click onto it via as-child. -->
    <template #trigger="{ open }">
      <Button size="xs" variant="ghost" :icon="icon" label="Custom Spacing" tooltip="Custom Spacing"
        class="aria-pressed:bg-surface-gray-3" :aria-pressed="open" />
    </template>
    <template #default>
      <div class="p-4 flex flex-col gap-4 w-64">
        <FormControl
          type="number"
          class="grow"
          v-model.number="local.lineSpacing"
          autocomplete="off"
          min="0.5"
          max="10"
          step="0.05"
          @update:modelValue="applyLineSpacing"
          label="Line spacing"
        />
        <div class="space-y-1">
          <FormLabel label="Paragraph Spacing" />
          <div class="grid grid-cols-2 gap-2">
            <FormControl
              type="number"
              autocomplete="off"
              v-model.number="local.spacingBefore"
              @update:modelValue="applySpacing"
              placeholder="0"
              description="Above"
            />
            <FormControl
              type="number"
              autocomplete="off"
              v-model.number="local.spacingAfter"
              @update:modelValue="applySpacing"
              placeholder="0"
              description="Below"
            />
          </div>
        </div>
      </div>
    </template>
  </Popover>
</template>

<script setup>
import { reactive, computed, watch } from 'vue'
import { Popover, Button } from 'frappe-ui'
import { FormControl, FormLabel } from 'frappe-ui'
import {
  DEFAULT_LINE_HEIGHT,
  toCssLineHeight,
  toLineSpacing,
} from '@/apps/writer/utils/typography'

const props = defineProps({
  editor: Object,
  settings: Object,
  icon: [Object, Function, String],
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
    lineSpacing: toLineSpacing(
      parseNumber(attrs.lineHeight, defaults.value.lineHeight),
    ),
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
    attrs[key] =
      local[key] === defaults.value[key] ? null : `${local[key]}px`
  }
  props.editor.commands.updateAttributes('paragraph', attrs)
}
</script>
