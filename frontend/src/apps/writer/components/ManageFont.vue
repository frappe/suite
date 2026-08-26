<template>
  <div class="flex items-center gap-1">
    <FontSelect v-model="selected" :font_family :editor variant="ghost">
      <!-- Toolbar trigger: name + chevron, no box. The boxed Combobox trigger
           is ~200px wide and dwarfs the neighbouring icon buttons. -->
      <template #trigger="{ open, displayValue }">
        <Button
          size="xs"
          variant="ghost"
          :aria-label="__('Font family')"
          :tooltip="__('Font family')"
          class="aria-pressed:bg-surface-gray-3"
          :aria-pressed="open"
        >
          <span class="flex items-center gap-1">
            <span class="truncate">{{ displayValue || fontLabel }}</span>
            <LucideChevronDown class="size-3 text-ink-gray-5" />
          </span>
        </Button>
      </template>
    </FontSelect>

    <div class="flex items-center gap-1">
      <Button
        size="xs"
        variant="subtle"
        icon="lucide-minus"
        :label="__('Decrease font size')"
        :tooltip="__('Decrease font size')"
        :disabled="size <= MIN_FONT_SIZE"
        @click="step(-1)"
      />
      <TextInput
        v-model.number="size"
        type="number"
        size="sm"
        variant="ghost"
        class="w-9 [&_input]:px-0 [&_input]:text-center [&_input]:[appearance:textfield] [&_input::-webkit-inner-spin-button]:appearance-none"
        :aria-label="__('Font size')"
        @focus="$event.target.select()"
        @update:modelValue="apply"
      />
      <Button
        size="xs"
        variant="subtle"
        icon="lucide-plus"
        :label="__('Increase font size')"
        :tooltip="__('Increase font size')"
        :disabled="size >= MAX_FONT_SIZE"
        @click="step(1)"
      />
    </div>
  </div>
</template>
<script setup>
import { Button, TextInput } from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import { FONT_FAMILIES } from '@/apps/writer/utils'
import FontSelect from './FontSelect.vue'
import LucideChevronDown from '~icons/lucide/chevron-down'

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 96

const props = defineProps({
  editor: Object,
  font_size: Number,
  font_family: String,
})

const selected = ref(props.font_family)
const size = ref(props.font_size)

const fontLabel = computed(
  () => FONT_FAMILIES.find((opt) => opt.key === selected.value)?.label ?? '',
)

const apply = (val) => {
  const next = Math.min(Math.max(parseFloat(val), MIN_FONT_SIZE), MAX_FONT_SIZE)
  if (Number.isNaN(next)) return
  size.value = next
  props.editor.commands.setFontSize(next + 'px')
}

const step = (delta) => apply(size.value + delta)

// The editor is plain @tiptap/core (not reactive), so state reads don't
// trigger re-runs — sync on transactions instead.
const sync = () => {
  selected.value =
    FONT_FAMILIES.find((opt) => opt.isActive(props.editor))?.key || props.font_family
  let fontSize = props.editor.getAttributes('textStyle')?.fontSize || props.font_size
  if (typeof fontSize !== 'number') fontSize = parseFloat(fontSize)
  if (!Number.isNaN(fontSize)) size.value = fontSize
}

watch(
  () => props.editor,
  (editor, _old, onCleanup) => {
    if (typeof editor?.on !== 'function') return
    sync()
    editor.on('transaction', sync)
    onCleanup(() => editor.off('transaction', sync))
  },
  { immediate: true },
)
</script>
