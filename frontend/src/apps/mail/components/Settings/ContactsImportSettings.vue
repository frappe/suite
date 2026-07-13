<template>
	<FormControl
		v-model="contactsImport.format"
		:label="__('Format')"
		type="select"
		variant="outline"
		:options="FORMAT_OPTIONS"
		required
	/>
	<FormControl
		v-model="contactsImport.address_book"
		:label="__('Address Book')"
		type="select"
		variant="outline"
		:options="addressBookOptions"
	/>
	<input
		ref="fileInput"
		type="file"
		class="hidden"
		:accept="acceptTypes"
		@change="onFileSelected"
	/>
	<Button
		class="w-full"
		:label="uploading ? __('Uploading ({0}%)', [progress]) : __('Upload File')"
		:loading="uploading"
		@click="fileInput?.click()"
	/>
	<p class="text-ink-gray-5 mt-2 flex text-sm">{{ fileUploadSubtitle }}</p>

	<Button
		class="min-h-7"
		:label="__('Create Import')"
		variant="solid"
		:loading="ongoingImport.data?.name"
		:disabled="ongoingImport.loading || ongoingImport.error || !contactsImport.file"
		@click="createContactsImport.submit()"
	/>
	<div class="!mt-3 space-x-1 text-base">
		<span class="text-ink-gray-5">{{ importSubtitle }}</span>
		<a class="hover:underline" :href="importHref" target="_blank">
			{{ importLinkText }}
		</a>
	</div>
	<ErrorMessage
		v-if="createContactsImport.error"
		:message="createContactsImport.error"
		class="mb-2.5"
	/>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref } from 'vue'
import { Button, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { useChunkedUpload } from '@/apps/mail/utils/useChunkedUpload'
import { userStore } from '@/apps/mail/stores/user'

const { accountId } = userStore()

const user = inject('$user')
const socket = inject('$socket')

const contactsImport = reactive({
	format: 'vcf',
	file: '',
	address_book: '',
})

const fileInput = ref<HTMLInputElement | null>(null)
const { uploading, progress, upload } = useChunkedUpload()

const acceptTypes = computed(() =>
	contactsImport.format === 'vcf' ? '.vcf' : '.zip,.tgz,.tar.gz',
)

// Upload in chunks so large import archives aren't blocked by the web server's request-size limit.
const onFileSelected = async (event: Event) => {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = '' // let the same file be re-selected after an error
	if (!file) return

	try {
		const uploaded = await upload(file, { private: true })
		contactsImport.file = uploaded.file_url
	} catch (error) {
		raiseToast((error as Error).message, 'error')
	}
}

const addressBooks = createResource({
	url: 'suite.mail.doctype.address_book.address_book.fetch_address_books',
	auto: true,
	makeParams: () => ({ account: accountId, limit: 100 }),
	onSuccess: (data: { id: string }[]) => {
		if (!contactsImport.address_book && data?.length) contactsImport.address_book = data[0].id
	},
})

const addressBookOptions = computed(() =>
	(addressBooks.data || []).map((b: { id: string; _name: string }) => ({
		label: b._name,
		value: b.id,
	})),
)

const fileUploadSubtitle = computed(() => {
	if (contactsImport.file) return __('File uploaded: {0}', [contactsImport.file])
	if (contactsImport.format === 'vcf') return __('Supported file format: .vcf')
	return __('Supported file formats: .zip, .tar, .tgz')
})

const createContactsImport = createResource({
	url: 'suite.mail.api.account.create_contacts_import',
	makeParams: () => ({ account: accountId, ...contactsImport }),
	onSuccess: () => ongoingImport.reload(),
})

const ongoingImport = createResource({
	url: 'frappe.client.get_value',
	auto: true,
	makeParams: () => ({
		doctype: 'Contacts Exchange',
		fieldname: 'name',
		filters: {
			user: user.data.name,
			account: accountId,
			operation: 'Import',
			status: ['in', ['Queued', 'In Progress']],
		},
	}),
})

onMounted(() =>
	socket.on('contacts_exchange_completed', (payload: { action: 'Import' | 'Export' }) => {
		if (payload.action === 'Import') ongoingImport.reload()
	}),
)

const importSubtitle = computed(() => {
	if (ongoingImport.data?.name) return __("Import in progress. We'll email you when it's ready.")
	return __('No imports in progress.')
})

const importHref = computed(() => {
	if (ongoingImport.data?.name) return `/mail/contacts-exchanges/${ongoingImport.data.name}`
	return '/mail/contacts-exchanges?operation=Import'
})

const importLinkText = computed(() => {
	if (ongoingImport.data?.name) return __('Track status')
	return __('View history')
})

const FORMAT_OPTIONS = ['vcf', 'jmap']
</script>
