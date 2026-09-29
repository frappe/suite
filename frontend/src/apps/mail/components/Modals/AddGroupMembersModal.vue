<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Members'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					disabled: !accountIds.length,
					loading: addMembers.loading,
					onClick: addMembers.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-1.5">
				<label class="text-ink-gray-5 block text-xs">{{ __('Accounts') }}</label>
				<MultiSelect
					v-model="accountIds"
					v-model:query="picker.query"
					:options="picker.options"
					:filterable="false"
					:placeholder="__('Search accounts')"
				/>
				<ErrorMessage
					:message="addMembers.error && (addMembers.error?.messages?.[0] || addMembers.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, MultiSelect, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { useAccountPicker } from '@/apps/mail/utils/accountPicker'

const show = defineModel<boolean>()
const { groupId, currentIds } = defineProps<{ groupId: string; currentIds: string[] }>()
const emit = defineEmits(['reload'])

const accountIds = ref<string[]>([])

// Accounts already in the group are not offered again.
const picker = useAccountPicker(accountIds, () => currentIds)

watch(show, () => {
	if (show.value) {
		accountIds.value = []
		picker.reset()
		addMembers.reset()
	}
})

const addMembers = createResource({
	url: 'suite.mail.api.admin.add_group_members',
	makeParams: () => ({ group_id: groupId, account_ids: accountIds.value }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Members added.'))
	},
})
</script>
