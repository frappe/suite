<template>
	<FormControl
		v-model="contactsExport.format"
		:label="__('Format')"
		type="select"
		variant="outline"
		:options="FORMAT_OPTIONS"
	/>
	<FormControl
		v-model="contactsExport.archive_type"
		:label="__('Archive Type')"
		type="select"
		variant="outline"
		:options="ARCHIVE_TYPE_OPTIONS"
	/>
	<Switch
		v-model="customSelection"
		:label="__('Custom Selection')"
		:description="__('Apply filters to select specific contacts for export.')"
		class="hover:!bg-surface-base !cursor-default !p-0"
	/>
	<template v-if="customSelection">
		<FormControl
			v-model="filter.inAddressBook"
			:label="__('Address Book')"
			type="select"
			variant="outline"
			:options="addressBookOptions"
		/>
		<FormControl v-model="filter.name" type="text" variant="outline" :label="__('Name')" />
		<FormControl v-model="filter.email" type="text" variant="outline" :label="__('Email')" />
		<FormControl
			v-model="contactsExport.limit"
			:label="__('Max Number of Contacts')"
			type="number"
			variant="outline"
			placeholder="1000"
		/>
	</template>

	<Button
		class="min-h-7"
		:label="__('Create Export')"
		:loading="ongoingExport.data?.name"
		:disabled="ongoingExport.loading || ongoingExport.error || createContactsExport.loading"
		@click="createContactsExport.submit()"
	/>
	<div class="!mt-3 space-x-1 text-base">
		<span class="text-ink-gray-5">{{ exportSubtitle }}</span>
		<a class="hover:underline" :href="exportHref" target="_blank">
			{{ exportLinkText }}
		</a>
	</div>
	<ErrorMessage
		v-if="createContactsExport.error"
		:message="createContactsExport.error"
		class="mb-2.5"
	/>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref } from 'vue'
import { Button, ErrorMessage, FormControl, Switch, createResource } from 'frappe-ui'

import { userStore } from '@/apps/mail/stores/user'

const { accountId } = userStore()

const user = inject('$user')
const socket = inject('$socket')

const contactsExport = reactive({
	format: 'jmap',
	archive_type: '.zip',
	limit: undefined,
})

const customSelection = ref(false)

const filter = reactive({
	inAddressBook: '',
	name: '',
	email: '',
})

const addressBooks = createResource({
	url: 'suite.mail.doctype.address_book.address_book.fetch_address_books',
	auto: true,
	makeParams: () => ({ account: accountId, limit: 100 }),
})

const addressBookOptions = computed(() =>
	[{ label: __(''), value: ' ' }].concat(
		(addressBooks.data || []).map((b: { id: string; _name: string }) => ({
			label: b._name,
			value: b.id,
		})),
	),
)

const createContactsExport = createResource({
	url: 'suite.mail.api.account.create_contacts_export',
	makeParams: () => {
		const cleanedFilter = Object.fromEntries(
			Object.entries(filter)
				.map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
				.filter(([, v]) => Boolean(v)),
		)
		return { account: accountId, ...contactsExport, filter: cleanedFilter }
	},
	onSuccess: () => ongoingExport.reload(),
})

const ongoingExport = createResource({
	url: 'frappe.client.get_value',
	auto: true,
	makeParams: () => ({
		doctype: 'Contacts Exchange',
		fieldname: 'name',
		filters: {
			user: user.data.name,
			operation: 'Export',
			status: ['in', ['Queued', 'In Progress']],
		},
	}),
})

onMounted(() =>
	socket.on('contacts_exchange_completed', (payload: { action: 'Import' | 'Export' }) => {
		if (payload.action === 'Export') ongoingExport.reload()
	}),
)

const exportSubtitle = computed(() => {
	if (ongoingExport.data?.name) return __("Export in progress. We'll email you when it's ready.")
	return __('No exports in progress.')
})

const exportHref = computed(() => {
	if (ongoingExport.data?.name) return `/mail/contacts-exchanges/${ongoingExport.data.name}`
	return '/mail/contacts-exchanges?operation=Export'
})

const exportLinkText = computed(() => {
	if (ongoingExport.data?.name) return __('Track status')
	return __('View history')
})

const FORMAT_OPTIONS = ['jmap', 'vcf']
const ARCHIVE_TYPE_OPTIONS = ['.zip', '.tgz', '.tar.gz']
</script>
