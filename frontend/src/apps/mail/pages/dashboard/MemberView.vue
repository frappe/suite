<template>
	<DashboardLayout :breadcrumbs="BREADCRUMBS" :loading="!member.data">
		<DashboardDetailHeader
			:title="member.data.description || member.data.name"
			:badge-label="badge.label"
			:badge-theme="badge.theme"
			:meta="[member.data.name, member.data.is_admin ? __('Admin') : __('User')]"
		>
			<template #actions>
				<Button :label="__('Edit')" @click="showEdit = true" />
				<Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
			</template>
		</DashboardDetailHeader>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			<!-- General Information -->
			<DashboardCard :title="__('General Information')">
				<div>
					<InformationField
						:label="__('Role')"
						:value="member.data.is_admin ? __('Admin') : __('User')"
					/>
					<InformationField :label="__('Locale')" :value="localeLabel(member.data.locale)" />
					<InformationField :label="__('Time Zone')" :value="member.data.time_zone" />
					<InformationField :label="__('Last Active')" :value="lastActive" />
					<InformationField :label="__('Joined On')" :value="joinedOn" />
				</div>
			</DashboardCard>

			<!-- Quota Usage -->
			<DashboardCard :title="__('Quota Usage')" :button-label="__('Edit')" @action="showEditQuota = true">
				<QuotaDonut :quota="member.data.quota" />
			</DashboardCard>

			<!-- Email Addresses -->
			<DashboardCard
				:title="__('Email Addresses')"
				:button-label="__('Add')"
				@action="showAddEmail = true"
			>
				<div class="flex flex-col">
					<div class="bg-surface-gray-2 text-ink-gray-5 flex items-center rounded-4 px-5 py-2.5 text-sm">
						<span class="flex-1">{{ __('Email Address') }}</span>
						<span class="flex-1">{{ __('Full Name') }}</span>
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
									<span class="text-ink-gray-5 flex-1 truncate">
										{{ entry.description || '—' }}
									</span>
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

			<!-- Groups -->
			<DashboardCard :title="__('Groups')" :button-label="__('Add')" @action="showAddGroups = true">
				<div class="flex flex-col">
					<div class="bg-surface-gray-2 text-ink-gray-5 rounded-4 px-5 py-2.5 text-sm">
						{{ __('Group') }}
					</div>
					<template v-if="member.data.groups.length">
						<div
							v-for="group in member.data.groups"
							:key="group.id"
							class="group hover:bg-surface-gray-2 flex cursor-pointer items-center justify-between border-b px-5 py-3 text-base last:border-b-0"
							@click="router.push({ name: 'mail-group', params: { groupId: group.id } })"
						>
							<span>{{ group.email || group.name }}</span>
							<Button
								variant="ghost"
								theme="red"
								class="invisible group-hover:visible"
								@click.stop="removeGroup(group.id)"
							>
								<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
							</Button>
						</div>
					</template>
					<div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">
						{{ __('Not a member of any group.') }}
					</div>
				</div>
			</DashboardCard>

			<!-- Mailing Lists -->
			<DashboardCard :title="__('Mailing Lists')" :button-label="__('Add')" @action="showAddLists = true">
				<div class="flex flex-col">
					<div class="bg-surface-gray-2 text-ink-gray-5 rounded-4 px-5 py-2.5 text-sm">
						{{ __('Mailing List') }}
					</div>
					<template v-if="member.data.mailing_lists.length">
						<div
							v-for="list in member.data.mailing_lists"
							:key="list.id"
							class="group hover:bg-surface-gray-2 flex cursor-pointer items-center justify-between border-b px-5 py-3 text-base last:border-b-0"
							@click="router.push({ name: 'mail-mailing-list', params: { listId: list.id } })"
						>
							<span>{{ list.email || list.name }}</span>
							<Button
								variant="ghost"
								theme="red"
								class="invisible group-hover:visible"
								@click.stop="removeList(list.id)"
							>
								<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
							</Button>
						</div>
					</template>
					<div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">
						{{ __('Not a recipient of any mailing list.') }}
					</div>
				</div>
			</DashboardCard>
		</div>
	</DashboardLayout>
	<Dialog v-model:open="showResetPassword" v-bind="RESET_PASSWORD_OPTIONS" />
	<Dialog v-model:open="showToggleEnabled" v-bind="TOGGLE_ENABLED_OPTIONS" />
	<Dialog v-model:open="showDeleteMember" v-bind="DELETE_MEMBER_OPTIONS" />
	<ChangeMemberPasswordModal v-model="showChangePassword" :member-id="memberId" />
	<EditMemberModal v-if="data" v-model="showEdit" :member="data" @reload="member.reload()" />
	<EditMemberQuotaModal v-if="data" v-model="showEditQuota" :member="data" @reload="member.reload()" />
	<AddMemberEmailModal v-model="showAddEmail" :member-id="memberId" @reload="member.reload()" />
	<AddMemberGroupsModal
		v-model="showAddGroups"
		:member-id="memberId"
		:current-ids="currentGroupIds"
		@reload="member.reload()"
	/>
	<AddMemberMailingListsModal
		v-model="showAddLists"
		:member-id="memberId"
		:current-ids="currentListIds"
		@reload="member.reload()"
	/>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
	Button, Dialog, Dropdown, Switch, Tooltip, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import { useAccountOptions } from '@/apps/mail/composables/useAccountOptions'
