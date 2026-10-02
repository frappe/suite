<template>
  <div class="flex gap-2">
    <FormControl
      class="w-15"
      variant="outline"
      type="number"
      v-model="size"
      aria-label="Font size"
      :min="FONT_SIZE_MIN"
      :max="FONT_SIZE_MAX"
      @focus="$event.target.select()"
      @update:modelValue="applySize"
      @blur="sync"
    />
    <FontSelect v-model="selected" :font_family :editor />
  </div>
</template>
<script setup>
import { FormControl } from 'frappe-ui'
import { ref, watch } from 'vue'
import { FONT_FAMILIES } from '@/apps/writer/utils'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '@/apps/writer/utils/typography'
import FontSelect from './FontSelect.vue'

const props = defineProps({
  editor: Object,
  font_size: Number,
  font_family: String,
})

const selected = ref(props.font_family)
const size = ref(props.font_size)

// The editor is plain @tiptap/core (not reactive), so state reads don't
// trigger re-runs — sync on transactions instead.
const sync = () => {
  selected.value =
    FONT_FAMILIES.find((opt) => opt.isActive(props.editor))?.key || props.font_family
  let fontSize = props.editor.getAttributes('textStyle')?.fontSize || props.font_size
  if (typeof fontSize !== 'number') fontSize = parseFloat(fontSize)
  if (!Number.isNaN(fontSize)) size.value = fontSize
}

// Sizes outside the range are ignored while typing; blur shows the real size again.
const applySize = (value) => {
  const px = Number(value)
  if (px >= FONT_SIZE_MIN && px <= FONT_SIZE_MAX) props.editor.commands.setFontSize(px + 'px')
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
