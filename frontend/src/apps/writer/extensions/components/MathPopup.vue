<template>
  <div
    class="bg-white rounded-6 shadow-2xl w-[420px] max-w-[90vw] border border-gray-200"
    @click.stop
  >
    <div class="flex items-center justify-between px-3 border-b border-surface-gray-2">
      <span class="text-xs-medium text-gray-700">LaTeX</span>
      <Button :icon="IconX" variant="ghost" @click="handleClose" tooltip="Close (Esc)" />
    </div>

    <div class="p-3 flex flex-col gap-2">
      <Textarea
        ref="textareaRef"
        v-model="localLatex"
        :rows="4"
        @keydown.enter.meta.prevent="handleSubmit"
        @keydown.enter.ctrl.prevent="handleSubmit"
        @keydown.esc="handleClose"
      />

      <div class="flex gap-1 flex-wrap">
        <Button
          v-for="symbol in quickSymbols"
          :key="symbol.latex"
          :label="symbol.display"
          variant="ghost"
          @click="insertSymbol(symbol.latex)"
          :tooltip="symbol.label"
        />
      </div>
    </div>

    <div class="flex items-center justify-between px-3 py-2 border-t border-gray-200">
      <Checkbox v-model="isBlock" label="Block" />
      <Button label="Apply" variant="solid" @click="handleSubmit" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { Button, Checkbox, Textarea } from 'frappe-ui'
import IconX from '~icons/lucide/x'

const props = defineProps<{
  latex: string
  type: 'inline' | 'block'
  onClose: () => void
  onUpdate: (latex: string, type: 'inline' | 'block') => void
}>()

const localLatex = ref(props.latex)
const isBlock = ref(props.type === 'block')
const textareaRef = ref<any>(null)

const localType = computed(() => (isBlock.value ? 'block' : 'inline'))

const quickSymbols = [
  { latex: '\\frac{a}{b}', display: '½', label: 'Fraction' },
  { latex: 'x^{2}', display: 'x²', label: 'Superscript' },
  { latex: 'x_{i}', display: 'xᵢ', label: 'Subscript' },
  { latex: '\\sqrt{x}', display: '√x', label: 'Square root' },
  { latex: '\\sum', display: '∑', label: 'Sum' },
  { latex: '\\int', display: '∫', label: 'Integral' },
  { latex: '\\infty', display: '∞', label: 'Infinity' },
  { latex: '\\alpha', display: 'α', label: 'Alpha' },
  { latex: '\\beta', display: 'β', label: 'Beta' },
  { latex: '\\theta', display: 'θ', label: 'Theta' },
  { latex: '\\pi', display: 'π', label: 'Pi' },
  { latex: '\\Delta', display: 'Δ', label: 'Delta' },
]

onMounted(() => {
  nextTick(() => {
    const el = textareaRef.value?.$el?.querySelector('textarea')
    if (el) {
      el.focus()
      el.select()
    }
  })
})

const insertSymbol = (symbol: string) => {
  const el = textareaRef.value?.$el?.querySelector('textarea')
  if (!el) return

  const start = el.selectionStart
  const end = el.selectionEnd
  const text = localLatex.value

  localLatex.value = text.substring(0, start) + symbol + text.substring(end)

  nextTick(() => {
    el.focus()
    el.setSelectionRange(start + symbol.length, start + symbol.length)
  })
}

const handleSubmit = () => {
  props.onUpdate(localLatex.value, localType.value)
}

const handleClose = () => {
  props.onClose()
}
</script>

<style scoped>
:deep(textarea) {
  font-family:
    'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace !important;
  font-size: 12px !important;
  line-height: 1.5 !important;
}
</style>
