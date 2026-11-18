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

import { translate as __ } from '@/platform/translation'

import FolderPicker from '../FolderPicker.vue'

/**
 * Picks where restored items go when their folder is in Trash. It stays in their root.
 * `titles` names the items that need a folder.
 */
const props = defineProps<{ root: string; titles: readonly string[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ choose: [parent: string] }>()
const description = computed(() => {
  const [only] = props.titles
  return props.titles.length === 1 && only
    ? __('“{0}” was in a folder that is in Trash. Choose where to restore it.', [only])
    : __('These {0} items were in folders that are in Trash. Choose where to restore them.', [
        props.titles.length,
      ])
})

function choose(parent: string) {
  emit('choose', parent)
  open.value = false
}
</script>
