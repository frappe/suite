<template>
	<DashboardLayout :breadcrumbs="BREADCRUMBS" :loading="!domain.data">
		<template #default>
			<DashboardDetailHeader
				:title="domain.data.name"
				:badge-label="badge.label"
				:badge-theme="badge.theme"
				:meta="[domain.data.description, addedAgo]"
			>
				<template #icon><Globe class="h-5 w-5" /></template>
				<template #actions>
					<Button
						:label="__('Verify DNS')"
						:loading="verifyDomain.loading"
						@click="verifyDomain.submit()"
					/>
					<Dropdown
						:options="exportOptions"
						:button="{ label: __('Export DNS'), iconLeft: 'lucide-download' }"
					/>
					<Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
				</template>
			</DashboardDetailHeader>
			<div class="bg-surface-blue-1 flex items-start gap-3 rounded-4 border p-4">
				<Info class="text-ink-blue-5 mt-0.5 h-4 w-4 shrink-0" />
				<div class="space-y-1">
					<h3 class="text-base font-medium">{{ BANNER.title }}</h3>
					<p class="text-ink-gray-5 text-sm">{{ BANNER.message }}</p>
					<p class="text-ink-gray-5 text-sm">{{ BANNER.subtitle }}</p>
				</div>
			</div>
			<div class="rounded-4 border">
				<h2 class="h-13 flex shrink-0 items-center px-4">{{ __('DNS Records') }}</h2>
				<DNSRecords
					v-for="group in recordGroups"
					:key="group.key"
					:title="group.label"
					:description="group.description"
					:records="recordsOf(group.key)"
					:badge-label="group.is_mandatory ? __('Required') : undefined"
					:badge-theme="group.is_mandatory ? 'red' : undefined"
				/>
			</div>
		</template>
	</DashboardLayout>
	<Dialog v-model:open="showConfirmDialog" v-bind="confirmDialogOptions" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { appPageMeta } from '@/utils/documentTitle'
import { useRouter } from 'vue-router'
import { Button, Dialog, Dropdown, createResource, usePageMeta } from 'frappe-ui'

import Globe from '~icons/lucide/globe'
import Info from '~icons/lucide/info'

import { downloadUrlAsFile, raiseToast } from '@/apps/mail/utils'
import { fromNow } from '@/apps/mail/utils/datetime'
import DNSRecords from '@/apps/mail/components/DNSRecords.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'

type DNSRecord = Record<string, string>
type RecordGroup = { key: string; label: string; description: string; is_mandatory: boolean }

type DomainData = {
	id: string
	name: string
	description: string
	is_enabled: boolean
	is_verified: boolean
	created_at: string
	dns_record_groups: RecordGroup[]
	dns_records: DNSRecord[]
}

type ResourceError = {
	messages?: string[]
	message?: string
}

const getErrorMessage = (error: ResourceError) =>
	error.messages?.[0] || error.message || __('Request failed.')

const { domainId } = defineProps<{ domainId: string }>()

usePageMeta(() => appPageMeta(domain.data?.name || domainId, 'Mail'))

const router = useRouter()

const showConfirmDialog = ref(false)

const domain = createResource({
	url: 'suite.mail.api.admin.get_domain',
	auto: true,
	makeParams: () => ({ domain_id: domainId }),
	cache: ['mailDomain', domainId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Domain not found.'), 'error')
		router.replace({ name: 'mail-domains' })
	},
})

const domainRecords = computed<DNSRecord[]>(
	() => (domain.data as DomainData | undefined)?.dns_records || [],
)

// Suite Cloud groups the records (authentication, routing, transport security, ...) and says
// which groups a domain needs before it goes live; the page renders whatever it sends.
const recordGroups = computed<RecordGroup[]>(
	() => (domain.data as DomainData | undefined)?.dns_record_groups || [],
)
const recordsOf = (group: string) => domainRecords.value.filter((record) => record.group === group)

const verifyDomain = createResource({
	url: 'suite.mail.api.admin.verify_domain',
	makeParams: () => ({ domain_id: domainId }),
	onSuccess: () => {
		domain.reload()
		raiseToast(__('DNS records checked.'))
	},
	onError: (error: ResourceError) => raiseToast(getErrorMessage(error), 'error'),
})

