<template>
  <Dialog v-model:open="open" title="Rename" size="md">
    <form ref="form" class="space-y-4" @submit.prevent="submit">
      <FormControl v-model="title" label="Name" required :error="mutation.error?.message" />
      <div class="flex justify-end gap-2">
        <Button label="Cancel" @click="open = false" />
        <Button
          type="submit"
          variant="solid"
          theme="gray"
          label="Rename"
          :loading="mutation.isPending"
        />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { nextTick, ref, useTemplateRef, watch } from 'vue'

import { api, useMutation } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'

import { selectStem } from '../internal/filename'

const props = defineProps<{ node: DriveNode | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ renamed: [node: DriveNode] }>()
const title = ref('')
const form = useTemplateRef('form')
// Every refusal shows under the field, so none needs a toast.
const mutation = useMutation(api.drive.nodes.rename, { silent: true })

watch(
  () => props.node,
  (node) => {
    title.value = node?.title ?? ''
  },
  { immediate: true },
)

watch([open, () => props.node?.name], () => mutation.reset())

// The dialog focuses the field itself instead of using `autofocus`, which
// would select the whole title. A file selects its name up to the extension.
// A menu that opened the dialog hands focus back to its trigger as it closes,
// and the dialog's focus trap then focuses the field again with the whole
// title selected. So until the user clicks or types in the field, each focus
// selects the name again, after the trap's own selection.
let selecting: AbortController | undefined
watch(
  open,
  async (isOpen) => {
    selecting?.abort()
    if (!isOpen) return
    const session = (selecting = new AbortController())
    await nextTick()
    // After the dialog's own focus on open, as frappe-ui's autofocus does.
    requestAnimationFrame(() => {
      const input = form.value?.querySelector('input')
      if (!input || session.signal.aborted) return
      const select = () => {
        if (props.node?.kind === 'file') selectStem(input)
        else input.select()
      }
      const listen = { signal: session.signal }
      input.addEventListener('focus', () => queueMicrotask(select), listen)
      input.addEventListener('pointerdown', () => session.abort(), listen)
      input.addEventListener('keydown', () => session.abort(), listen)
      input.focus()
      select()
    })
  },
  { immediate: true },
)

async function submit() {
  if (!props.node || !title.value.trim()) return
  const renamed = await mutation.run({ node: props.node.name, title: title.value.trim() })

  emit('renamed', renamed)
  open.value = false
}
</script>
