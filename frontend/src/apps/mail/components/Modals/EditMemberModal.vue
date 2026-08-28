<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Edit Member'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					disabled: !description,
					loading: updateMember.loading,
					onClick: updateMember.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl v-model="role" type="select" :label="__('Role')" :options="ROLE_OPTIONS" />
				<FormControl v-model="description" :label="__('Full Name')" />
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Locale') }}</label>
					<Combobox v-model="locale" :options="localeOptions" :placeholder="__('Select a locale')" />
				</div>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Time Zone') }}</label>
					<Combobox v-model="timeZone" :options="timeZoneOptions" :placeholder="__('Select a time zone')" />
				</div>
				<ErrorMessage
					:message="updateMember.error && (updateMember.error?.messages?.[0] || updateMember.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Combobox, Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { useAccountOptions } from '@/apps/mail/composables/useAccountOptions'

type MemberData = {
	name: string
	is_admin: boolean
	description?: string
	locale?: string | null
	time_zone?: string | null
}

const show = defineModel<boolean>()
const { member } = defineProps<{ member: MemberData }>()
const emit = defineEmits(['reload'])

const ROLE_OPTIONS = [
	{ label: __('User'), value: 'user' },
	{ label: __('Admin'), value: 'admin' },
]

const role = ref('user')
const description = ref('')
const locale = ref<string | null>(null)
const timeZone = ref<string | null>(null)

const { localeOptions, timeZoneOptions } = useAccountOptions()

watch(show, () => {
	if (show.value && member) {
		role.value = member.is_admin ? 'admin' : 'user'
		description.value = member.description || ''
		locale.value = member.locale || null
		timeZone.value = member.time_zone || ''
		updateMember.reset()
	}
})

const updateMember = createResource({
	url: 'suite.mail.api.admin.update_member',
	makeParams: () => ({
		member_id: member.name,
		role: role.value,
		description: description.value?.trim(),
		locale: locale.value || '',
		// Always sent: an empty value clears the time zone, which is how it is unset.
		time_zone: timeZone.value || '',
	}),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Member updated.'))
	},
})
</script>
