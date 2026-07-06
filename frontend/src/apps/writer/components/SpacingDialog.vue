<template>
  <Popover>
    <template #trigger="{ togglePopover, isOpen }">
      <slot v-bind="{ onClick: () => togglePopover(), isActive: isOpen }"></slot>
    </template>
    <template #default>
      <div class="p-4 flex flex-col gap-4 w-64">
        <FormControl
          type="number"
          class="grow"
          v-model.number="local.lineHeight"
          autocomplete="off"
          min="0.75"
          max="10"
          step="0.2"
          @update:modelValue="apply"
          label="Line Height"
        />
        <div class="space-y-1">
          <FormLabel label="Paragraph Spacing" />
          <div class="grid grid-cols-2 gap-2">
            <FormControl
              type="number"
              autocomplete="off"
              v-model.number="local.spacingBefore"
              @update:modelValue="apply"
              placeholder="0"
              description="Above"
            />
            <FormControl
              type="number"
              autocomplete="off"
              v-model.number="local.spacingAfter"
              @update:modelValue="apply"
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
import { ref, reactive, computed, watch } from 'vue'
import { Popover } from 'frappe-ui'
import { FormControl, FormLabel } from 'frappe-ui'

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

function parsePx(v, def) {
  if (!v) return def
  if (typeof v !== 'string') return v
  return parseInt(v.replace('px', ''), 10) || def
}

const local = reactive({
  lineHeight: +(current.value.lineHeight || props.settings.line_height),
  spacingAfter: parsePx(
    current.value.marginBottom,
    props.settings.paragraph_spacing_above,
    current.value.marginTop,
    props.settings.paragraph_spacing_above || 0,
  ),
  spacingBefore: parsePx(current.value.marginTop, props.settings.paragraph_spacing_below || 0),
})

watch(current, (cur) => {
  local.lineHeight = cur.lineHeight ? +cur.lineHeight : props.settings.line_height
  local.spacingAfter = parsePx(cur.spacingAfter, props.settings.paragraph_spacing_after || 0)
  local.spacingBefore = parsePx(cur.spacingBefore, props.settings.paragraph_spacing_before || 0)
})

function apply() {
  props.editor.commands.updateAttributes('paragraph', {
    lineHeight: local.lineHeight === (props.settings.line_height || 1.5) ? null : local.lineHeight,
    spacingAfter:
      local.spacingAfter === (props.settings.paragraph_spacing_above || 0)
        ? null
        : `${local.spacingAfter}px`,
    spacingBefore:
      local.spacingBefore === props.settings.paragraph_spacing_below
        ? null
        : `${local.spacingBefore}px`,
  })
}
</script>
