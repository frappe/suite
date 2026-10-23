<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Delete {0}', [mailbox?._name]),
      message: __(
        `Are you sure you want to delete '{0}'? Mails in this folder will be permanently removed.`,
        [mailbox?._name],
      ),
      icon: 'lucide-alert-triangle',
      theme: 'amber' as const,
      actions: [{ label: __('Confirm'), theme: 'red' as const, onClick: deleteFolderSubmit }],
    }"
  />
</template>

<script setup lang="ts">
import { Dialog } from 'frappe-ui'

import { api, useMutation, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import type { MailboxData } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { mailbox } = defineProps<{
  mailbox?: MailboxData
}>()
const store = userStore()
const deleteFolder = useMutation(api.mail.mailboxes.delete)
async function deleteFolderSubmit() {
  const input: InputOf<typeof api.mail.mailboxes.delete> = {
    account: store.accountId,
    id: mailbox.id,
    name: mailbox._name,
  }
  await deleteFolder.run(input)
  raiseToast(__('Folder deleted.'))
  show.value = false
}
</script>
