<template>
  <input
    v-if="isEditing"
    ref="input"
    v-model="value"
    type="text"
    spellcheck="false"
    style="field-sizing: content"
    :class="[
      appearance === 'breadcrumb'
        ? 'min-w-[4ch] max-w-full rounded-1 border-0 bg-surface-base px-0.5 py-1 text-lg-medium text-ink-gray-9 shadow-[inset_0_0_0_1px_var(--outline-gray-4)] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none'
        : 'min-w-[4ch] max-w-full rounded-1 border border-outline-gray-2 bg-surface-base px-1.5 py-0.5 text-ink-gray-9 outline-none focus:border-outline-gray-4 focus:outline-none focus:ring-0 focus:shadow-none focus-visible:outline-none',
      $attrs.class || (appearance === 'breadcrumb' ? '' : 'text-base'),
    ]"
    @click.stop
    @mousedown.stop
    @dblclick.stop
    @keydown.stop
    @keyup.stop
    @keyup.space.prevent
    @keydown.enter.prevent="submitValue"
    @keydown.escape.prevent="cancelValue"
    @focus="selectValue"
    @blur="blurValue"
  />
  <slot v-else />
</template>
<script setup>
import { computed, nextTick, onMounted, watch } from 'vue'
import { renamingEntity } from '@/apps/drive/data/selection'
import { useInlineRename } from '@/apps/drive/utils/useInlineRename'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  entity: Object,
  modelValue: String,
  editing: { type: Boolean, default: undefined },
  appearance: { type: String, default: 'default' },
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel', 'blur'])

const { draft, input, start, submit, blur, selectBaseName, cancel } = useInlineRename(
  () => props.entity,
)
const isControlled = computed(() => props.editing !== undefined)
const isEditing = computed(() =>
  isControlled.value ? props.editing : renamingEntity.value === props.entity?.name,
)
const value = computed({
  get: () => (isControlled.value ? props.modelValue ?? '' : draft.value),
  set: (value) => isControlled.value ? emit('update:modelValue', value) : (draft.value = value),
})

function startEditing() {
  if (!isControlled.value) {
    start()
    return
  }
  nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
}

const submitValue = () => isControlled.value ? emit('submit') : submit()
const cancelValue = () => isControlled.value ? emit('cancel') : cancel()
const blurValue = () => isControlled.value ? emit('blur') : blur()
const selectValue = () => isControlled.value ? input.value?.select() : selectBaseName()

// List/grid rows keep this component mounted and toggle isEditing, so the watch
// catches the transition. The breadcrumb only renders it while editing, so it
// mounts already-editing — onMounted handles that case.
watch(isEditing, (editing) => {
  if (editing) startEditing()
})
onMounted(() => {
  if (isEditing.value) startEditing()
})
</script>
