<template>
	<DashboardLayout :breadcrumbs="breadcrumbs" :loading="!list.data">
		<DashboardDetailHeader
			:title="list.data.email || list.data.name || listId"
			:meta="[list.data.description, recipientCountLabel]"
		>
			<template #icon><Megaphone class="h-5 w-5" /></template>
			<template #actions>
				<Button :label="__('Edit')" @click="showEdit = true" />
				<Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
			</template>
		</DashboardDetailHeader>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			<!-- Email Addresses -->
			<DashboardCard :title="__('Email Addresses')" :button-label="__('Add')" @action="showAddEmail = true">
				<div class="flex flex-col">
					<div class="bg-surface-gray-2 text-ink-gray-5 flex items-center rounded-4 px-5 py-2.5 text-sm">
						<span class="flex-1">{{ __('Email Address') }}</span>
						<span class="flex-1">{{ __('Description') }}</span>
						<span class="w-20 shrink-0 text-center">{{ __('Enabled') }}</span>
						<span class="w-8 shrink-0" />
					</div>
					<template v-if="list.data.email_addresses.length">
						<div
							v-for="entry in list.data.email_addresses"
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

			<!-- Recipients -->
			<DashboardCard
				:title="__('Recipients')"
				:button-label="__('Add')"
				@action="showAddRecipients = true"
			>
				<div class="flex flex-col">
					<div class="px-5 py-2.5">
						<FormControl v-model="recipientSearch" :placeholder="__('Search by email')">
							<template #prefix>
								<FeatherIcon name="search" class="text-ink-gray-5 w-4" />
							</template>
						</FormControl>
					</div>
					<template v-if="filteredRecipients.length">
						<div
							v-for="recipient in filteredRecipients"
							:key="recipient"
							class="group flex items-center border-b px-5 py-3 text-base last:border-b-0"
						>
							<span class="flex-1 truncate">{{ recipient }}</span>
							<Button
								variant="ghost"
								theme="red"
								class="invisible group-hover:visible"
								@click="removeRecipient(recipient)"
							>
								<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
							</Button>
						</div>
					</template>
					<div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">
						{{ __('No recipients found.') }}
					</div>
				</div>
			</DashboardCard>
		</div>
	</DashboardLayout>
	<EditMailingListModal v-if="list.data" v-model="showEdit" :list="list.data" @reload="list.reload()" />
	<AddMailingListEmailModal v-model="showAddEmail" :list-id="listId" @reload="list.reload()" />
	<AddMailingListRecipientsModal v-model="showAddRecipients" :list-id="listId" @reload="list.reload()" />
	<Dialog v-model:open="showDelete" v-bind="deleteDialogOptions" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
	Button, Dialog, Dropdown, FormControl, Switch, Tooltip, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import Megaphone from '~icons/lucide/megaphone'

import { raiseToast } from '@/apps/mail/utils'
import AddMailingListEmailModal from '@/apps/mail/components/Modals/AddMailingListEmailModal.vue'
import AddMailingListRecipientsModal from '@/apps/mail/components/Modals/AddMailingListRecipientsModal.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import EditMailingListModal from '@/apps/mail/components/Modals/EditMailingListModal.vue'

type ListData = {
	id: string
	name: string
	email: string
	description?: string
	email_addresses: { email: string; description?: string; is_primary: boolean; enabled: boolean }[]
	recipients: string[]
}

const { listId } = defineProps<{ listId: string }>()

const router = useRouter()

usePageMeta(() => ({ title: (list.data as ListData | undefined)?.email || listId }))

const showEdit = ref(false)
const showAddEmail = ref(false)
const showAddRecipients = ref(false)
const showDelete = ref(false)
const recipientSearch = ref('')

const list = createResource({
	url: 'suite.mail.api.admin.get_mailing_list',
	auto: true,
	makeParams: () => ({ list_id: listId }),
	cache: ['mailMailingList', listId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Mailing list not found.'), 'error')
		router.replace({ name: 'mail-mailing-lists' })
	},
})

const data = computed(() => list.data as ListData | undefined)

const filteredRecipients = computed(() => {
	const recipients = data.value?.recipients || []
	const q = recipientSearch.value.trim().toLowerCase()
	return q ? recipients.filter((r) => r.toLowerCase().includes(q)) : recipients
})

const recipientCountLabel = computed(() => {
	const count = data.value?.recipients.length ?? 0
	return count === 1 ? __('1 recipient') : __('{0} recipients', [String(count)])
})

const breadcrumbs = computed(() => [
	{ label: __('Mailing Lists'), route: '/mail/dashboard/mailing-lists' },
	{ label: data.value?.email || listId },
])

const toggleEmailEnabled = (entry: { email: string; enabled: boolean }, value: boolean) => {
	entry.enabled = value // optimistic; reverted on error via reload
	createResource({
		url: 'suite.mail.api.admin.set_mailing_list_email_enabled',
		makeParams: () => ({ list_id: listId, email: entry.email, enabled: value ? 1 : 0 }),
		onSuccess: () => raiseToast(value ? __('Email address enabled.') : __('Email address disabled.')),
		onError: (error: { messages?: string[] }) => {
			list.reload()
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
		},
	}).submit()
}

const removeEmail = (email: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_mailing_list_email',
		makeParams: () => ({ list_id: listId, email }),
		onSuccess: () => {
			list.reload()
			raiseToast(__('Email address removed.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const removeRecipient = (email: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_mailing_list_recipient',
		makeParams: () => ({ list_id: listId, email }),
		onSuccess: () => {
			list.reload()
			raiseToast(__('Recipient removed.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const deleteList = createResource({
	url: 'suite.mail.api.admin.delete_mailing_lists',
	makeParams: () => ({ ids: [listId] }),
	onSuccess: () => {
		showDelete.value = false
		raiseToast(__('Mailing list deleted.'))
		router.push({ name: 'mail-mailing-lists' })
	},
})

const deleteDialogOptions = computed(() => ({
	title: __('Delete Mailing List'),
	message: __('Are you sure you want to delete this mailing list? This action cannot be undone.'),
	size: 'xl',
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: deleteList.submit }],
}))

const dropdownOptions = computed(() => [
	{
		group: '',
		options: [{ label: __('Delete'), icon: 'lucide-trash-2', onClick: () => (showDelete.value = true) }],
	},
])
</script>
