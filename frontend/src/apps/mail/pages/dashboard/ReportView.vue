<template>
	<DashboardLayout :breadcrumbs="breadcrumbs" :loading="!report.data">
		<template #default>
			<DashboardDetailHeader :title="detailTitle" :meta="[data.domain || data.from, reportId]">
				<template #icon><FileChartColumn class="h-5 w-5" /></template>
				<template #actions>
					<Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
				</template>
			</DashboardDetailHeader>

			<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
				<DashboardCard :title="__('Report')">
					<template v-if="direction === 'inbound'">
						<InformationField :label="__('From')" :value="data.from" />
						<InformationField :label="__('Subject')" :value="data.subject" />
						<InformationField :label="__('To')" :value="recipients" />
						<InformationField :label="__('Received At')" :value="formatDate(data.received_at)" />
						<InformationField :label="__('Expires At')" :value="formatDate(data.expires_at)" />
					</template>
					<template v-else>
						<InformationField :label="__('Domain')" :value="data.domain" />
						<template v-if="kind === 'dmarc'">
							<InformationField :label="__('Report Recipients')" :value="reportRecipients" />
							<InformationField :label="__('Policy Identifier')" :value="data.policy_identifier" />
						</template>
						<InformationField :label="__('Created At')" :value="formatDate(data.created_at)" />
						<InformationField :label="__('Deliver At')" :value="formatDate(data.deliver_at)" />
					</template>
				</DashboardCard>

				<DashboardCard :title="__('Details')">
					<template #actions>
						<Button variant="ghost" :label="__('Copy')" @click="copyToClipBoard(reportJson)" />
					</template>
					<pre
						class="bg-surface-gray-2 max-h-[60vh] overflow-auto rounded-4 p-4 text-xs whitespace-pre-wrap"
						>{{ reportJson }}</pre
					>
				</DashboardCard>
			</div>
		</template>
	</DashboardLayout>
	<Dialog v-model:open="showDelete" v-bind="deleteOptions" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Dialog, Dropdown, createResource, usePageMeta } from 'frappe-ui'

import FileChartColumn from '~icons/lucide/file-chart-column'

import { copyToClipBoard, raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import InformationField from '@/apps/mail/components/InformationField.vue'

type ReportData = {
	id: string
	from?: string
	subject?: string
	to?: string[]
	received_at?: string
	expires_at?: string
	domain?: string
	rua?: string[]
	policy_identifier?: string
	created_at?: string
	deliver_at?: string
	report?: unknown
}

const { kind, direction, reportId } = defineProps<{ kind: string; direction: string; reportId: string }>()
const router = useRouter()

const KIND_LABELS: Record<string, string> = { dmarc: 'DMARC', tls: 'TLS', arf: 'ARF' }
const listRouteName = computed(() => `mail-reports-${kind}-${direction}`)
const listTitle = computed(() => {
	const dir = direction === 'inbound' ? __('Inbound') : __('Outbound')
	return `${dir} ${KIND_LABELS[kind] || kind} ${__('Reports')}`
})
const detailTitle = computed(() => {
	const dir = direction === 'inbound' ? __('Inbound') : __('Outbound')
	return `${dir} ${KIND_LABELS[kind] || kind} ${__('Report')}`
})

usePageMeta(() => ({ title: listTitle.value }))

const showDelete = ref(false)

const report = createResource({
	url: 'suite.mail.api.admin.get_report',
	auto: true,
	makeParams: () => ({ kind, direction, report_id: reportId }),
	cache: ['mailReport', kind, direction, reportId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Report not found.'), 'error')
		router.replace({ name: listRouteName.value })
	},
})

const data = computed(() => report.data as ReportData)
const reportJson = computed(() => JSON.stringify(data.value?.report ?? {}, null, 2))
const joinAddresses = (addresses?: string[]) => (addresses ?? []).join(', ')
const recipients = computed(() => joinAddresses(data.value?.to))
const reportRecipients = computed(() => joinAddresses(data.value?.rua))
const formatDate = (value?: string | null) => formatDateTime(value) || '—'

const breadcrumbs = computed(() => [
	{ label: listTitle.value, route: `/mail/dashboard/reports/${direction}/${kind}` },
	{ label: data.value?.domain || data.value?.subject || reportId },
])

const deleteReport = createResource({
	url: 'suite.mail.api.admin.delete_reports',
	makeParams: () => ({ kind, direction, ids: [reportId] }),
	onSuccess: () => {
		showDelete.value = false
		raiseToast(__('Report deleted.'))
		router.push({ name: listRouteName.value })
	},
})

const deleteOptions = computed(() => ({
	title: __('Delete Report'),
	message: __('Delete this report? This cannot be undone.'),
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: deleteReport.submit }],
}))

const dropdownOptions = computed(() => [
	{ group: '', options: [{ label: __('Delete'), icon: 'lucide-trash-2', onClick: () => (showDelete.value = true) }] },
])
</script>
