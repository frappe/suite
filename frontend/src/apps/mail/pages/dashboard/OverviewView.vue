<template>
	<DashboardLayout :breadcrumbs="[{ label: __('Overview') }]" :loading="!overview.data">
		<!-- KPI tiles: one glanceable number per section, each a link into it. -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
			<RouterLink
				v-for="stat in stats"
				:key="stat.label"
				:to="stat.to"
				class="hover:bg-surface-gray-1 group flex flex-col gap-1 rounded-4 border p-4 transition-colors"
			>
				<span class="text-ink-gray-5 flex items-center gap-1.5 text-sm">
					<component :is="stat.icon" class="h-4 w-4" />
					{{ stat.label }}
				</span>
				<span class="text-ink-gray-9 text-xl font-semibold">{{ stat.value }}</span>
				<span class="text-xs" :class="stat.subTone === 'warning' && stat.sub ? 'text-ink-amber-6' : 'text-ink-gray-5'">
					{{ stat.sub || ' ' }}
				</span>
			</RouterLink>
		</div>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-5">
			<!-- Recent activity -->
			<DashboardCard :title="__('Recent Activity')" class="lg:col-span-3">
				<template #actions>
					<Button
						variant="ghost"
						:label="__('View Logs')"
						@click="router.push({ name: 'mail-logs' })"
					/>
				</template>
				<div v-if="recentLogs.length" class="flex flex-col">
					<RouterLink
						v-for="log in recentLogs"
						:key="log.id"
						:to="{ name: 'mail-log', params: { logId: log.id } }"
						class="hover:bg-surface-gray-1 flex items-center gap-3 border-b px-5 py-3 last:border-b-0"
					>
						<Badge :label="log.level_label || log.level" :theme="levelTheme(log.level)" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm">{{ log.event_label || log.event }}</p>
							<p v-if="log.details" class="text-ink-gray-5 mt-0.5 truncate font-mono text-xs">
								{{ log.details }}
							</p>
						</div>
						<span class="text-ink-gray-5 shrink-0 text-xs">{{ fromNow(log.timestamp) }}</span>
					</RouterLink>
				</div>
				<div v-else class="text-ink-gray-5 px-5 py-8 text-center text-sm">
					{{ __('No recent log entries.') }}
				</div>
			</DashboardCard>

			<!-- Quick actions -->
			<DashboardCard :title="__('Quick Actions')" class="lg:col-span-2">
				<div class="flex flex-col">
					<RouterLink
						v-for="action in QUICK_ACTIONS"
						:key="action.label"
						:to="action.to"
						class="hover:bg-surface-gray-1 group flex items-center gap-3 border-b px-5 py-3 last:border-b-0"
					>
						<div
							class="bg-surface-gray-2 text-ink-gray-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-4"
						>
							<component :is="action.icon" class="h-4 w-4" />
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">{{ action.label }}</p>
							<p class="text-ink-gray-5 mt-0.5 truncate text-xs">{{ action.description }}</p>
						</div>
						<FeatherIcon
							name="chevron-right"
							class="text-ink-gray-4 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
						/>
					</RouterLink>
				</div>
			</DashboardCard>
		</div>
	</DashboardLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Badge, Button, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { fromNow } from '@/apps/mail/utils/datetime'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'

import Clock from '~icons/lucide/clock'
import Globe from '~icons/lucide/globe'
import Mails from '~icons/lucide/mails'
import Megaphone from '~icons/lucide/megaphone'
import Radar from '~icons/lucide/radar'
import ScrollText from '~icons/lucide/scroll-text'
import UserPlus from '~icons/lucide/user-plus'
import Users from '~icons/lucide/users'
import UsersRound from '~icons/lucide/users-round'

type CountWithDisabled = { total: number; disabled: number }
type LogEntry = {
	id: string
	timestamp?: string
	level?: string
	level_label?: string
	event?: string
	event_label?: string
	details?: string
}
type OverviewData = {
	members: CountWithDisabled | null
	pending_invites: number | null
	domains: CountWithDisabled | null
	groups: number | null
	mailing_lists: number | null
	queued_messages: number | null
	recent_logs: LogEntry[]
}

usePageMeta(() => ({ title: __('Overview') }))

const router = useRouter()

const overview = createResource({
	url: 'suite.mail.api.admin.get_overview',
	auto: true,
	cache: 'mailOverview',
})

const data = computed(() => overview.data as OverviewData | undefined)

// A section whose backing store was unreachable reports null; show an em dash
// rather than a fake zero.
const count = (value: number | null | undefined) => (value == null ? '—' : String(value))

const disabledSub = (value: CountWithDisabled | null | undefined) =>
	value?.disabled ? __('{0} disabled', [String(value.disabled)]) : ''

const stats = computed(() => [
	{
		label: __('Members'),
		icon: Users,
		value: count(data.value?.members?.total),
		sub: disabledSub(data.value?.members),
		subTone: 'muted',
		to: { name: 'mail-members' },
	},
	{
		label: __('Invites'),
		icon: UserPlus,
		value: count(data.value?.pending_invites),
		sub: data.value?.pending_invites ? __('awaiting acceptance') : '',
		subTone: 'muted',
		to: { name: 'mail-invites' },
	},
	{
		label: __('Domains'),
		icon: Globe,
		value: count(data.value?.domains?.total),
		sub: disabledSub(data.value?.domains),
		subTone: 'warning',
		to: { name: 'mail-domains' },
	},
	{
		label: __('Groups'),
		icon: UsersRound,
		value: count(data.value?.groups),
		sub: '',
		subTone: 'muted',
		to: { name: 'mail-groups' },
	},
	{
		label: __('Mailing Lists'),
		icon: Megaphone,
		value: count(data.value?.mailing_lists),
		sub: '',
		subTone: 'muted',
		to: { name: 'mail-mailing-lists' },
	},
	{
		label: __('Queued'),
		icon: Clock,
		value: count(data.value?.queued_messages),
		sub: data.value?.queued_messages ? __('awaiting delivery') : '',
		subTone: 'muted',
		to: { name: 'mail-queued-messages' },
	},
])

const recentLogs = computed(() => data.value?.recent_logs || [])

// Mirrors the colours the server's TracingLevel enum assigns to each level.
const LEVEL_THEMES: Record<string, string> = {
	error: 'red',
	warn: 'amber',
	info: 'green',
	debug: 'blue',
	trace: 'violet',
}
const levelTheme = (level?: string) => LEVEL_THEMES[(level || '').toLowerCase()] || 'gray'

const QUICK_ACTIONS = [
	{
		label: __('Add a domain'),
		description: __('Connect a domain and set up its DNS records.'),
		icon: Globe,
		to: { name: 'mail-domains' },
	},
	{
		label: __('Invite a member'),
		description: __('Give someone a mailbox on your domains.'),
		icon: UserPlus,
		to: { name: 'mail-members' },
	},
	{
		label: __('Run a delivery test'),
		description: __('Trace a live SMTP delivery to diagnose issues.'),
		icon: Radar,
		to: { name: 'mail-delivery-test' },
	},
	{
		label: __('Review the queue'),
		description: __('Inspect and retry messages pending delivery.'),
		icon: Mails,
		to: { name: 'mail-queued-messages' },
	},
	{
		label: __('Check server logs'),
		description: __('Follow what the mail server is doing.'),
		icon: ScrollText,
		to: { name: 'mail-logs' },
	},
]
</script>
