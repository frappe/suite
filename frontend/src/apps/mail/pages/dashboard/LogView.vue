<template>
	<DashboardLayout :breadcrumbs="breadcrumbs" :loading="!log.data">
		<template #default>
			<DashboardDetailHeader
				:title="data.event_label || data.event || logId"
				:meta="[formatDate(data.timestamp), logId]"
				:badge-label="data.level_label"
				:badge-theme="levelTheme(data.level)"
			>
				<template #icon><ScrollText class="h-5 w-5" /></template>
			</DashboardDetailHeader>

			<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
				<DashboardCard :title="__('Log Entry')">
					<InformationField :label="__('Timestamp')" :value="formatDate(data.timestamp)" />
					<InformationField :label="__('Level')" :value="data.level_label" />
				</DashboardCard>
				<DashboardCard :title="__('Details')">
					<template #actions>
						<Button variant="ghost" :label="__('Copy')" @click="copyToClipBoard(data.details || '')" />
					</template>
					<pre
						class="bg-surface-gray-2 max-h-[60vh] overflow-auto rounded-4 p-4 text-xs whitespace-pre-wrap"
						>{{ data.details || '—' }}</pre
					>
				</DashboardCard>
			</div>
		</template>
	</DashboardLayout>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Button, createResource, usePageMeta } from 'frappe-ui'

import ScrollText from '~icons/lucide/scroll-text'

import { copyToClipBoard, raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import InformationField from '@/apps/mail/components/InformationField.vue'

type LogData = {
	id: string
	timestamp?: string
	level?: string
	level_label?: string
	event?: string
	event_label?: string
	details?: string
}

const { logId } = defineProps<{ logId: string }>()
const router = useRouter()

usePageMeta(() => ({ title: __('Log Entry') }))

const log = createResource({
	url: 'suite.mail.api.admin.get_log',
	auto: true,
	makeParams: () => ({ log_id: logId }),
	cache: ['mailLog', logId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Log entry not found.'), 'error')
		router.replace({ name: 'mail-logs' })
	},
})

const data = computed(() => log.data as LogData)
const formatDate = (value?: string) => formatDateTime(value, 'MMM D YYYY, h:mm:ss A') || '—'

// Mirrors the colours the server's TracingLevel enum assigns to each level.
const LEVEL_THEMES: Record<string, 'red' | 'amber' | 'green' | 'blue' | 'violet'> = {
	error: 'red',
	warn: 'amber',
	info: 'green',
	debug: 'blue',
	trace: 'violet',
}
const levelTheme = (level?: string) => LEVEL_THEMES[(level || '').toLowerCase()] || 'gray'

const breadcrumbs = computed(() => [
	{ label: __('Logs'), route: '/mail/dashboard/logs' },
	{ label: data.value?.event_label || data.value?.event || logId },
])
</script>
