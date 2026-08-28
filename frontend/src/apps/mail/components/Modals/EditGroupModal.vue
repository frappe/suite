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
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Roles') }}</label>
					<MultiSelect v-model="roleIds" :options="roleOptions" />
				</div>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Locale') }}</label>
					<Combobox v-model="locale" :options="localeOptions" :placeholder="__('Select a locale')" />
				</div>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Time Zone') }}</label>
					<Combobox v-model="timeZone" :options="timeZoneOptions" :placeholder="__('Select a time zone')" />
				</div>
				<ErrorMessage
					:message="updateGroup.error && (updateGroup.error?.messages?.[0] || updateGroup.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Combobox, Dialog, ErrorMessage, FormControl, MultiSelect, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { useAccountOptions } from '@/apps/mail/composables/useAccountOptions'

type GroupData = {
	id: string
	description?: string
	role_ids: string[]
	locale?: string | null
	time_zone?: string | null
}

const show = defineModel<boolean>()
const { group } = defineProps<{ group: GroupData }>()
const emit = defineEmits(['reload'])

const description = ref('')
const roleIds = ref<string[]>([])
const locale = ref<string | null>(null)
const timeZone = ref<string | null>(null)

const { localeOptions, timeZoneOptions } = useAccountOptions()

const roles = createResource({ url: 'suite.mail.api.admin.get_roles_list', auto: true })
const roleOptions = computed(() =>
	(roles.data || []).map((r: { id: string; description: string }) => ({ label: r.description, value: r.id })),
)

watch(show, () => {
	if (show.value && group) {
		description.value = group.description || ''
		roleIds.value = [...group.role_ids]
		locale.value = group.locale || null
		timeZone.value = group.time_zone || ''
		updateGroup.reset()
	}
})

const updateGroup = createResource({
	url: 'suite.mail.api.admin.update_group',
	makeParams: () => ({
		group_id: group.id,
		description: description.value?.trim() || '',
		roles: roleIds.value,
		locale: locale.value || '',
		// Always sent: an empty value clears the time zone, which is how it is unset.
		time_zone: timeZone.value || '',
	}),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Group updated.'))
	},
})
</script>
