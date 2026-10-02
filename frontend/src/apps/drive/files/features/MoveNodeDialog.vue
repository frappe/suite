<template>
  <FolderPicker v-model:open="open" mode="move" :items="items" :busy="mutation.isPending" @choose="move" />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { moveNode, node } from '@/apps/drive/client/nodes'
import type { DriveNode } from '@/apps/drive/client/types'
import { toast } from '@/platform/feedback'
import { useMutation, useQuery } from '@/platform/server-state'
import FolderPicker from './FolderPicker.vue'

/** Moves one node through the Drive folder picker. A refusal keeps the picker open. */
const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ moved: [node: DriveNode] }>()
const mutation = useMutation(moveNode(), { silent: ['DriveConflict'] })
// Where the node is now, so the picker keeps it out of itself and its own folder.
const subject = useQuery(node(props.node, 'access'))
const items = computed(() => subject.data ? [subject.data] : [])

async function move(parent: string) {
  const moved = await mutation.run({ node: props.node, parent })
  if (!moved) {
    toast.error(mutation.error?.message ?? 'Could not move this item.')
    return
  }
  emit('moved', moved)
  open.value = false
}
</script>
