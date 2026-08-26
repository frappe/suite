<template>
	<!--
	  Profile as a page rather than a bottom sheet.

	  The sheet made Profile the odd tab out — Inbox, Screener and Search navigate, Profile
	  overlaid — and its Settings row was a pass-through to a page that then carried a Profile
	  row of its own. As a page it can hold that settings list directly, so the tab lands where
	  the sheet's Settings row used to lead: one destination instead of two, with the tab bar
	  still underneath it and the other three tabs one tap away.
	-->
	<div class="relative flex h-full flex-col">
		<!-- Same title row AND the same header box as the other tab destinations — this is
		     one of the four, not a pushed page. The wrapper's paddings are copied verbatim
		     from ScreenerView rather than trimmed to what this view needs: the two headers
		     sit side by side in the tab bar, so they have to measure the same. Its sub-pages
		     keep the compact back-chevron bar. -->
		<header class="flex shrink-0 items-center justify-between border-b px-3 py-2.5 max-sm:p-0 sm:px-5">
			<MobileTitleHeader class="min-w-0 flex-1" :title="__('Profile')" />
		</header>

		<!-- space-y, not a flex column with a gap: flex items in a scroller compress to fit
		     before the scroller ever scrolls. -->
		<div
			class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
		>
			<!-- The identity card is this screen's subject, so it stands in for the Profile
			     row the settings list used to carry — and opens the same tab. -->
			<!-- It stays outside a card: it's the screen's subject, not one more group. -->
			<button
				v-if="profileTab"
				class="active:bg-surface-gray-1 flex w-full items-center gap-3.5 rounded-6 px-1 py-3.5"
				@click="openTab(profileTab)"
			>
				<Avatar :label="fullName" :image="user.data?.user_image" size="2xl" class="size-14" />
				<div class="min-w-0 flex-1 text-left">
					<div class="text-ink-gray-9 truncate text-md !font-semibold">{{ fullName }}</div>
					<div class="text-ink-gray-5 mt-0.5 truncate text-sm">{{ loginId }}</div>
				</div>
				<ChevronRight class="text-ink-gray-4 h-4 w-4 shrink-0" />
			</button>

			<!-- Accounts: tap to switch (no add-account flow on mobile). -->
			<MobileSettingsCard :label="__('Accounts')">
				<MobileSettingsRow
					v-for="account in accounts"
					:key="account.id"
					:label="account._name"
					:chevron="false"
					@click="switchAccount(account.id)"
				>
					<template #leading>
						<Avatar :label="account._name" size="md" />
					</template>
					<template #trailing>
						<Check v-if="account.id === store.accountId" class="text-ink-gray-6 icon shrink-0" />
					</template>
				</MobileSettingsRow>
			</MobileSettingsCard>

			<MobileSettingsCard v-for="group in groups" :key="group.label" :label="group.label">
				<MobileSettingsRow
					v-for="tab in group.items"
					:key="tab.value"
					:icon="tab.icon"
					:label="tab.label"
					@click="openTab(tab)"
				/>
			</MobileSettingsCard>

			<!-- Its own card, the way the destructive row is kept apart on the other screens
			     this list borrows from — no separator needed once every group is a block. -->
			<MobileSettingsCard>
				<MobileSettingsRow
					:icon="LogOut"
					:label="__('Log Out')"
					theme="red"
					:chevron="false"
					@click="showLogoutConfirm = true"
				/>
			</MobileSettingsCard>
		</div>

		<MobileSettingsSubPage :tab="activeTab" @close="closeTab" />

		<!-- In the sheet, logging out took two deliberate steps (open the sheet, tap the red
		     row). Here it's whatever happens to be resting at the bottom of a scroll, so it asks. -->
		<Dialog
			v-model:open="showLogoutConfirm"
		 v-bind="{
				title: __('Log Out'),
				message: __('Are you sure you want to log out?'),
				icon: { name: 'lucide-alert-triangle', theme: 'amber' },
				actions: [{ label: __('Log Out'), theme: 'red', onClick: logout.submit }],
			}"
		/>
	</div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronRight, LogOut } from 'lucide-vue-next'
import { Avatar, Dialog } from 'frappe-ui'

import { useAccountSwitch } from '@/apps/mail/utils/composables'
import { useSettingsTabs, type SettingsTab } from '@/apps/mail/composables/useSettingsTabs'
import { sessionStore } from '@/apps/mail/stores/session'
import { userStore } from '@/apps/mail/stores/user'
import MobileSettingsCard from '@/apps/mail/components/mobile/MobileSettingsCard.vue'
import MobileSettingsRow from '@/apps/mail/components/mobile/MobileSettingsRow.vue'
import MobileSettingsSubPage from '@/apps/mail/components/mobile/MobileSettingsSubPage.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'

const user = inject('$user') as { data: Record<string, any> }

const route = useRoute()
const router = useRouter()
const store = userStore()
const { logout } = sessionStore()

// Profile leaves the list — the identity card above it opens that tab instead.
const { groups, findTab } = useSettingsTabs(['profile'])
const profileTab = computed(() => findTab('profile'))

// Which sub-page is open lives in the URL (?tab=appearance) rather than in a local ref, so
// three things fall out for free: the back gesture closes it, re-tapping the Profile tab can
// pop back to the page root by dropping the query, and a tab that isn't available to this
// account (findTab honours the same conditions the list does) resolves to nothing.
const activeTab = computed<SettingsTab | null>(
	() => (route.query.tab ? findTab(String(route.query.tab)) : null) ?? null,
)
const openTab = (tab?: SettingsTab) => tab && router.push({ query: { tab: tab.value } })
const closeTab = () => router.replace({ query: {} })

const showLogoutConfirm = ref(false)

const accounts = computed(() => store.userResource?.data?.accounts ?? [])
const fullName = computed(() => user.data?.full_name ?? '')
// The login id, not the active account — the card is who you are signed in as, and the
// accounts (any of which could be active) are the list right below it.
const loginId = computed(() => user.data?.name ?? '')

// Shared with the sidebar's account submenu. This route carries an accountId, so
// switching stays on Profile with the new account (see useAccountSwitch).
const { switchAccount } = useAccountSwitch()
</script>
