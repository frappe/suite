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
				<MultiSelect v-model="accountIds" :options="options" />
				<ErrorMessage
					:message="addMembers.error && (addMembers.error?.messages?.[0] || addMembers.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Dialog, ErrorMessage, MultiSelect, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { groupId, currentIds } = defineProps<{ groupId: string; currentIds: string[] }>()
const emit = defineEmits(['reload'])

const accountIds = ref<string[]>([])

const accounts = createResource({ url: 'suite.mail.api.admin.get_accounts', auto: true })

// Exclude accounts already in the group.
const options = computed(() =>
	(accounts.data || [])
		.filter((a: { id: string }) => !currentIds.includes(a.id))
		.map((a: { id: string; email: string }) => ({ label: a.email, value: a.id })),
)

watch(show, () => {
	if (show.value) {
		accountIds.value = []
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
