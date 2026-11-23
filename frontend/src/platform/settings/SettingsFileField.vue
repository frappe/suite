<!--
  A file to pick, laid out as a frappe-ui field: its label, the button with the picked file's name
  beside it, then the help line. The file is uploaded as it is picked, and a failed upload is said
  under the field.
-->
<template>
  <div class="space-y-1.5">
    <FormLabel :id="inputId" :label />
    <input :id="inputId" ref="input" type="file" class="hidden" :accept @change="onPicked" />
    <div class="flex items-center gap-2">
      <Button class="shrink-0" :label="buttonLabel" :loading="isUploading" @click="openPicker" />
      <span class="truncate text-base" :class="nameInk">{{ shownName }}</span>
    </div>
    <p v-if="description" class="text-p-sm text-ink-gray-6">{{ description }}</p>
    <ErrorMessage :message="error" />
  </div>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormLabel } from 'frappe-ui'
import { computed, ref, useId, useTemplateRef } from 'vue'

import { failureText } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

const props = defineProps<{
  label: string
  /** The help line under the field, such as the file formats it takes. */
  description?: string
  /** The file types the picker offers, as the `accept` of a file input. */
  accept?: string
  /** Uploads the picked file. A rejection is said under the field. */
  upload: (file: File) => Promise<unknown>
  /** How far the upload is, from 0 to 100. */
  progress?: number
}>()

const inputId = useId()
const input = useTemplateRef<HTMLInputElement>('input')
const fileName = ref('')
const isUploading = ref(false)
const error = ref<string>()

const buttonLabel = computed(() => {
  if (isUploading.value) {
    return __('Uploading ({0}%)', [props.progress ?? 0])
  }

  return __('Choose file')
})
const shownName = computed(() => fileName.value || __('No file chosen'))
const nameInk = computed(() => (fileName.value ? 'text-ink-gray-8' : 'text-ink-gray-5'))

function openPicker() {
  input.value?.click()
}

function reasonOf(failure: unknown) {
  if (failure instanceof Error) {
    return failureText(failure)
  }

  return __('Upload failed.')
}

async function onPicked() {
  const file = input.value?.files?.[0]
  if (!input.value || !file) {
    return
  }

  // Emptied, so the same file can be picked again after a failed upload
  input.value.value = ''
  const uploadedName = fileName.value
  fileName.value = file.name
  error.value = undefined
  isUploading.value = true
  try {
    await props.upload(file)
  } catch (failure) {
    // The file uploaded before this one is still the one that counts
    fileName.value = uploadedName
    error.value = reasonOf(failure)
  } finally {
    isUploading.value = false
  }
}
</script>
