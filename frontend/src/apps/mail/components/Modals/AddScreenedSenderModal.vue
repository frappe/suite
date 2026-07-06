<template>
	<Dialog
		v-model="show"
		:options="{
			title: __('Screen a Sender'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					disabled: !canAdd,
					loading: screenEmailAddress.loading,
					onClick: screenEmailAddress.submit,
				},
			],
		}"
	>
		<template #body-content>
			<div class="space-y-4">
				<FormControl
					v-model="email"
					type="text"
					variant="outline"
					:label="__('Email or Domain')"
					:placeholder="__('john@example.com or @example.com')"
					@keydown.enter="canAdd && screenEmailAddress.submit()"
				/>
				<FormControl
					v-model="action"
					type="select"
					variant="outline"
					:label="__('Action')"
					:options="ACTION_OPTIONS"
				/>
				<p v-if="isAlreadyScreened" class="text-ink-gray-5 text-xs">
					{{ __('This sender is already screened.') }}
				</p>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Dialog, FormControl, createResource } from 'frappe-ui'

import { isEmailOrDomain, raiseToast } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'

import type { ScreenedAddress, ScreeningAction } from '@/apps/mail/types'

const show = defineModel<boolean>()

const store = userStore()
const { screenedAddresses } = store

const email = ref('')
const action = ref<ScreeningAction>('Reject')

// 'Accepted' lets the sender's mail reach the inbox; 'Reject' discards it silently; 'Spam' files it
// into the Spam folder.
const ACTION_OPTIONS = [
	{ label: __('Accept'), value: 'Accepted' },
	{ label: __('Block'), value: 'Reject' },
	{ label: __('Move to Junk'), value: 'Spam' },
]

// Mirror the backend's normalisation (trim; lowercase a '@domain' entry) so '@Frappe.io' is caught as
// a duplicate of a stored '@frappe.io'.
const normalizeScreenedValue = (value: string) => {
	const trimmed = value.trim()
	return trimmed.startsWith('@') ? '@' + trimmed.slice(1).toLowerCase() : trimmed
}

const isAlreadyScreened = computed(() =>
	(screenedAddresses.data ?? []).some(
		(a: ScreenedAddress) => a.email === normalizeScreenedValue(email.value),
	),
)

const canAdd = computed(() => isEmailOrDomain(email.value) && !isAlreadyScreened.value)

const screenEmailAddress = createResource({
	url: 'suite.mail.api.mail.screen_email_address',
	makeParams: () => ({ account: store.accountId, email: email.value, action: action.value }),
	onSuccess: () => {
		raiseToast(__('Sender screened.'))
		show.value = false
		screenedAddresses.reload()
	},
	onError: (error) => raiseToast(error.message, 'error'),
})

// Start each visit from a clean form.
watch(show, (open) => {
	if (open) {
		email.value = ''
		action.value = 'Reject'
	}
})
</script>
