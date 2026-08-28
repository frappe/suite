<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add OAuth Client'),
			actions: [
				{
					label: __('Add OAuth Client'),
					variant: 'solid',
					disabled: !clientId,
					loading: addClient.loading,
					onClick: addClient.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl
					v-model="clientId"
					:label="__('Client ID')"
					autocomplete="off"
					:description="__('The unique identifier the application uses to identify itself.')"
				/>
				<FormControl v-model="description" :label="__('Description')" type="textarea" />

				<div class="space-y-2">
					<label class="text-ink-gray-5 block text-xs">{{ __('Contacts') }}</label>
					<p class="text-ink-gray-4 text-xs">
						{{ __('Email addresses responsible for this application.') }}
					</p>
					<div v-for="(row, index) in contacts" :key="index" class="flex items-center gap-2">
						<FormControl v-model="row.value" type="email" placeholder="someone@example.com" class="w-full" />
						<Button v-if="contacts.length > 1" variant="ghost" theme="red" @click="contacts.splice(index, 1)">
							<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
						</Button>
					</div>
					<Button variant="ghost" size="sm" :label="__('Add another')" @click="contacts.push({ value: '' })">
						<template #prefix><FeatherIcon name="plus" class="h-4 w-4" /></template>
					</Button>
				</div>

				<div class="space-y-2">
					<label class="text-ink-gray-5 block text-xs">{{ __('Redirect URIs') }}</label>
					<p class="text-ink-gray-4 text-xs">
						{{ __('Sign-ins are only redirected back to one of these URLs.') }}
					</p>
					<div v-for="(row, index) in redirectUris" :key="index" class="flex items-center gap-2">
						<FormControl v-model="row.value" placeholder="https://app.example.com/callback" class="w-full" />
						<Button v-if="redirectUris.length > 1" variant="ghost" theme="red" @click="redirectUris.splice(index, 1)">
							<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
						</Button>
					</div>
					<Button variant="ghost" size="sm" :label="__('Add another')" @click="redirectUris.push({ value: '' })">
						<template #prefix><FeatherIcon name="plus" class="h-4 w-4" /></template>
					</Button>
				</div>

				<FormControl
					v-model="secret"
					:label="__('Client Secret')"
					autocomplete="off"
					:description="__('Optional. Leave blank if the client authenticates without a secret.')"
				/>
				<FormControl
					v-model="logo"
					:label="__('Logo (URL or base64 encoded)')"
					type="textarea"
				/>
				<FormControl
					v-model="expiresAt"
					type="datetime-local"
					:label="__('Expires At')"
					:description="__('The client can no longer be used after this time.')"
				/>
				<ErrorMessage
					:message="addClient.error && (addClient.error?.messages?.[0] || addClient.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { fromLocalInput } from '@/apps/mail/utils/datetime'

const show = defineModel<boolean>()
const router = useRouter()
const emit = defineEmits(['reload'])

const clientId = ref('')
const description = ref('')
const contacts = ref<{ value: string }[]>([{ value: '' }])
const redirectUris = ref<{ value: string }[]>([{ value: '' }])
const secret = ref('')
const logo = ref('')
const expiresAt = ref('')

const values = (rows: { value: string }[]) => rows.map((r) => r.value.trim()).filter(Boolean)

watch(show, () => {
	if (show.value) {
		clientId.value = ''
		description.value = ''
		contacts.value = [{ value: '' }]
		redirectUris.value = [{ value: '' }]
		secret.value = ''
		logo.value = ''
		expiresAt.value = ''
		addClient.reset()
	}
})

const addClient = createResource({
	url: 'suite.mail.api.admin.add_oauth_client',
	makeParams: () => ({
		client_id: clientId.value,
		description: description.value?.trim() || undefined,
		contacts: values(contacts.value),
		redirect_uris: values(redirectUris.value),
		secret: secret.value?.trim() || undefined,
		logo: logo.value?.trim() || undefined,
		expires_at: fromLocalInput(expiresAt.value) || undefined,
	}),
	onSuccess: (data: string) => {
		if (!data) return
		show.value = false
		emit('reload')
		raiseToast(__('OAuth client added.'))
		router.push({ name: 'mail-oauth-client', params: { clientId: data } })
	},
})
</script>
