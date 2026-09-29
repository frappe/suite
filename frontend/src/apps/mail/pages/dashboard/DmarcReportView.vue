<template>
	<DashboardLayout :breadcrumbs="BREADCRUMBS" :loading="!report.data">
		<template #default>
			<DashboardDetailHeader
				:title="report.data.domain"
				:badge-label="__('{0} passed', [formatRate(report.data.pass_rate)])"
				:badge-theme="rateTheme(report.data.pass_rate)"
				:meta="metaItems"
			>
				<template #icon><ShieldCheck class="h-5 w-5" /></template>
			</DashboardDetailHeader>

			<DmarcStatTiles :totals="report.data" />

			<!-- The reporter's own remarks come first: they explain a report that looks wrong. -->
			<div v-if="report.data.errors" class="bg-surface-amber-1 flex items-start gap-3 rounded-4 border p-4">
				<Info class="text-ink-amber-6 mt-0.5 h-4 w-4 shrink-0" />
				<div class="space-y-1">
					<h3 class="text-base font-medium">{{ __('Reporter remarks') }}</h3>
					<p class="text-ink-gray-5 whitespace-pre-line text-sm">{{ report.data.errors }}</p>
				</div>
			</div>

			<div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
				<DashboardCard :title="__('Sources')" class="lg:col-span-2">
					<div v-if="report.data.records.length" class="flex flex-col">
						<div
							v-for="(record, index) in report.data.records"
							:key="index"
							class="flex flex-col gap-2 border-b px-5 py-3 text-sm last:border-b-0"
						>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
								<span class="min-w-0 flex-1 truncate font-medium">{{ record.source_ip }}</span>
								<span class="text-ink-gray-5 tabular-nums">{{ __('{0} msgs', [record.count.toLocaleString()]) }}</span>
								<Badge :label="__('DKIM: {0}', [resultBadge(record.dkim).label])" :theme="resultBadge(record.dkim).theme" />
								<Badge :label="__('SPF: {0}', [resultBadge(record.spf).label])" :theme="resultBadge(record.spf).theme" />
								<Badge v-bind="dispositionBadge(record.disposition)" />
							</div>
							<div class="text-ink-gray-5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
								<span v-if="record.header_from">{{ __('From: {0}', [record.header_from]) }}</span>
								<span v-if="record.envelope_from">{{ __('Envelope from: {0}', [record.envelope_from]) }}</span>
								<span v-for="(result, i) in record.dkim_results" :key="`dkim-${i}`">
									{{ __('DKIM {0} ({1}): {2}', [result.domain || '—', result.selector || '—', result.result || '—']) }}
								</span>
								<span v-for="(result, i) in record.spf_results" :key="`spf-${i}`">
									{{ __('SPF {0}: {1}', [result.domain || '—', result.result || '—']) }}
								</span>
								<span v-if="record.override_reasons" class="whitespace-pre-line">
									{{ __('Override: {0}', [record.override_reasons]) }}
								</span>
							</div>
						</div>
					</div>
					<div v-else class="text-ink-gray-5 px-5 py-4 text-sm">{{ __('The reporter listed no sources.') }}</div>
				</DashboardCard>

				<div class="flex flex-col gap-5">
					<!-- The DMARC record as the reporter read it, so a stale policy is visible here. -->
					<DashboardCard :title="__('Policy Applied')">
						<div class="flex flex-col">
							<div
								v-for="row in policyRows"
								:key="row.label"
								class="flex h-12 items-center gap-3 border-b px-5 text-sm last:border-b-0"
							>
								<span class="text-ink-gray-5 w-32 shrink-0">{{ row.label }}</span>
								<span class="truncate font-medium">{{ row.value || '—' }}</span>
							</div>
						</div>
					</DashboardCard>
					<DashboardCard :title="__('Report')">
						<div class="flex flex-col">
							<div
								v-for="row in reportRows"
								:key="row.label"
								class="flex min-h-12 items-center gap-3 border-b px-5 py-2 text-sm last:border-b-0"
							>
								<span class="text-ink-gray-5 w-32 shrink-0">{{ row.label }}</span>
								<span class="min-w-0 break-all font-medium">{{ row.value || '—' }}</span>
							</div>
						</div>
					</DashboardCard>
				</div>
			</div>
		</template>
	</DashboardLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { appPageMeta } from '@/utils/documentTitle'
import { useRouter } from 'vue-router'
import { Badge, createResource, usePageMeta } from 'frappe-ui'

import Info from '~icons/lucide/info'
import ShieldCheck from '~icons/lucide/shield-check'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import { type DmarcRecord, type DmarcReportRow, dispositionBadge, resultBadge } from '@/apps/mail/utils/dmarc'
import { formatRate, rateTheme } from '@/apps/mail/utils/reports'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DmarcStatTiles from '@/apps/mail/components/DmarcStatTiles.vue'

type ReportData = DmarcReportRow & { records: DmarcRecord[] }

const { reportId } = defineProps<{ reportId: string }>()

const router = useRouter()

const report = createResource({
	url: 'suite.mail.api.admin.get_dmarc_report',
	auto: true,
	makeParams: () => ({ report_id: reportId }),
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Report not found.'), 'error')
		router.replace({ name: 'mail-dmarc-reports' })
	},
})

const data = computed(() => report.data as ReportData | undefined)

usePageMeta(() => appPageMeta(data.value ? __('DMARC report for {0}', [data.value.domain]) : __('DMARC Report'), 'Mail'))

const BREADCRUMBS = computed(() => [
	{ label: __('DMARC Reports'), route: '/mail/dashboard/dmarc' },
	{ label: data.value ? `${data.value.domain} · ${data.value.reporter}` : reportId },
])

const period = computed(() => {
	if (!data.value) return ''
	const begin = formatDateTime(data.value.date_range_begin)
	const end = formatDateTime(data.value.date_range_end)
	return begin && end ? `${begin} – ${end}` : end || begin
})

const metaItems = computed(() => [
	data.value ? __('Reported by {0}', [data.value.reporter]) : '',
	period.value,
	data.value?.received_at ? __('Received {0}', [formatDateTime(data.value.received_at)]) : '',
])

const policyRows = computed(() => {
	const policy = data.value?.policy || {}
	return [
		{ label: __('Policy (p)'), value: policy.p },
		{ label: __('Subdomains (sp)'), value: policy.sp },
		{
			label: __('Testing mode'),
			// An absent value is unknown, not "No"; the row then shows the usual placeholder.
			value: policy.testing_mode == null ? '' : policy.testing_mode ? __('Yes') : __('No'),
		},
		{ label: __('DKIM alignment'), value: policy.adkim },
		{ label: __('SPF alignment'), value: policy.aspf },
	]
})

const reportRows = computed(() => [
	{ label: __('Reporter'), value: data.value?.reporter },
	{ label: __('Contact'), value: data.value?.reporter_email },
	{ label: __('Report ID'), value: data.value?.report_id },
	{ label: __('Version'), value: data.value?.version != null ? String(data.value.version) : '' },
	{ label: __('Subject'), value: data.value?.subject },
	{ label: __('Sent to'), value: (data.value?.to || []).join(', ') },
])
</script>
