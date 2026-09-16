import { computed, inject, markRaw, type Component } from 'vue'

import { settingsGroups } from '@/composables/settingsGroups'
import {
	BellRing,
	Eye,
	Feather,
	Fingerprint,
	Folders,
	Mailbox,
	Palette,
	PenLine,
	TreePalm,
	User,
} from 'lucide-vue-next'

import Account from '@/apps/mail/components/Settings/Account.vue'
import AppearanceSettings from '@/apps/mail/components/Settings/AppearanceSettings.vue'
import ComposeSettings from '@/apps/mail/components/Settings/ComposeSettings.vue'
import FolderSettings from '@/apps/mail/components/Settings/FolderSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import ProfileSettings from '@/apps/mail/components/Settings/ProfileSettings.vue'
import ScreenedEmailAddressSettings from '@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'

export type SettingsTab = {
	label: string
	value: string
	icon: Component
	component?: Component
	condition?: boolean
}

/**
 * The mobile settings list, shared by both of its entry points: ProfileView, which
 * renders these groups as the Profile tab's own contents, and PWASettings, the pushed
 * page the sidebar and the in-thread Block List / Screener links still open. One list,
 * so the two can't drift.
 *
 * It is a subset of the desktop dialog's tabs — Credentials/Identity/Automation/
 * Import/Export/Advanced stay desktop-only (rare, file-heavy, or developer tasks).
 *
 * `exclude` drops rows by value: the Profile page leaves out Profile, because the
 * identity card at the top of it is what leads there.
 */
export const useSettingsTabs = (exclude: string[] = []) => {
	const user = inject('$user') as { data: Record<string, any> }

	const allGroups = computed(() => {
		const jmap = !!user.data?.is_jmap_configured

		return [
			{
				label: __('General'),
				items: [
					{ label: __('Profile'), value: 'profile', icon: User, component: markRaw(ProfileSettings) },
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
					// Per-browser-installation state: toggling push affects only this device.
					{ label: __('Notifications'), value: 'notifications', icon: BellRing },
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
						label: __('Compose'),
						value: 'compose',
						icon: PenLine,
						component: markRaw(ComposeSettings),
						condition: jmap,
					},
					{
						label: __('Vacation Response'),
						value: 'vacation-response',
						icon: TreePalm,
						component: markRaw(VacationResponseSettings),
						condition: jmap,
					},
				],
			},
			{
				label: __('Privacy'),
				items: [
					{
						label: __('Screener'),
						value: 'screened-senders',
						icon: Eye,
						component: markRaw(ScreenedEmailAddressSettings),
						condition: jmap,
					},
				],
			},
		]
			.map((group) => ({
				...group,
				items: group.items.filter((tab) => tab.condition === undefined || tab.condition),
			}))
			.filter((group) => group.items.length > 0)
	})

	return settingsGroups(allGroups, exclude)
}
