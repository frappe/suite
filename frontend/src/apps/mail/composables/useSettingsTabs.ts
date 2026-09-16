import { computed, inject, markRaw } from 'vue'

import { settingsGroups } from '@/composables/settingsGroups'
import {
	BellRing,
	Eye,
	Feather,
	Fingerprint,
	Folders,
	Mailbox,
	Columns2,
	PenLine,
	TreePalm,
} from 'lucide-vue-next'

import Account from '@/apps/mail/components/Settings/Account.vue'
import MailLayoutSettings from '@/apps/mail/components/Settings/MailLayoutSettings.vue'
import ComposeSettings from '@/apps/mail/components/Settings/ComposeSettings.vue'
import FolderSettings from '@/apps/mail/components/Settings/FolderSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import ScreenedEmailAddressSettings from '@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'
import { getVisibleSettingsGroups } from '@/components/settings/settingsCatalog'
import type { SettingsGroup, SettingsTab } from '@/components/settings/types'
import { useCommonSettingsGroups } from '@/components/settings/useCommonSettingsGroups'
import { useScreenSize } from '@/apps/mail/utils/composables'

export type { SettingsTab } from '@/components/settings/types'

export const useSettingsTabs = (exclude: string[] = []) => {
	const user = inject('$user') as { data: Record<string, any> }
	const commonGroups = useCommonSettingsGroups()
	const { isMobile } = useScreenSize()

	const allGroups = computed(() => {
		const jmap = () => Boolean(user.data?.is_jmap_configured)
		const mailGroups: SettingsGroup[] = [
			{
				id: 'mail-general',
				label: __('Mail account'),
				items: [
					{ label: __('Account'), value: 'account', icon: Mailbox, component: markRaw(Account), condition: jmap },
					{ label: __('Identity'), value: 'identity', icon: Fingerprint, component: markRaw(IdentitySettings), condition: jmap },
					{
						label: __('Mail layout'),
						value: 'mail-layout',
						icon: Columns2,
						component: markRaw(MailLayoutSettings),
						condition: () => jmap() && !isMobile.value,
					},
					{ label: __('Notifications'), value: 'notifications', icon: BellRing },
				],
			},
			{
				id: 'mail',
				label: __('Mail'),
				items: [
					{ label: __('Folders'), value: 'folders', icon: Folders, component: markRaw(FolderSettings), condition: jmap },
					{ label: __('Signatures'), value: 'signatures', icon: Feather, component: markRaw(SignatureSettings), condition: jmap },
					{ label: __('Compose'), value: 'compose', icon: PenLine, component: markRaw(ComposeSettings), condition: jmap },
					{ label: __('Vacation Response'), value: 'vacation-response', icon: TreePalm, component: markRaw(VacationResponseSettings), condition: jmap },
				],
			},
			{
				id: 'mail-privacy',
				label: __('Privacy'),
				items: [
					{ label: __('Screener'), value: 'screened-senders', icon: Eye, component: markRaw(ScreenedEmailAddressSettings), condition: jmap },
				],
			},
		]

		const translatedCommonGroups = commonGroups.value.map((group) => ({
			...group,
			label: __(group.label),
			items: group.items.map((tab) => ({ ...tab, label: __(tab.label) })),
		}))

		return getVisibleSettingsGroups([...translatedCommonGroups, ...mailGroups])
	})

	return settingsGroups(allGroups, exclude)
}
