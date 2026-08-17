<template>
	<DashboardLayout :breadcrumbs="breadcrumbs" :loading="!role.data">
		<template #default>
			<DashboardDetailHeader :title="role.data.description || role.data.id" :meta="[role.data.id]">
				<template #icon><ShieldCheck class="h-5 w-5" /></template>
				<template #actions>
					<Button :label="__('Edit')" @click="showEdit = true" />
					<Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
				</template>
			</DashboardDetailHeader>

			<div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
				<DashboardCard :title="__('Inherited Roles')">
					<div class="p-4">
						<p class="text-ink-gray-5 mb-3 text-sm">
							{{ __('This role also grants everything the selected roles allow.') }}
						</p>
						<MultiSelect
							:model-value="roleIds"
							:options="roleOptions"
							@update:model-value="(value) => save('role_ids', value as string[])"
						/>
					</div>
				</DashboardCard>

				<DashboardCard :title="__('Enabled Permissions')">
					<div class="p-4">
						<p class="text-ink-gray-5 mb-3 text-sm">
							{{ __('Granted to every account that holds this role.') }}
						</p>
						<MultiSelect
							:model-value="enabledPermissions"
							:options="permissionOptions"
							@update:model-value="(value) => save('enabled_permissions', value as string[])"
						/>
					</div>
				</DashboardCard>

				<DashboardCard :title="__('Disabled Permissions')">
					<div class="p-4">
						<p class="text-ink-gray-5 mb-3 text-sm">
							{{ __('Explicitly denied, even if an inherited role grants them.') }}
						</p>
						<MultiSelect
							:model-value="disabledPermissions"
							:options="permissionOptions"
							@update:model-value="(value) => save('disabled_permissions', value as string[])"
						/>
					</div>
				</DashboardCard>
			</div>
		</template>
	</DashboardLayout>
	<EditRoleModal v-if="role.data" v-model="showEdit" :role="role.data" @reload="role.reload()" />
	<Dialog v-model:open="showDelete" v-bind="deleteDialogOptions" />
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Dialog, Dropdown, MultiSelect, createResource, usePageMeta } from 'frappe-ui'

import ShieldCheck from '~icons/lucide/shield-check'

import { raiseToast } from '@/apps/mail/utils'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import EditRoleModal from '@/apps/mail/components/Modals/EditRoleModal.vue'

type RoleData = {
	id: string
	description: string
	enabled_permissions: string[]
	disabled_permissions: string[]
	role_ids: string[]
}

const { roleId } = defineProps<{ roleId: string }>()
const router = useRouter()

usePageMeta(() => ({ title: (role.data as RoleData | undefined)?.description || roleId }))

const showEdit = ref(false)
const showDelete = ref(false)

const enabledPermissions = ref<string[]>([])
const disabledPermissions = ref<string[]>([])
const roleIds = ref<string[]>([])

const role = createResource({
	url: 'suite.mail.api.admin.get_role',
	auto: true,
	makeParams: () => ({ role_id: roleId }),
	cache: ['mailRole', roleId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Role not found.'), 'error')
		router.replace({ name: 'mail-roles' })
	},
})

// Keep the editable chip selections in sync whenever the role (re)loads.
watch(
	() => role.data as RoleData | undefined,
	(data) => {
		if (!data) return
		enabledPermissions.value = [...data.enabled_permissions]
		disabledPermissions.value = [...data.disabled_permissions]
		roleIds.value = [...data.role_ids]
	},
	{ immediate: true },
)

const permissions = createResource({ url: 'suite.mail.api.admin.get_permissions', auto: true })
const roles = createResource({ url: 'suite.mail.api.admin.get_roles_list', auto: true })

const permissionOptions = computed(() =>
	(permissions.data || []).map((p: { value: string; label: string }) => ({ label: p.label, value: p.value })),
)
const roleOptions = computed(() =>
	(roles.data || [])
		.filter((r: { id: string }) => r.id !== roleId)
		.map((r: { id: string; description: string }) => ({ label: r.description, value: r.id })),
)

const LOCAL_REFS: Record<string, typeof enabledPermissions> = {
	enabled_permissions: enabledPermissions,
	disabled_permissions: disabledPermissions,
	role_ids: roleIds,
}

const save = (field: 'enabled_permissions' | 'disabled_permissions' | 'role_ids', value: string[]) => {
	LOCAL_REFS[field].value = value // optimistic; reverted on error via reload
	createResource({
		url: 'suite.mail.api.admin.update_role',
		makeParams: () => ({ role_id: roleId, [field]: value }),
		onSuccess: () => raiseToast(__('Role updated.')),
		onError: (error: { messages?: string[] }) => {
			role.reload()
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
		},
	}).submit()
}

const breadcrumbs = computed(() => [
	{ label: __('Roles'), route: '/mail/dashboard/roles' },
	{ label: (role.data as RoleData | undefined)?.description || roleId },
])

const deleteRole = createResource({
	url: 'suite.mail.api.admin.delete_roles',
	makeParams: () => ({ ids: [roleId] }),
	onSuccess: () => {
		showDelete.value = false
		raiseToast(__('Role deleted.'))
		router.push({ name: 'mail-roles' })
	},
})

const deleteDialogOptions = computed(() => ({
	title: __('Delete Role'),
	message: __('Are you sure you want to delete this role? This action cannot be undone.'),
	size: 'xl',
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: deleteRole.submit }],
}))

const dropdownOptions = computed(() => [
	{
		group: '',
		options: [{ label: __('Delete'), icon: 'lucide-trash-2', onClick: () => (showDelete.value = true) }],
	},
])
</script>