import AddMemberEmailModal from '@/apps/mail/components/Modals/AddMemberEmailModal.vue'
import AddMemberGroupsModal from '@/apps/mail/components/Modals/AddMemberGroupsModal.vue'
import AddMemberMailingListsModal from '@/apps/mail/components/Modals/AddMemberMailingListsModal.vue'
import ChangeMemberPasswordModal from '@/apps/mail/components/Modals/ChangeMemberPasswordModal.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import EditMemberModal from '@/apps/mail/components/Modals/EditMemberModal.vue'
import EditMemberQuotaModal from '@/apps/mail/components/Modals/EditMemberQuotaModal.vue'
import InformationField from '@/apps/mail/components/InformationField.vue'
import QuotaDonut from '@/apps/mail/components/QuotaDonut.vue'

import type { QuotaUsage } from '@/apps/mail/types'

type MemberData = {
	name: string
	full_name: string
	description: string
	last_active: string | null
	joined_on: string
	enabled: boolean
	is_admin: boolean
	email_addresses: { email: string; description?: string; is_primary: boolean; enabled: boolean }[]
	groups: { id: string; name: string; email: string }[]
	mailing_lists: { id: string; name: string; email: string }[]
	quota: QuotaUsage
}

const { memberId } = defineProps<{ memberId: string }>()

const router = useRouter()
const { localeLabel } = useAccountOptions()

usePageMeta(() => ({ title: memberId }))

const showDeleteMember = ref(false)
const showResetPassword = ref(false)
const showChangePassword = ref(false)
const showToggleEnabled = ref(false)
const showEdit = ref(false)
const showEditQuota = ref(false)
const showAddEmail = ref(false)
const showAddGroups = ref(false)
const showAddLists = ref(false)

const member = createResource({
	url: 'suite.mail.api.admin.get_member',
	auto: true,
	makeParams: () => ({ member_id: memberId }),
	cache: ['mailMember', memberId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Member not found.'), 'error')
		router.replace({ name: 'mail-members' })
	},
})

const data = computed(() => member.data as MemberData | undefined)

const currentGroupIds = computed(() => data.value?.groups.map((g) => g.id) || [])
const currentListIds = computed(() => data.value?.mailing_lists.map((l) => l.id) || [])

const toggleEmailEnabled = (entry: { email: string; enabled: boolean }, value: boolean) => {
	entry.enabled = value // optimistic; reverted on error via reload
	createResource({
		url: 'suite.mail.api.admin.set_member_email_enabled',
		makeParams: () => ({ member_id: memberId, email: entry.email, enabled: value ? 1 : 0 }),
		onSuccess: () => raiseToast(value ? __('Email address enabled.') : __('Email address disabled.')),
		onError: (error: { messages?: string[] }) => {
			member.reload()
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
		},
	}).submit()
}

