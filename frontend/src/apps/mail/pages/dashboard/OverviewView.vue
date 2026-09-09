<template>
	<DashboardLayout :breadcrumbs="[{ label: __('Overview') }]" :loading="!overview.data">
		<!-- One glanceable number per section, each a link into it. -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
			<RouterLink
				v-for="stat in stats"
				:key="stat.label"
				:to="stat.to"
				class="hover:bg-surface-gray-1 group flex flex-col gap-1 rounded-4 border p-4 transition-colors"
			>
				<span class="text-ink-gray-5 flex items-center gap-1.5 text-sm">
					<component :is="stat.icon" class="h-4 w-4 shrink-0" />
					{{ stat.label }}
				</span>
				<span class="text-ink-gray-9 text-xl font-semibold leading-7">{{ stat.value }}</span>
				<!-- The line is amber only for what the admin must act on; an aside such as
				     "1 not active" describes a deliberate state and stays muted. -->
				<span class="text-ink-gray-5 text-xs">
					<span :class="{ 'text-ink-amber-6': stat.warn }">{{ stat.sub || ' ' }}</span>
					<template v-if="stat.note"> · {{ stat.note }}</template>
				</span>
				<div v-if="stat.bar !== undefined" class="bg-surface-gray-3 mt-1 h-1 w-full rounded-full">
					<div
						class="h-1 rounded-full"
						:class="stat.warn ? 'bg-surface-amber-5' : 'bg-surface-gray-7'"
						:style="{ width: `${Math.min(100, Math.max(2, stat.bar))}%` }"
					/>
				</div>
			</RouterLink>
		</div>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
			<div class="flex flex-col gap-5 lg:col-span-2">
				<!-- What is not working yet, with the shortest path to fixing it. -->
				<DashboardCard :title="__('Needs Attention')">
					<!-- Four rows tall like Quick Actions beside it; further rows scroll inside. -->
					<div v-if="attention.length" class="flex h-56 flex-col overflow-y-auto">
						<RouterLink
							v-for="item in attention"
							:key="item.key"
							:to="item.to"
							class="hover:bg-surface-gray-1 group flex h-14 shrink-0 items-center gap-3 border-b px-5 last:border-b-0"
						>
							<div
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-4"
								:class="item.tone === 'amber' ? 'bg-surface-amber-1 text-ink-amber-6' : 'bg-surface-gray-2 text-ink-gray-6'"
							>
								<component :is="item.icon" class="h-4 w-4" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{{ item.title }}</p>
								<p class="text-ink-gray-5 mt-0.5 truncate text-xs">{{ item.description }}</p>
							</div>
							<span class="text-ink-gray-6 group-hover:text-ink-gray-9 shrink-0 text-sm">{{ item.action }}</span>
							<FeatherIcon name="chevron-right" class="text-ink-gray-4 h-4 w-4 shrink-0" />
						</RouterLink>
					</div>
					<div v-else class="text-ink-gray-5 flex h-56 items-center justify-center gap-3 px-5 text-sm">
						<CheckCircle class="text-ink-green-5 h-4 w-4 shrink-0" />
						{{ __('Every domain is active and no invite is waiting. Nothing needs your attention.') }}
					</div>
				</DashboardCard>

				<DashboardCard :title="__('Recent Accounts')" :button-label="__('View All')" @action="router.push({ name: 'mail-accounts' })">
					<div v-if="recentAccounts.length" class="flex flex-col">
						<RouterLink
							v-for="account in recentAccounts"
							:key="account.name"
							:to="{ name: 'mail-account', params: { accountId: account.name } }"
							class="hover:bg-surface-gray-1 flex h-14 items-center gap-3 border-b px-5 last:border-b-0"
						>
							<Avatar :image="account.user_image" :label="account.full_name" size="lg" />
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{{ account.full_name }}</p>
								<p class="text-ink-gray-5 truncate text-xs">{{ account.name }}</p>
							</div>
							<Badge
								:label="account.enabled ? __('Enabled') : __('Disabled')"
								:theme="account.enabled ? 'green' : 'gray'"
								class="shrink-0"
							/>
							<span class="text-ink-gray-5 w-36 shrink-0 whitespace-nowrap text-right text-xs">
								{{ __('Added {0}', [fromNow(account.joined_on)]) }}
							</span>
						</RouterLink>
					</div>
					<div v-else class="text-ink-gray-5 px-5 py-4 text-sm">
						{{ __('No accounts yet. Add one to give someone a mailbox on your domains.') }}
					</div>
				</DashboardCard>
			</div>

			<div class="flex flex-col gap-5">
				<DashboardCard :title="__('Quick Actions')">
					<div class="flex flex-col">
						<RouterLink
							v-for="action in QUICK_ACTIONS"
							:key="action.label"
							:to="action.to"
							class="hover:bg-surface-gray-1 group flex h-14 items-center gap-3 border-b px-5 last:border-b-0"
						>
							<div class="bg-surface-gray-2 text-ink-gray-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-4">
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

				<!-- Where this site's mail lives, for the admin who has to answer "which server?". -->
				<DashboardCard :title="__('Mail Service')">
					<!-- Plain rows at the same height as Recent Accounts beside it. -->
					<div class="flex flex-col">
						<div
							v-for="row in serviceRows"
							:key="row.label"
							class="flex h-14 items-center gap-3 border-b px-5 text-sm last:border-b-0"
						>
							<span class="text-ink-gray-5 w-28 shrink-0">{{ row.label }}</span>
							<span v-if="row.kind === 'workspace'" class="flex min-w-0 items-center gap-2 font-medium">
								<Avatar v-if="workspace?.name" :image="workspace.logo" :label="workspace.name" size="sm" />
								<span class="truncate">{{ workspace?.name || '—' }}</span>
							</span>
							<Badge v-else-if="row.kind === 'status' && row.value" :label="row.value" :theme="row.theme" />
							<span v-else class="truncate font-medium">{{ row.value || '—' }}</span>
						</div>
					</div>
				</DashboardCard>
			</div>
		</div>
	</DashboardLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { appPageMeta } from '@/utils/documentTitle'
