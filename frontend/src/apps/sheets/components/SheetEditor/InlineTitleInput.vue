<template>
  <!-- The old page's title field. It mounts only while the title is being
       edited, so it takes focus at once. Key events stop here: the grid
       listens on window for its shortcuts. -->
  <input
    ref="input"
    :value="modelValue"
    type="text"
    spellcheck="false"
    aria-label="Sheet title"
    style="field-sizing: content"
    class="min-w-[4ch] max-w-full rounded-1 border-0 bg-surface-base px-0.5 py-1 text-lg-medium text-ink-gray-9 shadow-[inset_0_0_0_1px_var(--outline-gray-4)] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    @click.stop
    @mousedown.stop
    @dblclick.stop
    @keydown.stop
    @keyup.stop
    @keydown.enter.prevent="emit('submit')"
    @keydown.escape.prevent="emit('cancel')"
    @blur="emit('blur')"
  />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  cancel: []
  blur: []
}>()

const input = ref<HTMLInputElement | null>(null)
onMounted(() => {
  input.value?.focus()
  input.value?.select()
})
</script>
