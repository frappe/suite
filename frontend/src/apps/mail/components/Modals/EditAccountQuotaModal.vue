<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Combined personal storage cap'),
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
          :label="__('Personal cap (GB)')"
          :description="
            __(
              'Leave blank for uncapped. Mail continues regardless of usage; this limits new Drive growth.',
            )
          "
        />
        <FormControl
          v-model="buffer"
          type="checkbox"
          :label="__('Grant persistent 10% personal headroom')"
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

import { api, useMutation, useQuery } from '@/api'
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
const quotaGb = ref<number | string>('')
const buffer = ref(false)
const storage = useQuery(api.suite.storage.get, () => (show.value ? {} : false))
watch(
  () => storage.data,
  (data) => {
    const user = data?.users.find((user) => user.name === member.name)
    if (user) {
      quotaGb.value = user.cap_bytes == null ? '' : user.cap_bytes / 1_000_000_000
      buffer.value = user.buffer
      updateQuota.reset()
    }
  },
)
const updateQuota = useMutation(api.suite.storage.setLimits)
async function updateQuotaSubmit() {
  await updateQuota.run({
    users: [member.name],
    cap_bytes: quotaGb.value === '' ? null : Number(quotaGb.value) * 1_000_000_000,
    buffer: buffer.value,
  })
  show.value = false
  emit('reload')
  raiseToast(__('Combined storage cap updated.'))
}
</script>
