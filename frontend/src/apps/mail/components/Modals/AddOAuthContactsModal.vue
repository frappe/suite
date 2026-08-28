<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Contacts'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					disabled: !validContacts.length,
					loading: addContacts.loading,
					onClick: addContacts.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<div class="space-y-2">
					<label class="text-ink-gray-5 block text-xs">{{ __('Contacts') }}</label>
					<div v-for="(row, index) in contacts" :key="index" class="flex items-center gap-2">
						<FormControl
							v-model="row.value"
							type="email"
							placeholder="someone@example.com"
							class="w-full"
						/>
						<Button
							v-if="contacts.length > 1"
							variant="ghost"
							theme="red"
							@click="contacts.splice(index, 1)"
						>
							<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
						</Button>
					</div>
					<Button variant="ghost" size="sm" :label="__('Add another')" @click="contacts.push({ value: '' })">
						<template #prefix><FeatherIcon name="plus" class="h-4 w-4" /></template>
					</Button>
				</div>
				<ErrorMessage
					:message="addContacts.error && (addContacts.error?.messages?.[0] || addContacts.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { clientId } = defineProps<{ clientId: string }>()
const emit = defineEmits(['reload'])

const contacts = ref<{ value: string }[]>([{ value: '' }])

const validContacts = computed(() => contacts.value.map((c) => c.value.trim()).filter(Boolean))

watch(show, () => {
	if (show.value) {
		contacts.value = [{ value: '' }]
		addContacts.reset()
	}
})

const addContacts = createResource({
	url: 'suite.mail.api.admin.add_oauth_client_contacts',
	makeParams: () => ({ client_id: clientId, contacts: validContacts.value }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Contacts added.'))
	},
})
</script>
