<template>
  <FolderPicker v-model:open="open" mode="move" @choose="move" />
</template>

<script setup lang="ts">
import { moveNode } from '@/apps/drive/client/nodes'
import type { DriveNode } from '@/apps/drive/client/types'
import { toast } from '@/platform/feedback'
import { useMutation } from '@/platform/server-state'
import FolderPicker from './FolderPicker.vue'

/** Moves one node through the Drive folder picker. A refusal keeps the picker open. */
const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ moved: [node: DriveNode] }>()
const mutation = useMutation(moveNode(), { silent: ['DriveConflict'] })

async function move(parent: string) {
  const moved = await mutation.run({ node: props.node, parent })
  if (!moved) {
    toast.error(mutation.error?.message ?? 'Could not move this item.')
    return
  }
  open.value = false
  emit('moved', moved)
}
</script>
