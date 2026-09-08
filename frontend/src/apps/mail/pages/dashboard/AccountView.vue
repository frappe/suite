<template>
	<DashboardLayout :breadcrumbs="BREADCRUMBS" :loading="!account.data">
		<DashboardDetailHeader
			:title="account.data.description || account.data.name"
			:badge-label="badge.label"
			:badge-theme="badge.theme"
			:meta="[account.data.name, account.data.is_admin ? __('Admin') : __('User')]"
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
						:value="account.data.is_admin ? __('Admin') : __('User')"
					/>
					<InformationField :label="__('Locale')" :value="localeLabel(account.data.locale)" />
					<InformationField :label="__('Time Zone')" :value="account.data.time_zone" />
					<InformationField :label="__('Last Active')" :value="lastActive" />
					<InformationField :label="__('Joined On')" :value="joinedOn" />
				</div>
			</DashboardCard>

			<!-- Quota Usage -->
			<DashboardCard :title="__('Quota Usage')" :button-label="__('Edit')" @action="showEditQuota = true">
				<QuotaDonut :quota="account.data.quota" />
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
					<template v-if="account.data.email_addresses.length">
						<div
							v-for="entry in account.data.email_addresses"
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
					<template v-if="account.data.groups.length">
						<div
							v-for="group in account.data.groups"
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
					<template v-if="account.data.mailing_lists.length">
						<div
							v-for="list in account.data.mailing_lists"
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
	<ChangeAccountPasswordModal v-model="showChangePassword" :account-id="accountId" />
	<EditAccountModal v-if="data" v-model="showEdit" :account="data" @reload="account.reload()" />
	<EditAccountQuotaModal v-if="data" v-model="showEditQuota" :account="data" @reload="account.reload()" />
	<AddAccountEmailModal v-model="showAddEmail" :account-id="accountId" @reload="account.reload()" />
	<AddAccountGroupsModal
		v-model="showAddGroups"
		:account-id="accountId"
		:current-ids="currentGroupIds"
		@reload="account.reload()"
	/>
	<AddAccountMailingListsModal
		v-model="showAddLists"
		:account-id="accountId"
		:current-ids="currentListIds"
		@reload="account.reload()"
	/>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { appPageMeta } from '@/utils/documentTitle'
import { useRouter } from 'vue-router'
import {
	Button, Dialog, Dropdown, Switch, Tooltip, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import { useAccountOptions } from '@/apps/mail/composables/useAccountOptions'
import AddAccountEmailModal from '@/apps/mail/components/Modals/AddAccountEmailModal.vue'
import AddAccountGroupsModal from '@/apps/mail/components/Modals/AddAccountGroupsModal.vue'
import AddAccountMailingListsModal from '@/apps/mail/components/Modals/AddAccountMailingListsModal.vue'
import ChangeAccountPasswordModal from '@/apps/mail/components/Modals/ChangeAccountPasswordModal.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import EditAccountModal from '@/apps/mail/components/Modals/EditAccountModal.vue'
import EditAccountQuotaModal from '@/apps/mail/components/Modals/EditAccountQuotaModal.vue'
import InformationField from '@/apps/mail/components/InformationField.vue'
import QuotaDonut from '@/apps/mail/components/QuotaDonut.vue'

import type { QuotaUsage } from '@/apps/mail/types'

type AccountData = {
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

const { accountId } = defineProps<{ accountId: string }>()

const router = useRouter()
const { localeLabel } = useAccountOptions()

usePageMeta(() => appPageMeta(accountId, 'Mail'))

const showDeleteMember = ref(false)
const showResetPassword = ref(false)
const showChangePassword = ref(false)
const showToggleEnabled = ref(false)
const showEdit = ref(false)
const showEditQuota = ref(false)
const showAddEmail = ref(false)
const showAddGroups = ref(false)
const showAddLists = ref(false)

const account = createResource({
	url: 'suite.mail.api.admin.get_account',
	auto: true,
	makeParams: () => ({ account_id: accountId }),
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Account not found.'), 'error')
		router.replace({ name: 'mail-accounts' })
	},
})

const data = computed(() => account.data as AccountData | undefined)

const currentGroupIds = computed(() => data.value?.groups.map((g) => g.id) || [])
const currentListIds = computed(() => data.value?.mailing_lists.map((l) => l.id) || [])

const toggleEmailEnabled = (entry: { email: string; enabled: boolean }, value: boolean) => {
	entry.enabled = value // optimistic; reverted on error via reload
	createResource({
		url: 'suite.mail.api.admin.set_account_email_enabled',
		makeParams: () => ({ account_id: accountId, email: entry.email, enabled: value ? 1 : 0 }),
		onSuccess: () => raiseToast(value ? __('Email address enabled.') : __('Email address disabled.')),
		onError: (error: { messages?: string[] }) => {
			account.reload()
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
		},
	}).submit()
}

const removeEmail = (email: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_account_email',
		makeParams: () => ({ account_id: accountId, email }),
		onSuccess: () => {
			account.reload()
			raiseToast(__('Email address removed.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const removeGroup = (groupId: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_account_from_group',
		makeParams: () => ({ account_id: accountId, group_id: groupId }),
		onSuccess: () => {
			account.reload()
			raiseToast(__('Removed from group.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const removeList = (listId: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_account_from_mailing_list',
		makeParams: () => ({ account_id: accountId, list_id: listId }),
		onSuccess: () => {
			account.reload()
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
	{ label: __('Accounts'), route: '/mail/dashboard/accounts' },
	{ label: data.value?.name || accountId },
])

// Account actions reuse the bulk admin endpoints with a single-name list.

const setEnabled = (enabled: boolean) =>
	createResource({
		url: enabled
			? 'suite.mail.api.admin.enable_accounts'
			: 'suite.mail.api.admin.disable_accounts',
		makeParams: () => ({ names: [accountId] }),
		onSuccess: () => {
			showToggleEnabled.value = false
			account.reload()
			raiseToast(enabled ? __('Account enabled.') : __('Account disabled.'))
		},
		onError: (error: { messages?: string[] }) => {
			showToggleEnabled.value = false
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
		},
	}).submit()

const TOGGLE_ENABLED_OPTIONS = computed(() => {
	const enabling = !data.value?.enabled
	return {
		title: enabling ? __('Enable Account') : __('Disable Account'),
		message: enabling
			? __('Are you sure you want to enable this account? They will be able to log in again.')
			: __(
					'Are you sure you want to disable this account? They will no longer be able to log in.',
				),
		actions: [
			{ label: __('Confirm'), variant: 'solid', onClick: () => setEnabled(enabling) },
		],
	}
})

const resetPassword = createResource({
	url: 'suite.mail.api.account.send_reset_password_link',
	makeParams: () => ({ user: accountId }),
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
		'Send a password reset link to this account? The link will be emailed to their backup email address.',
	),
	actions: [{ label: __('Confirm'), variant: 'solid', onClick: () => resetPassword.submit() }],
}

const deleteMember = createResource({
	url: 'suite.mail.api.admin.delete_accounts',
	makeParams: () => ({ names: [accountId] }),
	onSuccess: () => {
		showDeleteMember.value = false
		raiseToast(__('Account deleted.'))
		router.push({ name: 'mail-accounts' })
	},
	onError: (error: { messages?: string[] }) => {
		showDeleteMember.value = false
		raiseToast(error.messages?.[0] || __('Failed to delete account.'), 'error')
	},
})

const DELETE_MEMBER_OPTIONS = {
	title: __('Delete Account'),
	message: __('Are you sure you want to delete this account? This action cannot be undone.'),
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
