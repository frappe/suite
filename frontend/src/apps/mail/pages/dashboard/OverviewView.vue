<template>
	<DashboardLayout :breadcrumbs="[{ label: __('Overview') }]" :loading="!overview.data">
		<!-- KPI tiles: one glanceable number per section, each a link into it. -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
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

		<div class="grid grid-cols-1 gap-5">
			<!-- Quick actions -->
			<DashboardCard :title="__('Quick Actions')">
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
import { appPageMeta } from '@/utils/documentTitle'
import { createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'

import Globe from '~icons/lucide/globe'
import Megaphone from '~icons/lucide/megaphone'
import UserPlus from '~icons/lucide/user-plus'
import Users from '~icons/lucide/users'
import UsersRound from '~icons/lucide/users-round'

type CountWithDisabled = { total: number; disabled: number }
type Limits = {
	max_domains?: number
	max_accounts?: number
	max_groups?: number
	max_mailing_lists?: number
}
type OverviewData = {
	members: CountWithDisabled | null
	pending_invites: number | null
	domains: number | null
	groups: number | null
	mailing_lists: number | null
	limits: Limits | null
}

usePageMeta(() => appPageMeta(__('Overview'), 'Mail'))

const overview = createResource({
	url: 'suite.mail.api.admin.get_overview',
	auto: true,
})

const data = computed(() => overview.data as OverviewData | undefined)

// A section whose backing store was unreachable reports null; show an em dash
// rather than a fake zero.
const count = (value: number | null | undefined) => (value == null ? '—' : String(value))

const disabledSub = (value: CountWithDisabled | null | undefined) =>
	value?.disabled ? __('{0} disabled', [String(value.disabled)]) : ''

// Suite Cloud caps how many of each the site may hold; 0 means no cap.
const limitSub = (limit: number | undefined) => (limit ? __('of {0}', [String(limit)]) : '')

const stats = computed(() => [
	{
		label: __('Accounts'),
		icon: Users,
		value: count(data.value?.members?.total),
		// The limit first, like the other tiles; the disabled count follows when there is one.
		sub: [limitSub(data.value?.limits?.max_accounts), disabledSub(data.value?.members)]
			.filter(Boolean)
			.join(' · '),
		subTone: 'muted',
		to: { name: 'mail-accounts' },
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
		value: count(data.value?.domains),
		sub: limitSub(data.value?.limits?.max_domains),
		subTone: 'muted',
		to: { name: 'mail-domains' },
	},
	{
		label: __('Groups'),
		icon: UsersRound,
		value: count(data.value?.groups),
		sub: limitSub(data.value?.limits?.max_groups),
		subTone: 'muted',
		to: { name: 'mail-groups' },
	},
	{
		label: __('Mailing Lists'),
		icon: Megaphone,
		value: count(data.value?.mailing_lists),
		sub: limitSub(data.value?.limits?.max_mailing_lists),
		subTone: 'muted',
		to: { name: 'mail-mailing-lists' },
	},
])

const QUICK_ACTIONS = [
	{
		label: __('Add a domain'),
		description: __('Connect a domain and set up its DNS records.'),
		icon: Globe,
		to: { name: 'mail-domains' },
	},
	{
		label: __('Add an account'),
		description: __('Give someone a mailbox on your domains.'),
		icon: UserPlus,
		to: { name: 'mail-accounts' },
	},
]
</script>
