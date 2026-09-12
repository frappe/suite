<template>
	<component
		:is="isMobile ? SearchMobileLayout : Dialog"
		v-model="show"
		v-model:open="show"
		v-bind="{ size: '2xl', paddingTop: '2%' }"
		:bare="!isMobile"
	>
		<div class="bg-surface-base">
			<div class="flex items-center border-b px-4 py-2">
				<button
					v-if="isMobile"
					type="button"
					class="-m-2 shrink-0 p-2"
					:aria-label="__('Back')"
					@click="closeSearch"
				>
					<ArrowLeft class="text-ink-gray-5 size-4" />
				</button>
				<Search v-else class="text-ink-gray-5 size-4 shrink-0" />
				<input
					ref="searchInput"
					v-model="filter.text"
					type="text"
					class="placeholder-ink-gray-4 w-full border-none bg-transparent px-0 py-3 text-base focus:ring-0"
					:placeholder="__('Search')"
					@keydown.enter="openSearchPage"
				/>
			</div>

			<div class="space-y-4 p-4">
				<Switch
					v-if="hasMultipleAccounts"
					v-model="allAccounts"
					:label="__('Search across all accounts')"
					:description="
						__(
							'Look through every account you own — slower, but finds a mail wherever it landed.',
						)
					"
					class="!p-0"
				/>
				<FormControl
					v-if="!allAccounts"
					v-model="filter.inMailbox"
					type="select"
					:label="__('Look In')"
					:options="mailboxOptions"
				/>
				<FormControl v-model="filter.subject" :label="__('Subject')" />
				<ContactCombobox v-model="filter.from" :label="__('From')" />
				<ContactCombobox v-model="filter.to" :label="__('To')" />
				<ContactCombobox v-model="filter.cc" :label="__('Cc')" />
				<ContactCombobox v-model="filter.bcc" :label="__('Bcc')" />
				<div class="flex space-x-4">
					<FormControl
						v-model="filter.after"
						type="date"
						:label="__('From Date')"
						class="w-full"
					/>
					<FormControl
						v-model="filter.before"
						type="date"
						:label="__('To Date')"
						class="w-full"
					/>
				</div>
				<div class="flex space-x-4">
					<FormControl
						v-model="filter.hasAttachment"
						type="select"
						:label="__('Attachments')"
						:options="getAttachmentOptions()"
						class="w-full min-w-0"
					/>
					<FormControl
						v-model="filter.isRead"
						type="select"
						:label="__('Read Status')"
						:options="getReadStatusOptions()"
						class="w-full min-w-0"
					/>
				</div>
			</div>

			<div class="flex w-full justify-end space-x-4 p-4">
				<Button
					:label="__('Clear Filters')"
					class="w-28"
					@click="clearFilters"
				/>
				<Button
					:label="__('Search')"
					variant="solid"
					class="w-28"
					@click="openSearchPage"
				/>
			</div>
		</div>
	</component>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Search } from 'lucide-vue-next'
import { Button, Dialog, FormControl, Switch } from 'frappe-ui'

import {
	getAttachmentOptions,
	getReadStatusOptions,
} from '@/apps/mail/constants'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import SearchMobileLayout from '@/apps/mail/components/SearchMobileLayout.vue'
import ContactCombobox from '@/apps/mail/components/Controls/ContactCombobox.vue'

const show = defineModel<boolean>()
const initialText = defineModel<string>('initialText', { default: '' })
const initialFilters = defineModel<Record<string, string>>('initialFilters', {
	default: {},
})

const store = userStore()
const { mailboxes } = store
const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const searchInput = useTemplateRef('searchInput')

const filterKeys = [
	'text',
	'inMailbox',
	'subject',
	'from',
	'to',
	'cc',
	'bcc',
	'after',
	'before',
	'hasAttachment',
	'isRead',
]

const getDefaultFilter = (reset = false) =>
	Object.fromEntries(
		filterKeys.map((key) => [
			key,
			reset
				? ''
				: key === 'text'
					? initialText.value || route.query[key] || ''
					: route.query[key] || '',
		]),
	)

const filter = reactive<Record<string, string>>({ ...getDefaultFilter() })
const clearFilters = () =>
	Object.assign(filter, getDefaultFilter(true), { text: filter.text })
const filteredFilter = computed(() =>
	Object.fromEntries(
		Object.entries(filter)
			.map(([key, value]) => [key, value.trim()])
			.filter(([, value]) => Boolean(value)),
	),
)

const ALL_ACCOUNTS_STORAGE_KEY = 'mail-search-all-accounts'
const hasMultipleAccounts = computed(
	() => (store.userResource.data?.accounts?.length ?? 0) > 1,
)
const allAccounts = ref(
	hasMultipleAccounts.value &&
		(route.query.all_accounts != null ||
			localStorage.getItem(ALL_ACCOUNTS_STORAGE_KEY) === 'true'),
)

watch(allAccounts, (value) => {
	localStorage.setItem(ALL_ACCOUNTS_STORAGE_KEY, String(value))
	if (value) filter.inMailbox = ''
})

watch(show, (open) => {
	if (!open) return
	Object.assign(filter, getDefaultFilter(), initialFilters.value)
	initialText.value = ''
	initialFilters.value = {}
	nextTick(() => searchInput.value?.focus())
})

const mailboxOptions = computed(() =>
	[{ label: __('All folders'), value: '' }].concat(
		mailboxes.data.map((mailbox: { id: string; _name: string }) => ({
			label: mailbox._name,
			value: mailbox.id,
		})),
	),
)

const closeSearch = () => history.back()

const openSearchPage = async () => {
	const location = {
		name: 'mail-mailbox',
		params: { accountId: store.accountId, mailbox: 'search' },
		query: {
			...filteredFilter.value,
			...(allAccounts.value ? { all_accounts: '1' } : {}),
		},
	}
	if (isMobile.value) {
		await new Promise<void>((resolve) => {
			window.addEventListener('popstate', () => resolve(), { once: true })
			history.back()
		})
		await router.replace(location)
		return
	}
	await router.push(location)
	show.value = false
}
</script>
