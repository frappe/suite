<template>
	<!--
	  Profile as a page rather than a bottom sheet.

	  The sheet made Profile the odd tab out — Inbox, Screener and Search navigate, Profile
	  overlaid — and its Settings row was a pass-through to a page that then carried a Profile
	  row of its own. As a page it can hold that settings list directly, so the tab lands where
	  the sheet's Settings row used to lead: one destination instead of two, with the tab bar
	  still underneath it and the other three tabs one tap away.
	-->
	<MobileProfilePage
		:groups
		:find-tab="findTab"
		:accounts
		:account-id="store.accountId"
		always-show-accounts
		:logout
		@switch-account="switchAccount"
	>
		<!-- Same title row AND the same header box as the other tab destinations — this is
		     one of the four, not a pushed page. The wrapper's paddings are copied verbatim
		     from ScreenerView rather than trimmed to what this view needs: the two headers
		     sit side by side in the tab bar, so they have to measure the same. Its sub-pages
		     keep the compact back-chevron bar. -->
		<template #header>
			<header class="flex shrink-0 items-center justify-between border-b px-3 py-2.5 max-sm:p-0 sm:px-5">
				<MobileTitleHeader class="min-w-0 flex-1" :title="__('Profile')" />
			</header>
		</template>
	</MobileProfilePage>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useAccountSwitch } from '@/apps/mail/utils/composables'
import { useSettingsTabs } from '@/apps/mail/composables/useSettingsTabs'
import { sessionStore } from '@/apps/mail/stores/session'
import { userStore } from '@/apps/mail/stores/user'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import MobileProfilePage from '@/components/MobileProfilePage.vue'

const store = userStore()
const { logout } = sessionStore()

// Profile leaves the list — the identity card above it opens that tab instead.
const { groups, findTab } = useSettingsTabs(['profile'])

const accounts = computed(() => store.userResource?.data?.accounts ?? [])

// Shared with the sidebar's account submenu. This route carries an accountId, so
// switching stays on Profile with the new account (see useAccountSwitch).
const { switchAccount } = useAccountSwitch()
</script>
