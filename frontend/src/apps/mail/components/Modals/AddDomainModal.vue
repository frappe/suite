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
							`To add a domain, you must already own it. Publish the ownership record below at your DNS provider first; the domain is added once it resolves.`,
						)
					}}
				</p>
				<FormControl
					v-model="domainName"
					:label="__('Domain Name')"
					placeholder="example.com"
					autocomplete="off"
					:description="__('After adding, copy the generated DNS records to your DNS provider.')"
					@blur="checkDomain.submit()"
				/>
				<div v-if="ownership" class="bg-surface-gray-1 space-y-1 rounded-4 border p-3 text-sm">
					<p class="text-ink-gray-5 text-xs">{{ __('Ownership record (TXT)') }}</p>
					<p class="font-mono text-xs break-all">{{ ownership.fqdn }}</p>
					<p class="font-mono text-xs break-all">{{ ownership.value }}</p>
					<Button
						size="sm"
						variant="subtle"
						:label="__('Copy value')"
						@click="copyToClipBoard(ownership.value)"
					/>
				</div>
				<FormControl
					v-model="domainDescription"
					:label="__('Description')"
					:placeholder="__('Primary domain for company email')"
					type="textarea"
				/>
				<ErrorMessage :message="errorMessage" />
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { copyToClipBoard, raiseToast } from '@/apps/mail/utils'

type OwnershipRecord = { type: string; host: string; fqdn: string; value: string }
type ResourceError = { messages?: string[]; message?: string }

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
		checkDomain.reset()
	}
})

// The record is the same for every domain the site adds, so it can be shown before the add.
const checkDomain = createResource({
	url: 'suite.mail.api.admin.get_domain_ownership_record',
	makeParams: () => ({ name: domainName.value.trim() }),
	validate: () => (domainName.value.trim() ? undefined : ' '),
})
const ownership = computed<OwnershipRecord | undefined>(() => checkDomain.data?.ownership_record)

const addDomain = createResource({
	url: 'suite.mail.api.admin.add_domain',
	makeParams: () => ({
		name: domainName.value.trim(),
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

const errorMessage = computed(() => {
	const error: ResourceError | undefined = addDomain.error || checkDomain.error
	return error ? error.messages?.[0] || error.message || __('Request failed.') : ''
})
</script>
