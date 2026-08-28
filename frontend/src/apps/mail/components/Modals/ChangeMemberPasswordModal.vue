<template>
	<Dialog v-model:open="show" v-bind="dialogOptions">
		<template #default>
			<div class="space-y-4">
				<FormControl
					v-model="newPassword"
					type="password"
					:label="__('New Password')"
					placeholder="••••••••"
					variant="outline"
				/>
				<FormControl
					v-model="confirmPassword"
					type="password"
					:label="__('Confirm New Password')"
					placeholder="••••••••"
					variant="outline"
				/>
				<ErrorMessage :message="errorMessage" />
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

const { memberId } = defineProps<{ memberId: string }>()

const show = defineModel<boolean>()

const newPassword = ref('')
const confirmPassword = ref('')

const errorMessage = computed(() =>
	confirmPassword.value && confirmPassword.value !== newPassword.value
		? __('Passwords do not match')
		: changePassword.error &&
			(changePassword.error?.messages?.[0] ||
				changePassword.error?.message ||
				__('Request failed.')),
)

const dialogOptions = computed(() => ({
	title: __('Change Password'),
	actions: [
		{
			label: __('Confirm'),
			variant: 'solid',
			loading: changePassword.loading,
			onClick: () => changePassword.submit(),
			disabled: !newPassword.value.length || confirmPassword.value !== newPassword.value,
		},
	],
}))

const changePassword = createResource({
	url: 'suite.mail.api.admin.change_member_password',
	makeParams: () => ({ member_id: memberId, new_password: newPassword.value }),
	onSuccess: () => {
		show.value = false
		raiseToast(__('Password updated.'))
	},
})

watch(show, () => {
	newPassword.value = ''
	confirmPassword.value = ''
	changePassword.reset()
})
</script>
