<template>
  <Dialog v-model:open="open" title="New Link" size="xs" :actions="[
    {
      label: 'Create',
      variant: 'solid',
      loading: createLink.loading,
      onClick: createLink.submit,
    },
  ]" @close="dialogType = ''">
    <div class="flex flex-col gap-4">
      <FormControl v-model="file_name" autofocus label="Link name" type="text" @keydown="createLink.error = null" />
      <FormControl v-model="link" label="URL" type="url" @keydown.enter="createLink.submit"
        @keydown="createLink.error = null" />
    </div>
    <div v-if="createLink.error" class="pt-4 text-base font-sm text-ink-red-6">
      {{ createLink.error.messages[0] }}
    </div>
  </Dialog>
</template>

<script setup>
import { ref } from 'vue'
import { Dialog, createResource, FormControl } from 'frappe-ui'
import { useRoute } from 'vue-router'

const route = useRoute()

const props = defineProps({
  parent: String,
})
const emit = defineEmits(['success'])

const open = ref(true)
const dialogType = defineModel()

const file_name = ref('')
const link = ref(localStorage.getItem('prevClip') || '')

const createLink = createResource({
  url: 'suite.drive.api.files.create_link',
  makeParams: () => ({
    file_name: file_name.value.trim(),
    link: link.value.trim(),
    team: route.params.team,
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
