<template>
	<DashboardLayout :breadcrumbs="breadcrumbs" :loading="!member.data">
		<DashboardDetailHeader
			:title="member.data.email || member.data.name || groupId"
			:meta="[member.data.description, memberCountLabel]"
		>
			<template #icon><Users class="h-5 w-5" /></template>
			<template #actions>
				<Button :label="__('Edit')" @click="showEdit = true" />
				<Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
			</template>
		</DashboardDetailHeader>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			<!-- General Information -->
			<DashboardCard :title="__('General Information')">
				<div>
					<InformationField :label="__('Roles')" :value="roleLabels.join(', ')" />
					<InformationField :label="__('Locale')" :value="localeLabel(member.data.locale)" />
					<InformationField :label="__('Time Zone')" :value="member.data.time_zone" />
					<InformationField :label="__('Created At')" :value="createdAt" />
				</div>
			</DashboardCard>

			<!-- Quota Usage -->
			<DashboardCard :title="__('Quota Usage')" :button-label="__('Edit')" @action="showEditQuota = true">
				<QuotaDonut :quota="member.data.quota" />
			</DashboardCard>

			<!-- Email Addresses -->
			<DashboardCard :title="__('Email Addresses')" :button-label="__('Add')" @action="showAddEmail = true">
				<div class="flex flex-col">
					<div class="bg-surface-gray-2 text-ink-gray-5 flex items-center rounded-4 px-5 py-2.5 text-sm">
						<span class="flex-1">{{ __('Email Address') }}</span>
						<span class="flex-1">{{ __('Description') }}</span>
						<span class="w-20 shrink-0 text-center">{{ __('Enabled') }}</span>
						<span class="w-8 shrink-0" />
					</div>
					<template v-if="member.data.email_addresses.length">
						<div
							v-for="entry in member.data.email_addresses"
							:key="entry.email"
							class="group border-b px-5 py-3 text-base last:border-b-0"
						>
							<Tooltip
								class="block"
								:text="__('This is the primary address and cannot be removed.')"
								:disabled="!entry.is_primary"
							>
								<div class="flex w-full items-center">
									<span class="flex-1 truncate">{{ entry.email }}</span>
									<span class="text-ink-gray-5 flex-1 truncate">{{ entry.description || '—' }}</span>
									<span class="flex w-20 shrink-0 justify-center">
										<Switch
											:model-value="entry.enabled"
											:disabled="entry.is_primary"
											@update:model-value="(value) => toggleEmailEnabled(entry, value)"
										/>
									</span>
									<span class="flex w-8 shrink-0 justify-end">
										<Button
											v-if="!entry.is_primary"
											variant="ghost"
											theme="red"
											class="invisible group-hover:visible"
											@click="removeEmail(entry.email)"
										>
											<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
										</Button>
									</span>
								</div>
							</Tooltip>
						</div>
					</template>
					<div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">
						{{ __('No email addresses found.') }}
					</div>
				</div>
			</DashboardCard>

			<!-- Members -->
			<DashboardCard :title="__('Members')" :button-label="__('Add')" @action="showAddMembers = true">
				<div class="flex flex-col">
					<div class="px-5 py-2.5">
						<FormControl v-model="memberSearch" :placeholder="__('Search by email')">
							<template #prefix>
								<FeatherIcon name="search" class="text-ink-gray-5 w-4" />
							</template>
						</FormControl>
					</div>
					<template v-if="filteredMembers.length">
						<div
							v-for="m in filteredMembers"
							:key="m.id"
							class="group hover:bg-surface-gray-2 flex cursor-pointer items-center border-b px-5 py-3 text-base last:border-b-0"
							@click="m.email && router.push({ name: 'mail-member', params: { memberId: m.email } })"
						>
							<span class="flex-1 truncate">{{ m.email || m.name }}</span>
							<Button
								variant="ghost"
								theme="red"
								class="invisible group-hover:visible"
								@click.stop="removeMember(m.id)"
							>
								<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
							</Button>
						</div>
					</template>
					<div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">
						{{ __('No members found.') }}
					</div>
				</div>
			</DashboardCard>
		</div>
	</DashboardLayout>
	<EditGroupModal v-if="member.data" v-model="showEdit" :group="member.data" @reload="member.reload()" />
	<EditGroupQuotaModal v-if="member.data" v-model="showEditQuota" :group="member.data" @reload="member.reload()" />
	<AddGroupEmailModal v-model="showAddEmail" :group-id="groupId" @reload="member.reload()" />
	<AddGroupMembersModal
		v-model="showAddMembers"
		:group-id="groupId"
		:current-ids="currentMemberIds"
		@reload="member.reload()"
	/>
	<Dialog v-model:open="showDelete" v-bind="deleteDialogOptions" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
	Button, Dialog, Dropdown, FormControl, Switch, Tooltip, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import Users from '~icons/lucide/users'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import { useAccountOptions } from '@/apps/mail/composables/useAccountOptions'
