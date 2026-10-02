<template>
  <Dialog v-model:open="open" title="Rename" size="md">
    <form ref="form" class="space-y-4" @submit.prevent="submit">
      <FormControl v-model="title" label="Name" required :error="error" />
      <div class="flex justify-end gap-2">
        <Button label="Cancel" @click="open = false" />
        <Button type="submit" variant="solid" theme="gray" label="Rename" :loading="mutation.isPending" />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { Button, Dialog, FormControl } from 'frappe-ui'

import { renameNode } from '@/apps/drive/client/nodes'
import type { DriveNode } from '@/apps/drive/client/types'
import { useMutation } from '@/platform/server-state'
import { selectStem } from '../internal/filename'

const props = defineProps<{ node: DriveNode | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ renamed: [node: DriveNode] }>()
const title = ref('')
const error = ref<string>()
const form = useTemplateRef('form')
// Every refusal shows under the field, so none needs a toast.
const mutation = useMutation(renameNode(), { silent: true })

watch(
  () => props.node,
  (node) => {
    title.value = node?.title ?? ''
    error.value = undefined
  },
  { immediate: true },
)

// The dialog focuses the field itself instead of using `autofocus`, which
// would select the whole title. A file selects its name up to the extension.
// A menu that opened the dialog hands focus back to its trigger as it closes,
// and the dialog then focuses the field again with the whole title selected.
// So for a moment after opening, every focus selects the title again, after
// that refocus is done.
watch(open, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  requestAnimationFrame(() => {
    const input = form.value?.querySelector('input')
    if (!input) return
    const select = () => {
      if (props.node?.kind === 'file') selectStem(input)
      else input.select()
    }
    const reselect = () => queueMicrotask(select)
    input.addEventListener('focus', reselect)
    setTimeout(() => input.removeEventListener('focus', reselect), 250)
    input.focus()
    select()
  })
}, { immediate: true })

async function submit() {
  if (!props.node || !title.value.trim()) return
  error.value = undefined
  const renamed = await mutation.run({ node: props.node.name, title: title.value.trim() })
  if (!renamed) {
    error.value = mutation.error?.message ?? 'Could not rename this item.'
    return
  }
  emit('renamed', renamed)
  open.value = false
}
</script>

