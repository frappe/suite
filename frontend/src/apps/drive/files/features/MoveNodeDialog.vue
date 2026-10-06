<template>
  <FolderPicker
    v-model:open="open"
    mode="move"
    :items="items"
    :busy="mutation.isPending"
    @choose="move"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'
import { toast } from '@/platform/feedback'

import { announceMove } from './changeToast'
import FolderPicker from './FolderPicker.vue'

/** Moves one node through the Drive folder picker. A refusal keeps the picker open. */
const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ moved: [node: DriveNode] }>()
const mutation = useMutation(api.drive.nodes.move, { silent: true })
// Where the node is now, so the picker keeps it out of itself and its own folder.
const subject = useQuery(api.drive.nodes.get, { node: props.node, expand: 'access' })
const items = computed(() => (subject.data ? [subject.data] : []))

async function move(parent: string, destination: string) {
  try {
    // Read before the move: it changes the node's parent in place.
    const from = subject.data?.parent_node
    const moved = await mutation.run({ node: props.node, parent_node: parent })

    if (from)
      announceMove([{ node: moved.name, title: moved.title, from, to: parent }], destination)
    emit('moved', moved)
    open.value = false
  } catch {
    toast.error(mutation.error?.message ?? 'Could not move this item.')
    return
  }
}
</script>
