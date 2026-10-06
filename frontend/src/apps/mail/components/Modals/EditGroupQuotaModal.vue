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
          :label="__('Quota (GB, 0 = unlimited)')"
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

type GroupData = {
  id: string
  quota: {
    total: number
  }
}
const show = defineModel<boolean>()
const { group } = defineProps<{
  group: GroupData
}>()
const emit = defineEmits(['reload'])
const quotaGb = ref(0)
watch(show, () => {
  if (show.value && group) {
    quotaGb.value = group.quota?.total ? Math.round(group.quota.total / 1024 ** 3) : 0
    updateQuota.reset()
  }
})
const updateQuota = useMutation(api.mail.admin.groups.update)
async function updateQuotaSubmit() {
  const input: InputOf<typeof api.mail.admin.groups.update> = {
    group_id: group.id,
    quota_gb: Number(quotaGb.value) || 0,
  }
  await updateQuota.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Quota updated.'))
}
</script>
