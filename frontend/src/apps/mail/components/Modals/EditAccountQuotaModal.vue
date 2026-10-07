<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Edit Quota'),
      actions: [
        {
          label: __('Save'),
          variant: 'solid' as const,
          loading: updateQuota.isPending,
          onClick: updateQuotaSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="quotaGb"
          type="number"
          :min="0"
          :label="__('Quota (GB)')"
          :description="__('Every account has a quota; it must be above zero.')"
        />
        <ErrorMessage
          :message="
            updateQuota.error &&
            (updateQuota.error?.messages?.[0] ||
              updateQuota.error?.message ||
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

type MemberData = {
  name: string
  quota: {
    total: number
  }
}
const show = defineModel<boolean>()
const { member } = defineProps<{
  member: MemberData
}>()
const emit = defineEmits(['reload'])
const quotaGb = ref(0)
watch(show, () => {
  if (show.value && member) {
    quotaGb.value = member.quota?.total ? Math.round(member.quota.total / 1024 ** 3) : 0
    updateQuota.reset()
  }
})
const updateQuota = useMutation(api.mail.admin.members.update)
async function updateQuotaSubmit() {
  const input: InputOf<typeof api.mail.admin.members.update> = {
    member_id: member.name,
    quota_gb: Number(quotaGb.value) || 0,
  }
  await updateQuota.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Quota updated.'))
}
</script>