import AddGroupEmailModal from '@/apps/mail/components/Modals/AddGroupEmailModal.vue'
import AddGroupMembersModal from '@/apps/mail/components/Modals/AddGroupMembersModal.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import EditGroupModal from '@/apps/mail/components/Modals/EditGroupModal.vue'
import EditGroupQuotaModal from '@/apps/mail/components/Modals/EditGroupQuotaModal.vue'
import InformationField from '@/apps/mail/components/InformationField.vue'
import QuotaDonut from '@/apps/mail/components/QuotaDonut.vue'

import type { QuotaUsage } from '@/apps/mail/types'

type GroupData = {
	id: string
	name: string
	email: string
	description?: string
	created_at?: string
	role_ids: string[]
	email_addresses: { email: string; description?: string; is_primary: boolean; enabled: boolean }[]
	members: { id: string; name?: string; email?: string }[]
	quota: QuotaUsage
}

const { groupId } = defineProps<{ groupId: string }>()

const router = useRouter()
const { localeLabel } = useAccountOptions()

usePageMeta(() => ({ title: (member.data as GroupData | undefined)?.email || groupId }))

const showEdit = ref(false)
const showEditQuota = ref(false)
const showAddEmail = ref(false)
const showAddMembers = ref(false)
const showDelete = ref(false)
const memberSearch = ref('')

// Named `member` so the quota/card markup mirrors MemberView.vue one-to-one.
const member = createResource({
	url: 'suite.mail.api.admin.get_group',
	auto: true,
	makeParams: () => ({ group_id: groupId }),
	cache: ['mailGroup', groupId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Group not found.'), 'error')
		router.replace({ name: 'mail-groups' })
	},
})

const data = computed(() => member.data as GroupData | undefined)

const roles = createResource({ url: 'suite.mail.api.admin.get_roles_list', auto: true })
const roleLabels = computed(() => {
	const map = new Map((roles.data || []).map((r: { id: string; description: string }) => [r.id, r.description]))
	return (data.value?.role_ids || []).map((id: string) => map.get(id) || id)
})

const currentMemberIds = computed(() => data.value?.members.map((m) => m.id) || [])
const filteredMembers = computed(() => {
	const members = data.value?.members || []
	const q = memberSearch.value.trim().toLowerCase()
	return q ? members.filter((m) => (m.email || '').toLowerCase().includes(q)) : members
})

const createdAt = computed(() => formatDateTime(data.value?.created_at))

const memberCountLabel = computed(() => {
	const count = data.value?.members.length ?? 0
	return count === 1 ? __('1 member') : __('{0} members', [String(count)])
})

const breadcrumbs = computed(() => [
	{ label: __('Groups'), route: '/mail/dashboard/groups' },
	{ label: data.value?.email || groupId },
])

const toggleEmailEnabled = (entry: { email: string; enabled: boolean }, value: boolean) => {
	entry.enabled = value // optimistic; reverted on error via reload
	createResource({
		url: 'suite.mail.api.admin.set_group_email_enabled',
		makeParams: () => ({ group_id: groupId, email: entry.email, enabled: value ? 1 : 0 }),
		onSuccess: () => raiseToast(value ? __('Email address enabled.') : __('Email address disabled.')),
		onError: (error: { messages?: string[] }) => {
			member.reload()
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
		},
	}).submit()
}

const removeEmail = (email: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_group_email',
		makeParams: () => ({ group_id: groupId, email }),
		onSuccess: () => {
			member.reload()
			raiseToast(__('Email address removed.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const removeMember = (accountId: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_group_member',
		makeParams: () => ({ group_id: groupId, account_id: accountId }),
		onSuccess: () => {
			member.reload()
			raiseToast(__('Member removed.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const deleteGroup = createResource({
	url: 'suite.mail.api.admin.delete_groups',
	makeParams: () => ({ ids: [groupId] }),
	onSuccess: () => {
		showDelete.value = false
		raiseToast(__('Group deleted.'))
		router.push({ name: 'mail-groups' })
	},
})

const deleteDialogOptions = computed(() => ({
	title: __('Delete Group'),
	message: __('Are you sure you want to delete this group? This action cannot be undone.'),
	size: 'xl',
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: deleteGroup.submit }],
}))

const dropdownOptions = computed(() => [
	{
		group: '',
		options: [{ label: __('Delete'), icon: 'lucide-trash-2', onClick: () => (showDelete.value = true) }],
	},
])
</script>
