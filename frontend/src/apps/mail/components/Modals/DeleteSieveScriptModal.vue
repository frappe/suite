<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Delete Sieve Script'),
      message: __(`Are you sure you want to delete '{0}'? `, [script._name]),
      icon: 'lucide-alert-triangle',
      theme: 'amber' as const,
      actions: [
        { label: __('Confirm'), theme: 'red' as const, onClick: () => deleteScriptSubmit() },
      ],
    }"
  />
</template>

<script setup lang="ts">
import { Dialog } from 'frappe-ui'

import { api, useMutation, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import type { SieveScript } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { script } = defineProps<{
  script: SieveScript
}>()
const store = userStore()
const deleteScript = useMutation(api.mail.sieve.delete)
async function deleteScriptSubmit() {
  const input: InputOf<typeof api.mail.sieve.delete> = {
    account: store.accountId,
    id: script.id,
  }
  await deleteScript.run(input)
  raiseToast(__('Sieve script deleted.'))
  show.value = false
}
</script>
