<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Email Address'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					disabled: !(username && domain),
					loading: addEmail.loading,
					onClick: addEmail.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<FormControl v-model="username" :label="__('Username')" placeholder="announce" class="w-full" />
					<FeatherIcon class="text-ink-gray-3 mx-2.5 mb-1.5 mt-auto h-4 w-4" name="at-sign" />
					<FormControl
						v-model="domain"
						type="combobox"
						:label="__('Domain')"
						placeholder="yourdomain.com"
						class="w-full"
						:options="domains.data"
						:open-on-click="true"
					/>
				</div>
				<p class="text-ink-gray-4 -mt-2 text-xs">
					{{ __('Mail sent to this address is distributed to the list\'s recipients.') }}
				</p>
				<FormControl
					v-model="description"
					:label="__('Description')"
					:placeholder="__('Used as the display name for this address')"
				/>
				<ErrorMessage
					:message="addEmail.error && (addEmail.error?.messages?.[0] || addEmail.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { listId } = defineProps<{ listId: string }>()
const emit = defineEmits(['reload'])

const username = ref('')
const domain = ref('')
const description = ref('')

const domains = createResource({ url: 'suite.mail.api.admin.get_enabled_domains', auto: true })

watch(show, () => {
	if (show.value) {
		username.value = ''
		domain.value = ''
		description.value = ''
		addEmail.reset()
	}
})

const addEmail = createResource({
	url: 'suite.mail.api.admin.add_mailing_list_email',
	makeParams: () => ({
		list_id: listId,
		email: `${username.value}@${domain.value}`,
		description: description.value?.trim() || undefined,
	}),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Email address added.'))
	},
})
</script>
