<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Edit Mailing List'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					loading: updateList.loading,
					onClick: updateList.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl v-model="description" :label="__('Description')" />
				<ErrorMessage
					:message="updateList.error && (updateList.error?.messages?.[0] || updateList.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

type ListData = { id: string; description?: string }

const show = defineModel<boolean>()
const { list } = defineProps<{ list: ListData }>()
const emit = defineEmits(['reload'])

const description = ref('')

watch(show, () => {
	if (show.value && list) {
		description.value = list.description || ''
		updateList.reset()
	}
})

const updateList = createResource({
	url: 'suite.mail.api.admin.update_mailing_list',
	makeParams: () => ({ list_id: list.id, description: description.value?.trim() || '' }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Mailing list updated.'))
	},
})
</script>
