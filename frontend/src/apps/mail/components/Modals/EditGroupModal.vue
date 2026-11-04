<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Edit Group'),
      actions: [
        {
          label: __('Save'),
          variant: 'solid' as const,
          loading: updateGroup.isPending,
          onClick: updateGroupSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl v-model="description" :label="__('Description')" />
        <ErrorMessage
          :message="
            updateGroup.error &&
            (updateGroup.error?.messages?.[0] ||
              updateGroup.error?.message ||
              __('Request failed.'))
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

type GroupData = {
  id: string
  description?: string | null
}
const show = defineModel<boolean>()
const { group } = defineProps<{
  group: GroupData
}>()
const emit = defineEmits(['reload'])
const description = ref('')
watch(show, () => {
  if (show.value && group) {
    description.value = group.description || ''
    updateGroup.reset()
  }
})
const updateGroup = useMutation(api.mail.admin.groups.update)
async function updateGroupSubmit() {
  const input: InputOf<typeof api.mail.admin.groups.update> = {
    group_id: group.id,
    description: description.value?.trim() || '',
  }
  await updateGroup.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Group updated.'))
}
</script>
