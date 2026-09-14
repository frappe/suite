<template>
  <Dialog v-model:open="open" title="Rename" size="md">
    <form class="space-y-4" @submit.prevent="submit">
      <FormControl v-model="title" label="Name" required :error="error" autofocus />
      <div class="flex justify-end gap-2">
        <Button label="Cancel" @click="open = false" />
        <Button type="submit" variant="solid" theme="gray" label="Rename" :loading="mutation.isPending" />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button, Dialog, FormControl } from 'frappe-ui'

import { renameNode } from '@/apps/drive/client/nodes'
import type { DriveNode } from '@/apps/drive/client/types'
import { useMutation } from '@/platform/server-state'

const props = defineProps<{ node: DriveNode | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ renamed: [node: DriveNode] }>()
const title = ref('')
const error = ref<string | null>(null)
const mutation = useMutation(renameNode(), { silent: ['DriveConflict'] })

watch(
  () => props.node,
  (node) => {
    title.value = node?.title ?? ''
    error.value = null
  },
  { immediate: true },
)

async function submit() {
  if (!props.node || !title.value.trim()) return
  error.value = null
  const renamed = await mutation.run({ node: props.node.name, title: title.value.trim() })
  if (!renamed) {
    error.value = mutation.error?.message ?? 'Could not rename this item.'
    return
  }
  emit('renamed', renamed)
  open.value = false
}
</script>

