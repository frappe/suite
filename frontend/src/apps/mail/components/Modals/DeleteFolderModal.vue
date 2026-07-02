<template>
	<Dialog
		v-model="show"
		:options="{
			title: __('Delete {0}', [mailbox?._name]),
			message: __(
				`Are you sure you want to delete '{0}'? Mails in this folder will be permanently removed.`,
				[mailbox?._name],
			),
			icon: { name: 'alert-triangle', appearance: 'warning' },
			actions: [{ label: __('Confirm'), theme: 'red', onClick: deleteFolder.submit }],
		}"
	/>
</template>

<script setup lang="ts">
import { Dialog, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'

import type { MailboxData } from '@/apps/mail/types'

const show = defineModel<boolean>()

const { mailbox } = defineProps<{ mailbox?: MailboxData }>()

const store = userStore()

const deleteFolder = createResource({
	url: 'suite.mail.api.mail.delete_mailbox',
	makeParams: () => ({ account: store.accountId, id: mailbox.id, name: mailbox._name }),
	onSuccess: () => {
		raiseToast(__('Folder deleted.'))
		show.value = false
		store.mailboxes.reload()
		store.sieveScripts.reload()
	},
	onError: (error) => raiseToast(error.message, 'error'),
})
</script>
