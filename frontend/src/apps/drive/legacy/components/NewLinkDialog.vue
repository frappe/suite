<template>
  <Dialog v-model:open="open" title="New Link" size="xs" :actions="[
    {
      label: 'Create',
      variant: 'solid',
      disabled: !file_name.trim() || !link.trim() || createLink.loading,
      loading: createLink.loading,
      onClick: createLink.submit,
    },
  ]" @close="dialogType = ''">
    <div class="flex flex-col gap-4">
      <FormControl v-model="file_name" autofocus label="Link name" type="text" @keydown="createLink.error = null" />
      <FormControl v-model="link" label="URL" type="url" @keydown.enter="createLink.submit"
        @keydown="createLink.error = null" />
    </div>
    <ErrorMessage v-if="createLink.error" class="pt-4" :message="createLink.error" />
  </Dialog>
</template>

<script setup>
import { ref } from 'vue'
import { Dialog, createResource, FormControl, ErrorMessage } from 'frappe-ui'

const props = defineProps({
  parent: String,
})
const emit = defineEmits(['success'])

const open = ref(true)
const dialogType = defineModel()

const file_name = ref('')
const link = ref('')

const createLink = createResource({
  url: 'suite.drive.api.files.create_link',
  makeParams: () => ({
    file_name: file_name.value.trim(),
    link: link.value.trim(),
    parent: props.parent,
  }),
  validate(params) {
    if (!params?.file_name) {
      return 'Link name is required'
    }
  },
  onSuccess(data) {
    open.value = false
    file_name.value = ''
    link.value = ''
    emit('success', data)
  },
})
</script>
