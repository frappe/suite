<template>
	<div class="bg-surface-base fixed inset-0 z-20 flex flex-col pt-[env(safe-area-inset-top)]">
		<!-- Root bar — same compact-header recipe as ThreadHeader: -ml-2 cancels
		     the ghost button's padding so the chevron glyph lands on the body's
		     px-3 axis. -->
		<div class="bg-surface-base flex min-h-14 shrink-0 items-center border-b px-3">
			<Button variant="ghost" class="-ml-2 mr-2 !h-8 !w-8 shrink-0" @click="emit('close')">
				<template #icon>
					<ChevronLeft class="icon !h-[18px] !w-[18px]" />
				</template>
			</Button>

			<h2 class="text-xl-semibold min-w-0 flex-1 truncate leading-5">{{ __('Settings') }}</h2>
		</div>

		<!-- Root: grouped section list mirroring the desktop dialog's groups -->
		<div class="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
			<template v-for="group in groups" :key="group.label">
				<div class="text-ink-gray-5 px-1 pb-1 pt-3 text-sm">{{ group.label }}</div>
				<button
					v-for="tab in group.items"
					:key="tab.value"
					class="active:bg-surface-gray-1 text-ink-gray-8 flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-base"
					@click="activeTab = tab"
				>
					<component :is="tab.icon" class="text-ink-gray-6 h-4 w-4 shrink-0" />
					<span class="flex-1 truncate text-left">{{ tab.label }}</span>
					<ChevronRight class="text-ink-gray-4 h-4 w-4 shrink-0" />
				</button>
			</template>
		</div>

		<!-- Sub-page: a full-height layer with its own bar, so the entire page
		     (bar included) slides in as one — same push as the thread pane. -->
		<Transition
			enter-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
			enter-from-class="translate-x-full"
			leave-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
			leave-to-class="translate-x-full"
		>
			<div
				v-if="activeTab"
				class="bg-surface-base absolute inset-0 flex flex-col pt-[env(safe-area-inset-top)]"
			>
				<div class="bg-surface-base flex min-h-14 shrink-0 items-center border-b px-3">
					<Button variant="ghost" class="-ml-2 mr-2 !h-8 !w-8 shrink-0" @click="activeTab = null">
						<template #icon>
							<ChevronLeft class="icon !h-[18px] !w-[18px]" />
						</template>
					</Button>

					<h2 class="text-xl-semibold min-w-0 flex-1 truncate leading-5">
						{{ activeTab.label }}
					</h2>

					<!-- Sub-page actions (e.g. Save) teleport here from AppSettingsHeader —
					     nav-bar placement; the target lives in this layer, so actions slide
					     out with the page. -->
					<div id="app-settings-page-actions" class="flex shrink-0 items-center gap-2" />
				</div>

				<div class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
					<!-- Notifications is PWA-specific, so it lives here instead of the
					     shared Settings/ components. -->
					<div v-if="activeTab.value === 'notifications'" class="px-4 py-2">
						<SettingsRow :title="__('Enable Push Notifications')" :description>
							<Switch
								size="md"
								:model-value="isPushNotificationsSettingEnabled"
								:disabled="!isPushNotificationEnabled || isLoading"
								@update:model-value="togglePushNotifications"
							/>
						</SettingsRow>

						<div v-if="isLoading" class="-mt-0.5 flex items-center gap-2">
							<LoadingIndicator class="text-ink-gray-7 h-3 w-3" />
							<span class="text-sm">
								{{
									isPushNotificationsSettingEnabled
										? __('Disabling Push Notifications...')
										: __('Enabling Push Notifications...')
								}}
							</span>
						</div>
					</div>
					<component :is="activeTab.component" v-else />
				</div>
			</div>
		</Transition>
	</div>
</template>

<script setup lang="ts">
import { computed, inject, markRaw, provide, ref, type Component } from 'vue'
import {
	BellRing,
	ChevronLeft,
	ChevronRight,
	Eye,
	Feather,
	Fingerprint,
	Folders,
	Mailbox,
	Palette,
	TreePalm,
	User,
} from 'lucide-vue-next'
import { Button, LoadingIndicator, SettingsRow, Switch, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import Account from '@/apps/mail/components/Settings/Account.vue'
import AppearanceSettings from '@/apps/mail/components/Settings/AppearanceSettings.vue'
import FolderSettings from '@/apps/mail/components/Settings/FolderSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import ProfileSettings from '@/apps/mail/components/Settings/ProfileSettings.vue'
import ScreenedEmailAddressSettings from '@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'

type SettingsTab = {
	label: string
	value: string
	icon: Component
	component?: Component
	condition?: boolean
}

const emit = defineEmits(['close'])

// Embedded Settings/* components render AppSettingsHeader/Body; this flag makes
// those wrappers use page paddings and drop the duplicate section title (the
// top bar here carries it).
provide('app-settings-mobile-page', true)

const user = inject('$user') as { data: Record<string, any> }

const activeTab = ref<SettingsTab | null>(null)

// Mobile subset of the desktop dialog's tabs: Credentials/Identity/Automation/
// Import/Export/Advanced stay desktop-only (rare, file-heavy, or developer tasks).
const groups = computed(() => {
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

const isPushNotificationsSettingEnabled = ref(
	window.frappePushNotification?.isNotificationEnabled(),
)
const isLoading = ref(false)

const isPushNotificationEnabled = computed(
	() => window.push_relay_server_url && isPushNotificationRelayEnabled.data,
)

const description = computed(() =>
	!isPushNotificationEnabled.value
		? __('Push notifications have been disabled on your site')
		: '',
)

const togglePushNotifications = async (isEnabled: boolean) => {
	if (isEnabled) return enablePushNotifications()

	isLoading.value = true
	try {
		await window.frappePushNotification.disableNotification()
		isPushNotificationsSettingEnabled.value = false
		raiseToast(__('Push notifications disabled'))
	} catch (error) {
		raiseToast(__(error.message), 'error')
	}
	isLoading.value = false
}

const enablePushNotifications = async () => {
	isLoading.value = true
	try {
		const data = await window.frappePushNotification.enableNotification()
		if (data.permission_granted) isPushNotificationsSettingEnabled.value = true
		else {
			raiseToast(__('Push Notification permission denied'), 'error')
			isPushNotificationsSettingEnabled.value = false
		}
	} catch (error) {
		raiseToast(__(error.message), 'error')
		isPushNotificationsSettingEnabled.value = false
	}
	isLoading.value = false
}

const isPushNotificationRelayEnabled = createResource({
	url: 'suite.mail.api.account.is_push_notification_relay_enabled',
	cache: 'mail:push_notifications_enabled',
	auto: true,
})
</script>
