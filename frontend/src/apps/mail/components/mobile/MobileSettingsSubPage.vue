<template>
	<!-- A settings tab as a full-height layer with its own bar, so the entire page
	     (bar included) slides in as one — same push as the thread pane. It fills
	     whichever box its host owns: over the settings overlay that's the screen,
	     on the Profile page it stops above the tab bar. -->
	<Transition
		enter-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
		enter-from-class="translate-x-full"
		leave-active-class="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
		leave-to-class="translate-x-full"
	>
		<div
			v-if="tab"
			class="bg-surface-base absolute inset-0 z-10 flex flex-col"
			:class="{ 'pt-[env(safe-area-inset-top)]': safeAreaTop }"
		>
			<!-- Same bar as the tab destinations' title row (h-14, 2xl semibold), so a pushed
			     page reads as the same surface at a different depth. -->
			<div class="bg-surface-base flex h-14 shrink-0 items-center border-b px-3">
				<Button variant="ghost" class="-ml-2 mr-2 !h-8 !w-8 shrink-0" @click="emit('close')">
					<template #icon>
						<ChevronLeft class="icon !h-[18px] !w-[18px]" />
					</template>
				</Button>

				<h2 class="min-w-0 flex-1 truncate text-xl !font-semibold tracking-[-0.01em]">
					{{ tab.label }}
				</h2>

				<!-- Sub-page actions (e.g. Save) teleport here from AppSettingsHeader —
				     nav-bar placement; the target lives in this layer, so actions slide
				     out with the page. -->
				<div id="app-settings-page-actions" class="flex shrink-0 items-center gap-2" />
			</div>

			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
				<!-- Notifications is PWA-specific, so it lives here instead of the
				     shared Settings/ components. -->
				<div v-if="tab.value === 'notifications'" class="px-4 py-2">
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
				<component :is="tab.component" v-else />
			</div>
		</div>
	</Transition>
</template>

<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { ChevronLeft } from 'lucide-vue-next'
import { Button, LoadingIndicator, SettingsRow, Switch, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

import type { SettingsTab } from '@/apps/mail/composables/useSettingsTabs'

// `safeAreaTop` belongs to hosts that escape the app shell — PWASettings is teleported
// to the body and fixed, so it owns the notch itself. Inside the layout the shell has
// already paid that padding once.
defineProps<{ tab: SettingsTab | null; safeAreaTop?: boolean }>()

const emit = defineEmits(['close'])

// Embedded Settings/* components render AppSettingsHeader/Body; this flag makes
// those wrappers use page paddings and drop the duplicate section title (the
// top bar here carries it).
provide('app-settings-mobile-page', true)

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