const deleteDomain = createResource({
	url: 'suite.mail.api.admin.delete_domain',
	makeParams: () => ({ domain_id: domainId }),
	onSuccess: () => {
		router.push({ name: 'mail-domains' })
		showConfirmDialog.value = false
		raiseToast('Domain deleted.')
	},
	onError: (error: ResourceError) => raiseToast(getErrorMessage(error), 'error'),
})

const downloadFile = (content: string, extension: string, mimeType: string) => {
	const domainName = (domain.data as DomainData | undefined)?.name || domainId
	const fileName = `${domainName.replace(/[^a-zA-Z0-9.-]+/g, '_')}.${extension}`
	const blob = new Blob([content], { type: mimeType })
	downloadUrlAsFile(URL.createObjectURL(blob), fileName)
}

const downloadDNSZone = createResource({
	url: 'suite.mail.api.admin.get_domain_dns_zone',
	makeParams: () => ({ domain_id: domainId }),
	onSuccess: (zone: string) => downloadFile(zone, 'zone', 'text/plain;charset=utf-8'),
	onError: (error: ResourceError) => raiseToast(getErrorMessage(error), 'error'),
})

const downloadDNSCsv = createResource({
	url: 'suite.mail.api.admin.get_domain_dns_csv',
	makeParams: () => ({ domain_id: domainId }),
	onSuccess: (csv: string) => downloadFile(csv, 'csv', 'text/csv;charset=utf-8'),
	onError: (error: ResourceError) => raiseToast(getErrorMessage(error), 'error'),
})

const downloadDNSJson = createResource({
	url: 'suite.mail.api.admin.get_domain_dns_json',
	makeParams: () => ({ domain_id: domainId }),
	onSuccess: (json: string) => downloadFile(json, 'json', 'application/json;charset=utf-8'),
	onError: (error: ResourceError) => raiseToast(getErrorMessage(error), 'error'),
})

const BREADCRUMBS = computed(() => [
	{ label: __('Domains'), route: '/mail/dashboard/domains' },
	{ label: domain.data?.name || domainId },
])

const confirmDialogAction = ref<'deleteDomain'>('deleteDomain')

// A domain goes live once its mandatory records resolve; until then it is pending.
const badge = computed<{ label: string; theme: 'green' | 'gray' | 'amber' }>(() => {
	const data = domain.data as DomainData | undefined
	if (data?.is_verified && data?.is_enabled) return { label: __('Active'), theme: 'green' }
	if (data?.is_verified) return { label: __('Disabled'), theme: 'gray' }
	return { label: __('Pending verification'), theme: 'amber' }
}
)

const confirmDialogOptions = computed(() => {
	const config = {
		deleteDomain: {
			title: __('Delete Domain'),
			message: __(
				'Are you sure you want to delete this domain? This action cannot be undone.',
			),
			action: deleteDomain.submit,
		},
	}[confirmDialogAction.value]

	return {
		title: config.title,
		message: config.message,
		size: 'xl',
		icon: { name: 'lucide-alert-triangle', theme: 'amber' },
		actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: config.action }],
	}
})

const addedAgo = computed(() => {
	const createdAt = (domain.data as DomainData | undefined)?.created_at
	return createdAt ? __('Added {0}', [fromNow(createdAt)]) : undefined
})

const exportOptions = [
	{
		group: '',
		options: [
			{ label: __('Zone File'), icon: 'lucide-file-text', onClick: downloadDNSZone.submit },
			{ label: __('CSV'), icon: 'lucide-file-text', onClick: downloadDNSCsv.submit },
			{ label: __('JSON'), icon: 'lucide-file-text', onClick: downloadDNSJson.submit },
		],
	},
]

const dropdownOptions = computed(() => [
	{
		group: '',
		options: [
			{
				label: __('Delete Domain'),
				icon: 'lucide-trash-2',
				onClick: () => {
					confirmDialogAction.value = 'deleteDomain'
					showConfirmDialog.value = true
				},
			},
		],
	},
])

const BANNER = {
	title: __('Set Up Your Domain'),
	message: __("Add the following records to your domain's DNS settings."),
	subtitle: __('DNS changes may take up to 48 hours to propagate globally.'),
}
</script>
