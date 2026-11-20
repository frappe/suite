<template>
  <FolderPicker
    v-model:open="open"
    mode="copy"
    :items="items"
    :busy="mutation.isPending"
    @choose="copy"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'

import { announceCopy } from './changeToast'
import FolderPicker from './FolderPicker.vue'

/** Copies one node into a folder the user picks, as the listing's Make a copy does. A refusal keeps the picker open. */
const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ copied: [node: DriveNode] }>()
const mutation = useMutation(api.drive.nodes.copy)
// Where the node is now, so the picker opens in its folder.
const subject = useQuery(api.drive.nodes.get, { node: props.node, expand: 'access' })
const items = computed(() => (subject.data ? [subject.data] : []))

async function copy(parent: string, destination: string) {
  const copied = await mutation.run({ node: props.node, parent_node: parent })

  announceCopy({ node: copied.name, title: copied.title }, destination)
  emit('copied', copied)
  open.value = false
}
</script>
