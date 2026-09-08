<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add to Groups'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					disabled: !groupIds.length,
					loading: addGroups.loading,
					onClick: addGroups.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-1.5">
				<label class="text-ink-gray-5 block text-xs">{{ __('Groups') }}</label>
				<MultiSelect v-model="groupIds" :options="options" />
				<ErrorMessage
					:message="addGroups.error && (addGroups.error?.messages?.[0] || addGroups.error?.message || __('Request failed.'))"
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
const { memberId, currentIds } = defineProps<{ memberId: string; currentIds: string[] }>()
const emit = defineEmits(['reload'])

const groupIds = ref<string[]>([])

const groups = createResource({ url: 'suite.mail.api.admin.get_groups', auto: true })

// Exclude groups the member already belongs to.
const options = computed(() =>
	(groups.data || [])
		.filter((g: { id: string }) => !currentIds.includes(g.id))
		.map((g: { id: string; name: string; email?: string }) => ({ label: g.email || g.name, value: g.id })),
)

watch(show, () => {
	if (show.value) {
		groupIds.value = []
		addGroups.reset()
	}
})

const addGroups = createResource({
	url: 'suite.mail.api.admin.add_member_to_groups',
	makeParams: () => ({ member_id: memberId, group_ids: groupIds.value }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Added to groups.'))
	},
})
</script>
