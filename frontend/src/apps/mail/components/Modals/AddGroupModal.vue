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
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Members') }}</label>
					<MultiSelect v-model="memberIds" :options="accountOptions" />
				</div>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Roles') }}</label>
					<MultiSelect v-model="roleIds" :options="roleOptions" />
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

const show = defineModel<boolean>()
const router = useRouter()
const emit = defineEmits(['reload'])

const name = ref('')
const domain = ref('')
const description = ref('')
const memberIds = ref<string[]>([])
const roleIds = ref<string[]>([])

const domains = createResource({ url: 'suite.mail.api.admin.get_enabled_domains', auto: true })
const accounts = createResource({ url: 'suite.mail.api.admin.get_accounts', auto: true })
const roles = createResource({ url: 'suite.mail.api.admin.get_roles_list', auto: true })

const domainOptions = computed(() => (domains.data || []).map((d: string) => ({ label: d, value: d })))
const accountOptions = computed(() =>
	(accounts.data || []).map((a: { id: string; email: string }) => ({ label: a.email, value: a.id })),
)
const roleOptions = computed(() =>
	(roles.data || []).map((r: { id: string; description: string }) => ({ label: r.description, value: r.id })),
)

watch(show, () => {
	if (show.value) {
		name.value = ''
		domain.value = ''
		description.value = ''
		memberIds.value = []
		roleIds.value = []
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
		roles: roleIds.value,
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
