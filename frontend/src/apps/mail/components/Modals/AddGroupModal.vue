<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Group'),
			actions: [
				{
					label: __('Add Group'),
					variant: 'solid',
					disabled: !(name && domain),
					loading: addGroup.loading,
					onClick: addGroup.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl
					v-model="name"
					:label="__('Name')"
					placeholder="team"
					autocomplete="off"
					:description="__('Together with the domain, this forms the group\'s email address.')"
				/>
				<FormControl
					v-model="domain"
					type="select"
					:label="__('Domain')"
					:options="domainOptions"
				/>
				<FormControl v-model="description" :label="__('Description')" />
				<FormControl
					v-model="quotaGb"
					type="number"
					:min="0"
					:label="__('Quota (GB)')"
					:description="__('Leave blank to use the configured default disk quota.')"
				/>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Members') }}</label>
					<MultiSelect
						v-model="memberIds"
						v-model:query="picker.query"
						:options="picker.options"
						:filterable="false"
						:placeholder="__('Search accounts')"
					/>
				</div>
				<ErrorMessage
					:message="addGroup.error && (addGroup.error?.messages?.[0] || addGroup.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Dialog, ErrorMessage, FormControl, MultiSelect, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { useAccountPicker } from '@/apps/mail/utils/accountPicker'

const show = defineModel<boolean>()
const router = useRouter()
const emit = defineEmits(['reload'])

const name = ref('')
const domain = ref('')
const description = ref('')
const quotaGb = ref<string | number>('')
const memberIds = ref<string[]>([])

const domains = createResource({ url: 'suite.mail.api.admin.get_enabled_domains', auto: true })
const picker = useAccountPicker(memberIds)

const domainOptions = computed(() => (domains.data || []).map((d: string) => ({ label: d, value: d })))

watch(show, () => {
	if (show.value) {
		name.value = ''
		domain.value = ''
		description.value = ''
		quotaGb.value = ''
		memberIds.value = []
		picker.reset()
		addGroup.reset()
	}
})

const addGroup = createResource({
	url: 'suite.mail.api.admin.add_group',
	makeParams: () => ({
		name: name.value,
		domain: domain.value,
		description: description.value?.trim() || undefined,
		members: memberIds.value,
		quota_gb: quotaGb.value === '' ? null : Number(quotaGb.value),
	}),
	onSuccess: (data: string) => {
		if (!data) return
		show.value = false
		emit('reload')
		raiseToast(__('Group added.'))
		router.push({ name: 'mail-group', params: { groupId: data } })
	},
})
</script>
