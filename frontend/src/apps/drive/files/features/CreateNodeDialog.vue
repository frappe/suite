<template>
  <Dialog v-model:open="open" :title="dialogTitle" size="md">
    <form ref="form" class="space-y-4" novalidate @submit.prevent="submit">
      <FormControl
        v-model="title"
        label="Name"
        required
        :error="titleError"
        autofocus
        @update:model-value="titleError = undefined"
      />
      <FormControl
        v-if="request?.kind === 'link'"
        v-model="url"
        label="URL"
        type="url"
        placeholder="https://"
        required
        :error="urlError"
        @update:model-value="urlError = undefined"
      />
      <ErrorMessage v-if="error" :message="error" />
      <div class="flex justify-end gap-2">
        <Button label="Cancel" @click="open = false" />
        <Button
          type="submit"
          variant="solid"
          theme="gray"
          label="Create"
          :loading="mutation.isPending"
        />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { createNode, type CreateNodeInput } from '@/apps/drive/client/nodes'
import type { DriveNode } from '@/apps/drive/client/types'
import { useMutation } from '@/platform/server-state'

export interface CreateRequest {
  parent: string
  kind: 'folder' | 'document' | 'link'
  /** The document type, for `document`. */
  contentDoctype?: string
  /** The type's label, such as `Spreadsheet`, for `document`. */
  typeLabel?: string
}

const props = defineProps<{ request: CreateRequest | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [node: DriveNode, request: CreateRequest] }>()

const form = ref<HTMLFormElement | null>(null)
const title = ref('')
const url = ref('')
const titleError = ref<string>()
const urlError = ref<string>()
const error = ref<string>()
const mutation = useMutation(createNode(), { silent: ['DriveConflict'] })

const noun = computed(() => {
  const request = props.request
  if (!request) return ''
  if (request.kind === 'document') return (request.typeLabel ?? 'Document').toLowerCase()
  return request.kind
})
const dialogTitle = computed(() => `New ${noun.value}`)

// A fresh request starts from a suggested name. The field opens focused with
// the name selected, so typing replaces it.
watch(
  () => [open.value, props.request] as const,
  ([isOpen]) => {
    if (!isOpen) return
    title.value = props.request?.kind === 'link' ? '' : `Untitled ${noun.value}`
    url.value = ''
    titleError.value = undefined
    urlError.value = undefined
    error.value = undefined
  },
  { immediate: true },
)

async function submit() {
  const request = props.request
  if (!request || mutation.isPending) return
  error.value = undefined
  titleError.value = title.value.trim() ? undefined : 'Enter a name.'
  urlError.value =
    request.kind !== 'link' || validUrl(url.value)
      ? undefined
      : 'Enter a full URL, starting with https://.'
  if (titleError.value || urlError.value) {
    await focusField(titleError.value ? 0 : 1)
    return
  }
  const created = await mutation.run(createInput(request, title.value.trim(), url.value.trim()))
  if (!created) {
    error.value = mutation.error?.message ?? `Could not create this ${noun.value}.`
    return
  }
  open.value = false
  emit('created', created, request)
}

function createInput(request: CreateRequest, title: string, url: string): CreateNodeInput {
  const base = { parent_node: request.parent, title }
  if (request.kind === 'link') return { ...base, kind: 'link', url }
  if (request.kind === 'document')
    return { ...base, kind: 'document', content_doctype: request.contentDoctype ?? '' }
  return { ...base, kind: 'folder' }
}

function validUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value.trim()).protocol)
  } catch {
    return false
  }
}

async function focusField(index: number) {
  await nextTick()
  form.value?.querySelectorAll<HTMLInputElement>('input')[index]?.focus()
}
</script>
