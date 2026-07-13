<template>
	<SettingsDialog v-model="show" v-model:tab="activeTab" size="5xl" :shortcut="false">
		<template #title>{{ __('Settings') }}</template>
		<SettingsSidebar>
			<SettingsNavGroup
				v-for="group in tabGroups"
				:key="group.label"
				:label="group.label"
			>
				<SettingsNavItem v-for="tab in group.items" :key="tab.value" :value="tab.value">
					<template #prefix>
						<component :is="tab.icon" class="size-4 shrink-0 text-ink-gray-6" />
					</template>
					{{ tab.label }}
				</SettingsNavItem>
			</SettingsNavGroup>
		</SettingsSidebar>
		<SettingsContent>
			<SettingsPanel v-for="tab in tabs" :key="tab.value" :value="tab.value">
				<component :is="tab.component" />
			</SettingsPanel>
		</SettingsContent>
	</SettingsDialog>
</template>
<script setup lang="ts">
import { computed, inject, markRaw, ref, watch, type Component } from 'vue'
import {
	Ban,
	BellRing,
	Code,
	Feather,
	Fingerprint,
	Folders,
	HardDriveDownload,
	HardDriveUpload,
	Mailbox,
	Palette,
	TreePalm,
	User,
	Zap,
} from 'lucide-vue-next'
import {
	SettingsContent,
	SettingsDialog,
	SettingsNavGroup,
	SettingsNavItem,
	SettingsPanel,
	SettingsSidebar,
} from 'frappe-ui'

import { useSettings } from '@/apps/mail/utils/composables'
import Account from '@/apps/mail/components/Settings/Account.vue'
import AdvancedSettings from '@/apps/mail/components/Settings/AdvancedSettings.vue'
import AppearanceSettings from '@/apps/mail/components/Settings/AppearanceSettings.vue'
import AutomationSettings from '@/apps/mail/components/Settings/AutomationSettings.vue'
import ExportSettings from '@/apps/mail/components/Settings/ExportSettings.vue'
import FolderSettings from '@/apps/mail/components/Settings/FolderSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import ImportSettings from '@/apps/mail/components/Settings/ImportSettings.vue'
import ProfileSettings from '@/apps/mail/components/Settings/ProfileSettings.vue'
import PushSubscriptionSettings from '@/apps/mail/components/Settings/PushSubscriptionSettings.vue'
import ScreenedEmailAddressSettings from '@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'

type SettingsTab = {
	label: string
	value: string
	icon: Component
	component: ReturnType<typeof markRaw>
	condition?: boolean
}

type SettingsTabGroup = {
	label: string
	items: SettingsTab[]
}

const show = defineModel<boolean>()
const { settingsTab } = useSettings()

const user = inject('$user') as { data: Record<string, any> }

const tabGroups = computed((): SettingsTabGroup[] => {
	const jmap = !!user.data.is_jmap_configured

	const groups: SettingsTabGroup[] = [
		{
			label: __('General'),
			items: [
				{
					label: __('Profile'),
					value: 'profile',
					icon: User,
					component: markRaw(ProfileSettings),
				},
				{
					label: __('Account'),
					value: 'account',
					icon: Mailbox,
					component: markRaw(Account),
					condition: jmap,
				},
				{
					label: __('Identity'),
					value: 'identity',
					icon: Fingerprint,
					component: markRaw(IdentitySettings),
					condition: jmap,
				},
				{
					label: __('Appearance'),
					value: 'appearance',
					icon: Palette,
					component: markRaw(AppearanceSettings),
				},
			],
		},
		{
			label: __('Mail'),
			items: [
				{
					label: __('Folders'),
					value: 'folders',
					icon: Folders,
					component: markRaw(FolderSettings),
					condition: jmap,
				},
				{
					label: __('Signatures'),
					value: 'signatures',
					icon: Feather,
					component: markRaw(SignatureSettings),
					condition: jmap,
				},
				{
					label: __('Vacation Response'),
					value: 'vacation-response',
					icon: TreePalm,
					component: markRaw(VacationResponseSettings),
					condition: jmap,
				},
				{
					label: __('Automation'),
					value: 'automation',
					icon: Zap,
					component: markRaw(AutomationSettings),
					condition: jmap,
				},
				{
					label: __('Push Subscriptions'),
					value: 'push-subscriptions',
					icon: BellRing,
					component: markRaw(PushSubscriptionSettings),
					condition: jmap,
				},
			],
		},
		{
			label: __('Privacy'),
			items: [
				{
					label: __('Screened Senders'),
					value: 'screened-senders',
					icon: Ban,
					component: markRaw(ScreenedEmailAddressSettings),
					condition: jmap,
				},
			],
		},
		{
			label: __('Data'),
			items: [
				{
					label: __('Import'),
					value: 'import',
					icon: HardDriveDownload,
					component: markRaw(ImportSettings),
					condition: jmap,
				},
				{
					label: __('Export'),
					value: 'export',
					icon: HardDriveUpload,
					component: markRaw(ExportSettings),
					condition: jmap,
				},
			],
		},
		{
			label: __('Developer'),
			items: [
				{
					label: __('Advanced'),
					value: 'advanced',
					icon: Code,
					component: markRaw(AdvancedSettings),
					condition: jmap,
				},
			],
		},
	]

	return groups
		.map((group) => ({
			...group,
			items: group.items.filter((tab) => tab.condition === undefined || tab.condition),
		}))
		.filter((group) => group.items.length > 0)
})

const tabs = computed(() => tabGroups.value.flatMap((group) => group.items))

const activeTab = ref(tabs.value[0]?.value ?? 'profile')

watch(show, (open) => {
	if (!open || !settingsTab.value) return
	const raw = settingsTab.value
	if (raw === __('Block List') || raw === 'Block List') {
		activeTab.value = 'screened-senders'
	} else {
		const match = tabs.value.find((tab) => tab.label === raw || tab.value === raw)
		if (match) activeTab.value = match.value
	}
	settingsTab.value = ''
})

watch(
	tabs,
	(newTabs) => {
		if (!newTabs.length) return
		if (!newTabs.some((tab) => tab.value === activeTab.value)) {
			activeTab.value = newTabs[0].value
		}
	},
	{ immediate: true },
)
</script>
