<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Domain'),
			actions: [
				{
					label: __('Add Domain'),
					variant: 'solid',
					disabled: !domainName,
					loading: addDomain.loading,
					onClick: addDomain.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<p class="text-p-base">
					{{
						__(
							`To add a domain, you must already own it. If you don't have one, purchase one and return here.`,
						)
					}}
				</p>
				<FormControl
					v-model="domainName"
					:label="__('Domain Name')"
					placeholder="example.com"
					autocomplete="off"
					:description="__('After adding, copy the generated DNS records to your DNS provider.')"
				/>
				<FormControl
					v-model="domainDescription"
					:label="__('Description')"
					:placeholder="__('Primary domain for company email')"
					type="textarea"
				/>
				<ErrorMessage
					:message="addDomain.error && (addDomain.error?.messages?.[0] || addDomain.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const router = useRouter()

const domainName = ref('')
const domainDescription = ref('')

const emit = defineEmits(['reloadDomains'])

watch(show, () => {
	if (show.value) {
		domainName.value = ''
		domainDescription.value = ''
		addDomain.reset()
	}
})

const addDomain = createResource({
	url: 'suite.mail.api.admin.add_domain',
	makeParams: () => ({
		name: domainName.value,
		description: domainDescription.value?.trim() || undefined,
	}),
	onSuccess: (data: string) => {
		if (!data) return

		show.value = false
		emit('reloadDomains')
		raiseToast(__('Domain added.'))
		router.push({ name: 'mail-domain', params: { domainId: data } })
	},
})
</script>
