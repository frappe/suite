<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add to Mailing Lists'),
      actions: [
        {
          label: __('Add'),
          variant: 'solid' as const,
          disabled: !listIds.length,
          loading: addLists.isPending,
          onClick: addListsSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-1.5">
        <label class="text-ink-gray-5 block text-xs">{{ __('Mailing Lists') }}</label>
        <MultiSelect v-model="listIds" :options="options" />
        <ErrorMessage
          :message="
            addLists.error &&
            (addLists.error?.messages?.[0] || addLists.error?.message || __('Request failed.'))
          "
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, ErrorMessage, MultiSelect } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { memberId, currentIds } = defineProps<{
  memberId: string
  currentIds: string[]
}>()
const emit = defineEmits(['reload'])
const listIds = ref<string[]>([])
const lists = useQuery(api.mail.admin.mailingLists.list, () => ({
  page_length: 500,
}))

// Exclude mailing lists the account is already a recipient of.
const options = computed(() =>
  (lists.data?.items || [])
    .filter((ml: { id: string }) => !currentIds.includes(ml.id))
    .map((ml: { id: string; name: string; email?: string }) => ({
      label: ml.email || ml.name,
      value: ml.id,
    })),
)
watch(show, () => {
  if (show.value) {
    listIds.value = []
    addLists.reset()
  }
})
const addLists = useMutation(api.mail.admin.mailingLists.addMemberToMailingLists)
async function addListsSubmit() {
  const input: InputOf<typeof api.mail.admin.mailingLists.addMemberToMailingLists> = {
    member_id: memberId,
    list_ids: listIds.value,
  }
  await addLists.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Added to mailing lists.'))
}
</script>
