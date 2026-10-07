<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add to Groups'),
      actions: [
        {
          label: __('Add'),
          variant: 'solid' as const,
          disabled: !groupIds.length,
          loading: addGroups.isPending,
          onClick: addGroupsSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-1.5">
        <label class="text-ink-gray-5 block text-xs">{{ __('Groups') }}</label>
        <MultiSelect v-model="groupIds" :options="options" />
        <ErrorMessage
          :message="
            addGroups.error &&
            (addGroups.error?.messages?.[0] || addGroups.error?.message || __('Request failed.'))
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
const groupIds = ref<string[]>([])
const groups = useQuery(api.mail.admin.groups.list, () => ({
  page_length: 500,
}))

// Exclude groups the member already belongs to.
const options = computed(() =>
  (groups.data?.items || [])
    .filter((g: { id: string }) => !currentIds.includes(g.id))
    .map((g: { id: string; name: string; email?: string }) => ({
      label: g.email || g.name,
      value: g.id,
    })),
)
watch(show, () => {
  if (show.value) {
    groupIds.value = []
    addGroups.reset()
  }
})
const addGroups = useMutation(api.mail.admin.groups.addMemberToGroups)
async function addGroupsSubmit() {
  const input: InputOf<typeof api.mail.admin.groups.addMemberToGroups> = {
    member_id: memberId,
    group_ids: groupIds.value,
  }
  await addGroups.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Added to groups.'))
}
</script>
