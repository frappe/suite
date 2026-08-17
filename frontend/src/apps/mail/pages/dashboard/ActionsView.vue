<template>
	<DashboardLayout :breadcrumbs="[{ label: __('Actions') }]">
		<div v-if="actions?.data" class="flex flex-col gap-5">
			<DashboardCard v-for="group in groupedActions" :key="group.label" :title="group.label">
				<div class="grid grid-cols-1 sm:grid-cols-2">
					<div
						v-for="(action, index) in group.items"
						:key="action.value"
						class="flex items-center justify-between gap-3 px-5 py-3.5"
						:class="cellBorders(index, group.items.length)"
					>
						<div class="flex min-w-0 items-center gap-3">
							<div class="bg-surface-gray-2 text-ink-gray-7 flex size-7 shrink-0 items-center justify-center rounded">
								<FeatherIcon :name="actionIcon(action, group.label)" class="size-4" />
							</div>
							<div class="min-w-0">
								<p class="truncate text-base">{{ action.name }}</p>
								<p v-if="needsInput(action)" class="text-ink-gray-5 mt-0.5 text-xs">
									{{ __('Takes input') }}
								</p>
							</div>
						</div>
						<!-- The tooltip sits on a wrapper: a disabled button emits no hover events itself. -->
						<Tooltip
							:text="isLocked(action) ? __('Only the Administrator can run this action.') : ''"
							:disabled="!isLocked(action)"
						>
							<span class="shrink-0">
								<Button :label="__('Run')" :disabled="isLocked(action)" @click="trigger(action)" />
							</span>
						</Tooltip>
					</div>
				</div>
			</DashboardCard>
		</div>
		<DashboardListSkeleton v-else :columns="2" />
	</DashboardLayout>
	<Dialog v-model="showConfirm" :options="confirmOptions" />
	<RunActionModal v-model="showRun" :action="activeAction" :fields="activeFields" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, Dialog, Tooltip, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { getSessionUser } from '@/boot/session'

import { raiseToast } from '@/apps/mail/utils'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import RunActionModal from '@/apps/mail/components/Modals/RunActionModal.vue'

type ActionOption = { value: string; label: string }
type ActionInfo = {
	value: string
	label: string
	schema_name?: string | null
	administrator_only?: boolean
	options?: Record<string, ActionOption[]>
}
type ActionField = {
	name: string
	label: string
	type?: string
	placeholder?: string
	required?: boolean
	options?: ActionOption[]
}

usePageMeta(() => ({ title: __('Actions') }))

// Input fields for the parameterized actions (parameterless actions run directly).
const ACTION_FIELDS: Record<string, ActionField[]> = {
	// Mirrors the "Input" section of the server's x:DmarcTroubleshoot form; only the body is optional.
	'x:DmarcTroubleshoot': [
		{ name: 'remoteIp', label: 'Remote IP', placeholder: '192.168.1.1', required: true },
		{ name: 'ehloDomain', label: 'EHLO Domain', placeholder: 'mail.example.com', required: true },
		{ name: 'mailFrom', label: 'MAIL FROM', placeholder: 'sender@example.com', required: true },
		{ name: 'spfEhloDomain', label: 'SPF EHLO Domain', placeholder: 'mail.example.com', required: true },
		{ name: 'spfMailFromDomain', label: 'SPF MAIL FROM Domain', placeholder: 'example.com', required: true },
		{ name: 'message', label: 'Message Body', type: 'textarea' },
	],
	// Mirrors the "Input" section of the server's x:SpamClassify form; the choices for
	// `envFromParameters` come from the action itself, as only the server knows its exact values.
	'x:SpamClassify': [
		{ name: 'message', label: 'Message', type: 'textarea', required: true },
		{ name: 'remoteIp', label: 'Remote IP', placeholder: '192.168.1.1', required: true },
		{ name: 'ehloDomain', label: 'EHLO Domain', placeholder: 'mail.example.com', required: true },
		{ name: 'authenticatedAs', label: 'Authenticated As', placeholder: 'user@example.com' },
		{ name: 'isTls', label: 'TLS Enabled', type: 'checkbox' },
		{ name: 'envFrom', label: 'MAIL FROM', placeholder: 'sender@example.com', required: true },
		{ name: 'envFromParameters', label: 'MAIL FROM Parameters', type: 'select' },
		{ name: 'envRcptTo', label: 'RCPT TO', type: 'list', placeholder: 'recipient@example.org' },
	],
}

