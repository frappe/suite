<template>
  <input
    v-if="isEditing"
    ref="input"
    v-model="draft"
    type="text"
    spellcheck="false"
    style="field-sizing: content"
    :class="[
      'min-w-[4ch] max-w-full rounded-1 bg-surface-base px-1.5 py-0.5 text-ink-gray-9 border border-outline-gray-2 outline-none focus:border-outline-gray-4 focus:outline-none focus:ring-0 focus:shadow-none focus-visible:outline-none',
      $attrs.class || 'text-base',
    ]"
    @click.stop
    @mousedown.stop
    @dblclick.stop
    @keydown.stop
    @keyup.stop
    @keyup.space.prevent
    @keydown.enter.prevent="submit"
    @keydown.escape.prevent="cancel"
    @focus="selectBaseName"
    @blur="blur"
  />
  <slot v-else />
</template>
<script setup>
import { computed, onMounted, watch } from 'vue'
import { renamingEntity } from '@/apps/drive/data/selection'
import { useInlineRename } from '@/apps/drive/utils/useInlineRename'

defineOptions({ inheritAttrs: false })

const props = defineProps({ entity: Object })

const { draft, input, start, submit, blur, selectBaseName, cancel } = useInlineRename(
  () => props.entity,
)
const isEditing = computed(() => renamingEntity.value === props.entity?.name)

// List/grid rows keep this component mounted and toggle isEditing, so the watch
// catches the transition. The breadcrumb only renders it while editing, so it
// mounts already-editing — onMounted handles that case.
watch(isEditing, (editing) => {
  if (editing) start()
})
onMounted(() => {
  if (isEditing.value) start()
})
</script>
