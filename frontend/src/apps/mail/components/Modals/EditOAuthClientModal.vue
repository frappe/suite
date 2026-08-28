<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Edit OAuth Client'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					loading: updateClient.loading,
					onClick: updateClient.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl v-model="clientId" :label="__('Client ID')" autocomplete="off" />
				<FormControl v-model="description" :label="__('Description')" type="textarea" />
				<FormControl
					v-model="secret"
					:label="__('Client Secret')"
					autocomplete="off"
					:placeholder="__('Leave blank to keep unchanged')"
				/>
				<FormControl v-model="logo" :label="__('Logo (URL or base64 encoded)')" type="textarea" />
				<FormControl
					v-model="expiresAt"
					type="datetime-local"
					:label="__('Expires At')"
					:description="__('The client can no longer be used after this time.')"
				/>
				<ErrorMessage
					:message="updateClient.error && (updateClient.error?.messages?.[0] || updateClient.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { fromLocalInput, toLocalInput } from '@/apps/mail/utils/datetime'

type ClientData = {
	id: string
	client_id: string
	description?: string
	logo?: string
	expires_at?: string
}

const show = defineModel<boolean>()
const { client } = defineProps<{ client: ClientData }>()
const emit = defineEmits(['reload'])

const clientId = ref('')
const description = ref('')
const secret = ref('')
const logo = ref('')
const expiresAt = ref('')

watch(show, () => {
	if (show.value && client) {
		clientId.value = client.client_id || ''
		description.value = client.description || ''
		secret.value = ''
		logo.value = client.logo || ''
		expiresAt.value = toLocalInput(client.expires_at)
		updateClient.reset()
	}
})

const updateClient = createResource({
	url: 'suite.mail.api.admin.update_oauth_client',
	makeParams: () => ({
		oauth_client_id: client.id,
		client_id: clientId.value?.trim() || undefined,
		description: description.value?.trim() || '',
		secret: secret.value?.trim() || undefined,
		logo: logo.value?.trim() ?? '',
		expires_at: fromLocalInput(expiresAt.value),
	}),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('OAuth client updated.'))
	},
})
</script>
