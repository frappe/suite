<template>
	<SuiteSettingsDialog v-model:open="open" v-model:tab="activeTab" :groups="groups" />
</template>

<script setup lang="ts">
import { computed, inject, markRaw, ref, watch } from 'vue'
import {
	BellRing,
	Code,
	Eye,
	Feather,
	Fingerprint,
	Folders,
	HardDriveDownload,
	HardDriveUpload,
	KeyRound,
	Mailbox,
	Columns2,
	PenLine,
	TreePalm,
	Zap,
} from 'lucide-vue-next'

import Account from '@/apps/mail/components/Settings/Account.vue'
import AdvancedSettings from '@/apps/mail/components/Settings/AdvancedSettings.vue'
import MailLayoutSettings from '@/apps/mail/components/Settings/MailLayoutSettings.vue'
import AutomationSettings from '@/apps/mail/components/Settings/AutomationSettings.vue'
import ComposeSettings from '@/apps/mail/components/Settings/ComposeSettings.vue'
import CredentialsSettings from '@/apps/mail/components/Settings/CredentialsSettings.vue'
import ExportSettings from '@/apps/mail/components/Settings/ExportSettings.vue'
import FolderSettings from '@/apps/mail/components/Settings/FolderSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import ImportSettings from '@/apps/mail/components/Settings/ImportSettings.vue'
import PushSubscriptionSettings from '@/apps/mail/components/Settings/PushSubscriptionSettings.vue'
import ScreenedEmailAddressSettings from '@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'
import { useSettings } from '@/apps/mail/utils/composables'
import type { SettingsGroup } from '@/components/settings/types'
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'

const open = defineModel<boolean>('open', { default: false })
const activeTab = ref('profile')
const { settingsTab } = useSettings()
const user = inject('$user') as { data: Record<string, any> }

const groups = computed<SettingsGroup[]>(() => {
	const jmap = () => Boolean(user.data.is_jmap_configured)
	return [
		{
			id: 'mail-account',
			label: 'Mail account',
			items: [
				{ label: 'Credentials', value: 'credentials', icon: KeyRound, component: markRaw(CredentialsSettings) },
				{ label: 'Account', value: 'account', icon: Mailbox, component: markRaw(Account), condition: jmap },
				{ label: 'Identity', value: 'identity', icon: Fingerprint, component: markRaw(IdentitySettings), condition: jmap },
				{ label: 'Mail layout', value: 'mail-layout', icon: Columns2, component: markRaw(MailLayoutSettings), condition: jmap },
			],
		},
		{
			id: 'mail',
			label: 'Mail',
			items: [
				{ label: 'Folders', value: 'folders', icon: Folders, component: markRaw(FolderSettings), condition: jmap },
				{ label: 'Signatures', value: 'signatures', icon: Feather, component: markRaw(SignatureSettings), condition: jmap },
				{ label: 'Compose', value: 'compose', icon: PenLine, component: markRaw(ComposeSettings), condition: jmap },
				{ label: 'Vacation Response', value: 'vacation-response', icon: TreePalm, component: markRaw(VacationResponseSettings), condition: jmap },
				{ label: 'Automation', value: 'automation', icon: Zap, component: markRaw(AutomationSettings), condition: jmap },
				{ label: 'Push Subscriptions', value: 'push-subscriptions', icon: BellRing, component: markRaw(PushSubscriptionSettings), condition: jmap },
			],
		},
		{
			id: 'mail-privacy',
			label: 'Privacy',
			items: [
				{ label: 'Screener', value: 'screened-senders', icon: Eye, component: markRaw(ScreenedEmailAddressSettings), condition: jmap },
			],
		},
		{
			id: 'mail-data',
			label: 'Data',
			items: [
				{ label: 'Import', value: 'import', icon: HardDriveDownload, component: markRaw(ImportSettings), condition: jmap },
				{ label: 'Export', value: 'export', icon: HardDriveUpload, component: markRaw(ExportSettings), condition: jmap },
			],
		},
		{
			id: 'mail-developer',
			label: 'Developer',
			items: [
				{ label: 'Advanced', value: 'advanced', icon: Code, component: markRaw(AdvancedSettings), condition: jmap },
			],
		},
	]
})

watch(open, (isOpen) => {
	if (!isOpen || !settingsTab.value) return
	const requested = settingsTab.value
	activeTab.value =
		requested === __('Block List') || requested === 'Block List'
			? 'screened-senders'
			: groups.value
					.flatMap((group) => group.items)
					.find((tab) => tab.value === requested || __(tab.label) === requested)?.value || activeTab.value
	settingsTab.value = ''
})
</script>