// Icon per action, falling back to the section's icon for any action the server adds later.
const ACTION_ICONS: Record<string, string> = {
	ReloadSettings: 'sliders',
	ReloadTlsCertificates: 'shield',
	ReloadLookupStores: 'database',
	ReloadBlockedIps: 'shield-off',
	UpdateApps: 'download-cloud',
	TroubleshootDmarc: 'tool',
	ClassifySpam: 'filter',
	InvalidateCaches: 'trash-2',
	InvalidateNegativeCaches: 'trash',
	PauseMtaQueue: 'pause-circle',
	ResumeMtaQueue: 'play-circle',
}
const SECTION_ICONS: Record<string, string> = {
	Reload: 'refresh-cw',
	Cache: 'trash-2',
	MTA: 'send',
	DMARC: 'shield',
	'Spam Filter': 'filter',
	'Application Management': 'package',
}
const FALLBACK_ICON = 'zap'

const showConfirm = ref(false)
const showRun = ref(false)
const activeAction = ref<ActionInfo | null>(null)
const activeFields = ref<ActionField[]>([])

const actions = createResource({ url: 'suite.mail.api.admin.get_actions', auto: true })

// Group actions by the prefix before the first ":" in their label (e.g. "Reload", "Cache", "MTA").
const groupedActions = computed(() => {
	const groups = new Map<string, { label: string; items: (ActionInfo & { name: string })[] }>()
	for (const action of (actions.data || []) as ActionInfo[]) {
		const [prefix, rest] = action.label.includes(':')
			? [action.label.split(':')[0].trim(), action.label.split(':').slice(1).join(':').trim()]
			: [__('General'), action.label]
		if (!groups.has(prefix)) groups.set(prefix, { label: prefix, items: [] })
		groups.get(prefix)!.items.push({ ...action, name: rest })
	}
	return Array.from(groups.values())
})

const needsInput = (action: ActionInfo) => Boolean(action.schema_name && ACTION_FIELDS[action.schema_name])
// Which actions are restricted is the server's call; this only reflects it, and run_action enforces it.
const isAdministrator = getSessionUser() === 'Administrator'
const isLocked = (action: ActionInfo) => Boolean(action.administrator_only) && !isAdministrator
const actionIcon = (action: ActionInfo, section: string) =>
	ACTION_ICONS[action.value] || SECTION_ICONS[section] || FALLBACK_ICON

// Two actions per row: a cell keeps its bottom divider unless it sits in the last row of the
// current layout, and its right divider only when a second action shares the row.
const cellBorders = (index: number, count: number) => {
	const lastRowStart = count % 2 === 0 ? count - 2 : count - 1
	return [
		index < count - 1 ? 'border-b' : '',
		index >= lastRowStart ? 'sm:border-b-0' : '',
		index % 2 === 0 && index + 1 < count ? 'sm:border-r' : '',
	]
}

const trigger = (action: ActionInfo) => {
	activeAction.value = action
	if (action.schema_name && ACTION_FIELDS[action.schema_name]) {
		// Selects take their choices from the schema the server reported alongside the action.
		activeFields.value = ACTION_FIELDS[action.schema_name].map((field) =>
			field.type === 'select' ? { ...field, options: action.options?.[field.name] || [] } : field,
		)
		showRun.value = true
	} else {
		showConfirm.value = true
	}
}

const runAction = createResource({
	url: 'suite.mail.api.admin.run_action',
	makeParams: () => ({ action_type: activeAction.value?.value }),
	onSuccess: () => {
		showConfirm.value = false
		raiseToast(__('Action completed.'))
	},
	onError: (error: { messages?: string[] }) => {
		showConfirm.value = false
		raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
	},
})

const confirmOptions = computed(() => ({
	title: activeAction.value?.label,
	message: __('Run this action now?'),
	actions: [{ label: __('Run'), variant: 'solid', onClick: runAction.submit }],
}))
</script>
