<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Edit Quota'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					loading: updateQuota.loading,
					onClick: updateQuota.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl
					v-model="quotaGb"
					type="number"
					:min="0"
					:label="__('Quota (GB, 0 = unlimited)')"
				/>
				<ErrorMessage
					:message="updateQuota.error && (updateQuota.error?.messages?.[0] || updateQuota.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

type MemberData = { name: string; quota: { total: number } }

const show = defineModel<boolean>()
const { member } = defineProps<{ member: MemberData }>()
const emit = defineEmits(['reload'])

const quotaGb = ref(0)

watch(show, () => {
	if (show.value && member) {
		quotaGb.value = member.quota?.total ? Math.round(member.quota.total / 1024 ** 3) : 0
		updateQuota.reset()
	}
})

const updateQuota = createResource({
	url: 'suite.mail.api.admin.update_member',
	makeParams: () => ({ member_id: member.name, quota_gb: Number(quotaGb.value) || 0 }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Quota updated.'))
	},
})
</script>
