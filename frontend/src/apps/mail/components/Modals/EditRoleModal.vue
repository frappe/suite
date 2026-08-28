<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Edit Role'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					disabled: !description,
					loading: updateRole.loading,
					onClick: updateRole.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl
					v-model="description"
					:label="__('Description')"
					autocomplete="off"
					:description="__('Shown as the role\'s name across the dashboard.')"
				/>
				<ErrorMessage
					:message="updateRole.error && (updateRole.error?.messages?.[0] || updateRole.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

type RoleData = { id: string; description: string }

const show = defineModel<boolean>()
const { role } = defineProps<{ role: RoleData }>()
const emit = defineEmits(['reload'])

const description = ref('')

watch(show, () => {
	if (show.value && role) {
		description.value = role.description
		updateRole.reset()
	}
})

const updateRole = createResource({
	url: 'suite.mail.api.admin.update_role',
	makeParams: () => ({ role_id: role.id, description: description.value }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Role updated.'))
	},
})
</script>
