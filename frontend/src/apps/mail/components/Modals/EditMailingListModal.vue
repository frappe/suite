<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Edit Mailing List'),
      actions: [
        {
          label: __('Save'),
          variant: 'solid' as const,
          loading: updateList.isPending,
          onClick: updateListSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl v-model="description" :label="__('Description')" />
        <ErrorMessage
          :message="
            updateList.error &&
            (updateList.error?.messages?.[0] || updateList.error?.message || __('Request failed.'))
          "
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { raiseToast } from '@/apps/mail/utils'

type ListData = {
  id: string
  description?: string | null
}
const show = defineModel<boolean>()
const { list } = defineProps<{
  list: ListData
}>()
const emit = defineEmits(['reload'])
const description = ref('')
watch(show, () => {
  if (show.value && list) {
    description.value = list.description || ''
    updateList.reset()
  }
})
const updateList = useMutation(api.mail.admin.mailingLists.update)
async function updateListSubmit() {
  const input: InputOf<typeof api.mail.admin.mailingLists.update> = {
    list_id: list.id,
    description: description.value?.trim() || '',
  }
  await updateList.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Mailing list updated.'))
}
</script>
