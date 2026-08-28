<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Role'),
			actions: [
				{
					label: __('Add Role'),
					variant: 'solid',
					disabled: !description,
					loading: addRole.loading,
					onClick: addRole.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl
					v-model="description"
					:label="__('Description')"
					autocomplete="off"
					:description="__('Shown as the role\'s name across the dashboard.')"
				/>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Enabled Permissions') }}</label>
					<MultiSelect v-model="enabledPermissions" :options="permissionOptions" />
				</div>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Disabled Permissions') }}</label>
					<MultiSelect v-model="disabledPermissions" :options="permissionOptions" />
				</div>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Inherited Roles') }}</label>
					<MultiSelect v-model="roleIds" :options="roleOptions" />
				</div>
				<ErrorMessage
					:message="addRole.error && (addRole.error?.messages?.[0] || addRole.error?.message || __('Request failed.'))"
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

const description = ref('')
const enabledPermissions = ref<string[]>([])
const disabledPermissions = ref<string[]>([])
const roleIds = ref<string[]>([])

const permissions = createResource({ url: 'suite.mail.api.admin.get_permissions', auto: true })
const roles = createResource({ url: 'suite.mail.api.admin.get_roles_list', auto: true })

const permissionOptions = computed(() =>
	(permissions.data || []).map((p: { value: string; label: string }) => ({ label: p.label, value: p.value })),
)
const roleOptions = computed(() =>
	(roles.data || []).map((r: { id: string; description: string }) => ({ label: r.description, value: r.id })),
)

watch(show, () => {
	if (show.value) {
		description.value = ''
		enabledPermissions.value = []
		disabledPermissions.value = []
		roleIds.value = []
		addRole.reset()
	}
})

const addRole = createResource({
	url: 'suite.mail.api.admin.add_role',
	makeParams: () => ({
		description: description.value,
		enabled_permissions: enabledPermissions.value,
		disabled_permissions: disabledPermissions.value,
		role_ids: roleIds.value,
	}),
	onSuccess: (data: string) => {
		if (!data) return
		show.value = false
		emit('reload')
		raiseToast(__('Role added.'))
		router.push({ name: 'mail-role', params: { roleId: data } })
	},
})
</script>
