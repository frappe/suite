<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add to Mailing Lists'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					disabled: !listIds.length,
					loading: addLists.loading,
					onClick: addLists.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-1.5">
				<label class="text-ink-gray-5 block text-xs">{{ __('Mailing Lists') }}</label>
				<MultiSelect v-model="listIds" :options="options" />
				<ErrorMessage
					:message="addLists.error && (addLists.error?.messages?.[0] || addLists.error?.message || __('Request failed.'))"
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

const listIds = ref<string[]>([])

const lists = createResource({ url: 'suite.mail.api.admin.get_mailing_lists', auto: true })

// Exclude mailing lists the member is already a recipient of.
const options = computed(() =>
	(lists.data || [])
		.filter((ml: { id: string }) => !currentIds.includes(ml.id))
		.map((ml: { id: string; name: string; email?: string }) => ({ label: ml.email || ml.name, value: ml.id })),
)

watch(show, () => {
	if (show.value) {
		listIds.value = []
		addLists.reset()
	}
})

const addLists = createResource({
	url: 'suite.mail.api.admin.add_member_to_mailing_lists',
	makeParams: () => ({ member_id: memberId, list_ids: listIds.value }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Added to mailing lists.'))
	},
})
</script>