import { useRouter } from 'vue-router'
import { Avatar, Badge, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { ADD_QUERY } from '@/apps/mail/utils/addOnArrival'
import { fromNow } from '@/apps/mail/utils/datetime'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'

import CheckCircle from '~icons/lucide/check-circle-2'
import Clock from '~icons/lucide/clock'
import Globe from '~icons/lucide/globe'
import HardDrive from '~icons/lucide/hard-drive'
import Megaphone from '~icons/lucide/megaphone'
import UserPlus from '~icons/lucide/user-plus'
import UserX from '~icons/lucide/user-x'
import Users from '~icons/lucide/users'
import UsersRound from '~icons/lucide/users-round'

type CountWithDisabled = { total: number; disabled: number }
type Limits = {
	max_domains?: number
	max_accounts?: number
	max_groups?: number
	max_mailing_lists?: number
	max_disk_gb?: number
}
type Storage = { allocated_gb: number | null; max_gb: number | null; default_quota_gb: number | null }
type Site = {
	site?: string
	title?: string
	status?: string
	cluster?: string
	mail_hostname?: string
	jmap_url?: string
	contact_email?: string
}
type AttentionDomain = { name: string; status: string; last_verified_at?: string | null }
type InviteCounts = { pending: number; expiring_soon: number; expired: number }
type RecentAccount = { name: string; full_name: string; user_image?: string; enabled: boolean; joined_on: string }
type Workspace = { name?: string; logo?: string }
type OverviewData = {
	members: CountWithDisabled | null
	pending_invites: number | null
	domains: number | null
	groups: number | null
	mailing_lists: number | null
	limits: Limits | null
	storage?: Storage | null
	site?: Site | null
	domains_needing_attention?: AttentionDomain[]
	invites?: InviteCounts | null
	recent_accounts?: RecentAccount[]
	disabled_accounts?: { name: string; full_name: string }[]
	workspace?: Workspace | null
}

usePageMeta(() => appPageMeta(__('Overview'), 'Mail'))

const router = useRouter()

const overview = createResource({
	url: 'suite.mail.api.admin.get_overview',
	auto: true,
})

const data = computed(() => overview.data as OverviewData | undefined)
const site = computed(() => data.value?.site || undefined)
const recentAccounts = computed(() => data.value?.recent_accounts || [])
const workspace = computed(() => data.value?.workspace || undefined)

// A section whose backing store was unreachable reports null; show an em dash
// rather than a fake zero.
const count = (value: number | null | undefined) => (value == null ? '—' : String(value))

// Suite Cloud caps how many of each the site may hold; 0 means no cap.
const limitSub = (limit: number | undefined) => (limit ? __('of {0}', [String(limit)]) : '')

// "1 disabled account" but "3 disabled accounts".
const plural = (n: number, one: string, many: string) => (n === 1 ? one : __(many, [String(n)]))

const gb = (value: number | null | undefined) =>
	value == null ? '—' : __('{0} GB', [String(Math.round(value * 10) / 10)])

const storagePercent = computed(() => {
	const storage = data.value?.storage
	if (!storage?.max_gb || storage.allocated_gb == null) return undefined
	return Math.round((storage.allocated_gb / storage.max_gb) * 100)
})

const serviceRows = computed(() => {
	const quota = data.value?.storage?.default_quota_gb
	const status = site.value?.status
	return [
		{ label: __('Workspace'), kind: 'workspace', value: workspace.value?.name },
		{ label: __('Site'), value: site.value?.site },
		{ label: __('Mail Server'), value: site.value?.mail_hostname },
		{ label: __('Status'), kind: 'status', value: status, theme: status === 'Active' ? 'green' : 'amber' },
		{ label: __('Default Quota'), value: quota ? __('{0} GB per account', [String(quota)]) : undefined },
		{ label: __('Contact'), value: site.value?.contact_email },
	]
})


const stats = computed(() => {
	const members = data.value?.members
	const limits = data.value?.limits
	const storage = data.value?.storage
	return [
		{
			label: __('Accounts'),
			icon: Users,
			value: count(members?.total),
			sub: [limitSub(limits?.max_accounts), members?.disabled ? __('{0} disabled', [String(members.disabled)]) : '']
				.filter(Boolean)
				.join(' · '),
			warn: false,
			to: { name: 'mail-accounts' },
		},
		{
			label: __('Invites'),
			icon: UserPlus,
			value: count(data.value?.invites?.pending ?? data.value?.pending_invites),
			sub: data.value?.invites?.expired ? __('{0} expired', [String(data.value.invites.expired)]) : __('pending'),
			warn: !!data.value?.invites?.expired,
			to: { name: 'mail-invites' },
		},
		{
			label: __('Domains'),
			icon: Globe,
			value: count(data.value?.domains),
			sub: domainsPending.value
				? plural(domainsPending.value, __('1 needs action'), '{0} need action')
				: limitSub(limits?.max_domains),
			note: domainsDisabled.value
				? plural(domainsDisabled.value, __('1 not active'), '{0} not active')
				: '',
			warn: domainsPending.value > 0,
			to: { name: 'mail-domains' },
		},
		{
			label: __('Groups'),
			icon: UsersRound,
			value: count(data.value?.groups),
			sub: limitSub(limits?.max_groups),
			warn: false,
			to: { name: 'mail-groups' },
		},
		{
			label: __('Mailing Lists'),
			icon: Megaphone,
			value: count(data.value?.mailing_lists),
			sub: limitSub(limits?.max_mailing_lists),
			warn: false,
			to: { name: 'mail-mailing-lists' },
		},
		{
			label: __('Storage'),
			icon: HardDrive,
			value: gb(storage?.allocated_gb),
			sub: storage?.max_gb ? __('of {0} allocated', [gb(storage.max_gb)]) : __('allocated, no cap'),
			warn: (storagePercent.value ?? 0) >= 80,
			bar: storagePercent.value,
			to: { name: 'mail-accounts' },
		},
	]
})

const attentionDomains = computed(() => data.value?.domains_needing_attention || [])

// Unverified domains need the admin to act; disabled ones were switched off on purpose.
const domainsPending = computed(
	() => attentionDomains.value.filter((d) => d.status !== 'Disabled').length,
)
const domainsDisabled = computed(() => attentionDomains.value.length - domainsPending.value)

// Weighted by what the admin must do: unverified domains first (the most recently checked on
// top), then domains switched off on purpose by name, then accounts that cannot sign in by
// address, and only then invites going stale and quota pressure.
const attention = computed(() => {
	const items = []
	const byNewestCheck = (a: AttentionDomain, b: AttentionDomain) =>
		(b.last_verified_at || '').localeCompare(a.last_verified_at || '') || a.name.localeCompare(b.name)
	const pending = attentionDomains.value.filter((d) => d.status !== 'Disabled').sort(byNewestCheck)
	const disabled = attentionDomains.value
		.filter((d) => d.status === 'Disabled')
		.sort((a, b) => a.name.localeCompare(b.name))
	for (const domain of [...pending, ...disabled]) {
		const off = domain.status === 'Disabled'
		items.push({
			key: `domain:${domain.name}`,
			icon: Globe,
			// Amber asks for action; a domain someone disabled on purpose is listed in grey.
			tone: off ? 'gray' : 'amber',
			title: domain.name,
			description: off
				? __('The domain is disabled, so no mail flows for it.')
				: __('DNS records are not verified yet, so no mail flows for it.'),
			action: off ? __('Open') : __('Verify DNS'),
			to: { name: 'mail-domain', params: { domainId: domain.name } },
		})
	}
	for (const account of data.value?.disabled_accounts || []) {
		items.push({
			key: `account:${account.name}`,
			icon: UserX,
			tone: 'gray',
			title: account.name,
			description: __('{0} is disabled and cannot sign in; the mail is kept.', [account.full_name || account.name]),
			action: __('Open'),
			to: { name: 'mail-account', params: { accountId: account.name } },
		})
	}
	const invites = data.value?.invites
	if (invites?.expired) {
		items.push({
			key: 'invites:expired',
			icon: Clock,
			tone: 'gray',
			title: plural(invites.expired, __('1 expired invite'), '{0} expired invites'),
			description: __('The links no longer work; resend or remove them.'),
			action: __('Review'),
			to: { name: 'mail-invites', query: { status: 'Expired' } },
		})
	}
	if (invites?.expiring_soon) {
		items.push({
			key: 'invites:soon',
			icon: Clock,
			tone: 'amber',
			title: plural(invites.expiring_soon, __('1 invite expires within a day'), '{0} invites expire within a day'),
			description: __('Extend them if the people have not had a chance to accept.'),
			action: __('Review'),
			to: { name: 'mail-invites', query: { status: 'Pending' } },
		})
	}
	if ((storagePercent.value ?? 0) >= 80) {
		items.push({
			key: 'storage',
			icon: HardDrive,
			tone: 'amber',
			title: __('Storage is {0}% allocated', [String(storagePercent.value)]),
			description: __('New accounts will be refused once the site quota is fully allocated.'),
			action: __('Review'),
			to: { name: 'mail-accounts' },
		})
	}
	return items
})

const QUICK_ACTIONS = [
	{
		label: __('Add an account'),
		description: __('Give someone a mailbox on your domains.'),
		icon: UserPlus,
		to: { name: 'mail-accounts', query: ADD_QUERY },
	},
	{
		label: __('Add a domain'),
		description: __('Connect a domain and set up its DNS.'),
		icon: Globe,
		to: { name: 'mail-domains', query: ADD_QUERY },
	},
	{
		label: __('Add a group'),
		description: __('A shared address for a team.'),
		icon: UsersRound,
		to: { name: 'mail-groups', query: ADD_QUERY },
	},
	{
		label: __('Add a mailing list'),
		description: __('Broadcast mail to many recipients.'),
		icon: Megaphone,
		to: { name: 'mail-mailing-lists', query: ADD_QUERY },
	},
]
</script>
