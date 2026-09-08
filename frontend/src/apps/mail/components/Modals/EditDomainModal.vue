<template>
	<Dialog
		v-model:open="show"
		v-bind="{
			title: __('Edit Domain'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					loading: updateDomain.loading,
					onClick: updateDomain.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl v-model="description" :label="__('Description')" />
				<FormControl
					v-model="catchAllAddress"
					type="email"
					:label="__('Catch-All Address')"
					:placeholder="__('inbox@{0}', [domain.name])"
					:description="
						__('Mail to an address that does not exist on this domain is delivered here. Leave empty to reject it.')
					"
				/>
				<FormControl
					v-model="subAddressing"
					type="checkbox"
					:label="__('Sub-addressing')"
					:description="__('Deliver mail sent to user+tag@{0} to the mailbox of user@{0}.', [domain.name])"
				/>
				<ErrorMessage
					:message="
						updateDomain.error &&
						(updateDomain.error?.messages?.[0] || updateDomain.error?.message || __('Request failed.'))
					"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

type DomainData = {
	id: string
	name: string
	description?: string
	catch_all_address?: string
	sub_addressing?: boolean
}

const show = defineModel<boolean>()
const { domain } = defineProps<{ domain: DomainData }>()
const emit = defineEmits(['reload'])

const description = ref('')
const catchAllAddress = ref('')
const subAddressing = ref(true)

watch(show, () => {
	if (show.value && domain) {
		description.value = domain.description || ''
		catchAllAddress.value = domain.catch_all_address || ''
		subAddressing.value = !!domain.sub_addressing
		updateDomain.reset()
	}
})

const updateDomain = createResource({
	url: 'suite.mail.api.admin.update_domain',
	makeParams: () => ({
		domain_id: domain.id,
		description: description.value.trim(),
		catch_all_address: catchAllAddress.value.trim(),
		sub_addressing: subAddressing.value,
	}),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Domain updated.'))
	},
})
</script>