const removeEmail = (email: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_member_email',
		makeParams: () => ({ member_id: memberId, email }),
		onSuccess: () => {
			member.reload()
			raiseToast(__('Email address removed.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const removeGroup = (groupId: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_member_from_group',
		makeParams: () => ({ member_id: memberId, group_id: groupId }),
		onSuccess: () => {
			member.reload()
			raiseToast(__('Removed from group.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const removeList = (listId: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_member_from_mailing_list',
		makeParams: () => ({ member_id: memberId, list_id: listId }),
		onSuccess: () => {
			member.reload()
			raiseToast(__('Removed from mailing list.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const badge = computed<{ label: string; theme: 'green' | 'gray' }>(() =>
	data.value?.enabled
		? { label: __('Enabled'), theme: 'green' }
		: { label: __('Disabled'), theme: 'gray' },
)

const formatDate = (value?: string | null) => formatDateTime(value)

const lastActive = computed(() => formatDate(data.value?.last_active) || __('Never'))
const joinedOn = computed(() => formatDate(data.value?.joined_on))

const BREADCRUMBS = computed(() => [
	{ label: __('Members'), route: '/mail/dashboard/members' },
	{ label: data.value?.name || memberId },
])

// Member actions reuse the bulk admin endpoints with a single-name list.

const setEnabled = (enabled: boolean) =>
	createResource({
		url: enabled
			? 'suite.mail.api.admin.enable_members'
			: 'suite.mail.api.admin.disable_members',
		makeParams: () => ({ names: [memberId] }),
		onSuccess: () => {
			showToggleEnabled.value = false
			member.reload()
			raiseToast(enabled ? __('Member enabled.') : __('Member disabled.'))
		},
		onError: (error: { messages?: string[] }) => {
			showToggleEnabled.value = false
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
		},
	}).submit()

const TOGGLE_ENABLED_OPTIONS = computed(() => {
	const enabling = !data.value?.enabled
	return {
		title: enabling ? __('Enable Member') : __('Disable Member'),
		message: enabling
			? __('Are you sure you want to enable this member? They will be able to log in again.')
			: __(
					'Are you sure you want to disable this member? They will no longer be able to log in.',
				),
		actions: [
			{ label: __('Confirm'), variant: 'solid', onClick: () => setEnabled(enabling) },
		],
	}
})

const resetPassword = createResource({
	url: 'suite.mail.api.account.send_reset_password_link',
	makeParams: () => ({ user: memberId }),
	onSuccess: (email: string) => {
		showResetPassword.value = false
		raiseToast(__('Reset password link sent to {0}.', [email]))
	},
	onError: (error: { messages?: string[] }) => {
		showResetPassword.value = false
		raiseToast(error.messages?.[0] || __('Failed to send reset password link.'), 'error')
	},
})

const RESET_PASSWORD_OPTIONS = {
	title: __('Reset Password'),
	message: __(
		'Send a password reset link to this member? The link will be emailed to their backup email address.',
	),
	actions: [{ label: __('Confirm'), variant: 'solid', onClick: () => resetPassword.submit() }],
}

const deleteMember = createResource({
	url: 'suite.mail.api.admin.delete_members',
	makeParams: () => ({ names: [memberId] }),
	onSuccess: () => {
		showDeleteMember.value = false
		raiseToast(__('Member deleted.'))
		router.push({ name: 'mail-members' })
	},
	onError: (error: { messages?: string[] }) => {
		showDeleteMember.value = false
		raiseToast(error.messages?.[0] || __('Failed to delete member.'), 'error')
	},
})

const DELETE_MEMBER_OPTIONS = {
	title: __('Delete Member'),
	message: __('Are you sure you want to delete this member? This action cannot be undone.'),
	size: 'xl',
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [
		{
			label: __('Confirm'),
			variant: 'solid',
			theme: 'red',
			onClick: () => deleteMember.submit(),
		},
	],
}

const dropdownOptions = computed(() => [
	{
		group: '',
		options: [
			{
				label: __('Reset Password'),
				icon: 'lucide-mail',
				onClick: () => (showResetPassword.value = true),
			},
			{
				label: __('Change Password'),
				icon: 'lucide-key',
				onClick: () => (showChangePassword.value = true),
			},
		],
	},
	{
		group: '',
		options: [
			data.value?.enabled
				? {
						label: __('Disable'),
						icon: 'lucide-user-x',
						onClick: () => (showToggleEnabled.value = true),
					}
				: {
						label: __('Enable'),
						icon: 'lucide-user-check',
						onClick: () => (showToggleEnabled.value = true),
					},
			{
				label: __('Delete'),
				icon: 'lucide-trash-2',
				onClick: () => (showDeleteMember.value = true),
			},
		],
	},
])
</script>
