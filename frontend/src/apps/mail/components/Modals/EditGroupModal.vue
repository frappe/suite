<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Edit Group'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					loading: updateGroup.loading,
					onClick: updateGroup.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl v-model="description" :label="__('Description')" />
				<ErrorMessage
					:message="updateGroup.error && (updateGroup.error?.messages?.[0] || updateGroup.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

type GroupData = {
	id: string
	description?: string
}

const show = defineModel<boolean>()
const { group } = defineProps<{ group: GroupData }>()
const emit = defineEmits(['reload'])

const description = ref('')

watch(show, () => {
	if (show.value && group) {
		description.value = group.description || ''
		updateGroup.reset()
	}
})

const updateGroup = createResource({
	url: 'suite.mail.api.admin.update_group',
	makeParams: () => ({
		group_id: group.id,
		description: description.value?.trim() || '',
	}),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Group updated.'))
	},
})
</script>
