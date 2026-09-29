<template>
	<DashboardLayout :breadcrumbs="BREADCRUMBS" :loading="!report.data">
		<template #default>
			<DashboardDetailHeader
				:title="report.data.domain"
				:badge-label="__('{0} succeeded', [formatRate(report.data.success_rate)])"
				:badge-theme="rateTheme(report.data.success_rate)"
				:meta="metaItems"
			>
				<template #icon><Lock class="h-5 w-5" /></template>
			</DashboardDetailHeader>

			<TlsStatTiles :totals="report.data" />

			<div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
				<!-- One row per kind of failure and receiving host, as the sender grouped them. -->
				<DashboardCard :title="__('Failures')" class="lg:col-span-2">
					<div v-if="report.data.failures.length" class="flex flex-col">
						<div
							v-for="(failure, index) in report.data.failures"
							:key="index"
							class="flex flex-col gap-2 border-b px-5 py-3 text-sm last:border-b-0"
						>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
								<span class="min-w-0 flex-1 truncate font-medium" :title="failure.result_type || ''">
									{{ resultTypeLabel(failure.result_type) }}
								</span>
								<span class="text-ink-gray-5 tabular-nums">
									{{ __('{0} sessions', [failure.count.toLocaleString()]) }}
								</span>
								<Badge v-if="failure.policy_type" :label="policyTypeLabel(failure.policy_type)" theme="gray" />
							</div>
							<div class="text-ink-gray-5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
								<span v-if="failure.receiving_mx_hostname || failure.receiving_ip">
									{{ __('Receiving MX: {0}', [receivingHost(failure)]) }}
								</span>
								<span v-if="failure.receiving_mx_helo">{{ __('HELO: {0}', [failure.receiving_mx_helo]) }}</span>
								<span v-if="failure.sending_mta_ip">{{ __('Sent from: {0}', [failure.sending_mta_ip]) }}</span>
								<span v-if="failure.failure_reason_code" class="break-all">
									{{ __('Reason: {0}', [failure.failure_reason_code]) }}
								</span>
								<span v-if="failure.additional_information" class="break-all">
									{{ failure.additional_information }}
								</span>
							</div>
						</div>
					</div>
					<div v-else class="text-ink-gray-5 px-5 py-4 text-sm">
						{{ report.data.sessions ? __('Every session negotiated TLS.') : __('The reporter counted no sessions.') }}
					</div>
				</DashboardCard>

				<div class="flex flex-col gap-5">
					<!-- The policy as the sender found it, so a stale or missing MTA-STS policy shows here. -->
					<DashboardCard :title="__('Policies Applied')">
						<div v-if="report.data.policies.length" class="flex flex-col">
							<div
								v-for="(policy, index) in report.data.policies"
								:key="index"
								class="flex flex-col gap-1.5 border-b px-5 py-3 text-sm last:border-b-0"
							>
								<div class="flex items-center gap-2">
									<span class="min-w-0 flex-1 truncate font-medium">{{ policyTypeLabel(policy.policy_type) }}</span>
									<span class="text-ink-gray-5 tabular-nums">
										{{ __('{0} ok · {1} failed', [policy.successful.toLocaleString(), policy.failed.toLocaleString()]) }}
									</span>
								</div>
								<span v-if="policy.policy_domain" class="text-ink-gray-5 text-xs">{{ policy.policy_domain }}</span>
								<span v-if="policy.mx_hosts.length" class="text-ink-gray-5 break-all text-xs">
									{{ __('MX: {0}', [policy.mx_hosts.join(', ')]) }}
								</span>
								<div
									v-if="policy.policy_strings.length"
									class="bg-surface-gray-1 text-ink-gray-6 whitespace-pre-line break-all rounded-4 px-2 py-1.5 font-mono text-xs"
								>
									{{ policy.policy_strings.join('\n') }}
								</div>
							</div>
						</div>
						<div v-else class="text-ink-gray-5 px-5 py-4 text-sm">{{ __('The reporter listed no policy.') }}</div>
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

import Lock from '~icons/lucide/lock'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import { formatRate, rateTheme } from '@/apps/mail/utils/reports'
import {
	type TlsFailure,
	type TlsPolicy,
	type TlsReportRow,
	policyTypeLabel,
	resultTypeLabel,
} from '@/apps/mail/utils/tls'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import TlsStatTiles from '@/apps/mail/components/TlsStatTiles.vue'

type ReportData = TlsReportRow & { policies: TlsPolicy[]; failures: TlsFailure[] }

const { reportId } = defineProps<{ reportId: string }>()

const router = useRouter()

const report = createResource({
	url: 'suite.mail.api.admin.get_tls_report',
	auto: true,
	makeParams: () => ({ report_id: reportId }),
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Report not found.'), 'error')
		router.replace({ name: 'mail-tls-reports' })
	},
})

const data = computed(() => report.data as ReportData | undefined)

usePageMeta(() => appPageMeta(data.value ? __('TLS report for {0}', [data.value.domain]) : __('TLS Report'), 'Mail'))

const BREADCRUMBS = computed(() => [
	{ label: __('TLS Reports'), route: '/mail/dashboard/tls' },
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

const receivingHost = (failure: TlsFailure) => {
	const host = failure.receiving_mx_hostname || failure.receiving_ip || ''
	return failure.receiving_mx_hostname && failure.receiving_ip ? `${host} (${failure.receiving_ip})` : host
}

const reportRows = computed(() => [
	{ label: __('Reporter'), value: data.value?.reporter },
	{ label: __('Contact'), value: data.value?.contact_info || data.value?.reporter_email },
	{ label: __('Report ID'), value: data.value?.report_id },
	{ label: __('Subject'), value: data.value?.subject },
	{ label: __('Sent to'), value: (data.value?.to || []).join(', ') },
])
</script>
