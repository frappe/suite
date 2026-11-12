<template>
  <FolderPicker
    v-model:open="open"
    mode="restore"
    :root="root"
    :description="description"
    @choose="choose"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import FolderPicker from '../FolderPicker.vue'

/** Picks where restored items go when their folder is gone. It stays in their root. */
const props = defineProps<{ root: string; count: number }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ choose: [parent: string] }>()
const description = computed(() =>
  props.count === 1
    ? 'The folder this item was in is gone. Choose a folder to restore it to.'
    : `The folders ${props.count} of these items were in are gone. Choose a folder to restore them to.`,
)

function choose(parent: string) {
  emit('choose', parent)
  open.value = false
}
</script>
