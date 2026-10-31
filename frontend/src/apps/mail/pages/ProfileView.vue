<template>
  <!--
	  Profile as a page rather than a bottom sheet.

	  The sheet made Profile the odd tab out — Inbox, Screener and Search navigate, Profile
	  overlaid — and its Settings row was a pass-through to a page that then carried a Profile
	  row of its own. As a page it can hold that settings list directly, so the tab lands where
	  the sheet's Settings row used to lead: one destination instead of two, with the bottom
	  nav still underneath it.
	-->
  <MobileProfilePage
    :accounts
    :account-id="store.accountId"
    app="mail"
    always-show-accounts
    :all-accounts="{ active: showingAll }"
    :logout
    @switch-account="onSwitchAccount"
    @switch-to-all="switchToAll"
  >
    <!-- Same title row AND the same header box as the other tab destinations — this is
		     one of the four, not a pushed page. The wrapper's paddings are copied verbatim
		     from ScreenerView rather than trimmed to what this view needs: the two headers
		     are reached from the same sheet, so they have to measure the same. Its sub-pages
		     keep the compact back-chevron bar. -->
    <template #header>
      <header
        class="flex shrink-0 items-center justify-between border-b px-3 py-2.5 max-sm:p-0 sm:px-5"
      >
        <MobileTitleHeader class="min-w-0 flex-1" :title="__('Profile')" />
      </header>
    </template>
  </MobileProfilePage>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import { sessionStore } from '@/apps/mail/stores/session'
import { userStore } from '@/apps/mail/stores/user'
import { useAccountSwitch } from '@/apps/mail/utils/composables'
import { prefersUnified } from '@/apps/mail/utils/unifiedFolders'
import MobileProfilePage from '@/components/MobileProfilePage.vue'

const store = userStore()
const { logout } = sessionStore()

const accounts = computed(() => store.userResource?.data?.accounts ?? [])

// Shared with the sidebar's account submenu. This route carries an accountId, so
// switching stays on Profile with the new account (see useAccountSwitch).
const { switchAccount, switchToAll } = useAccountSwitch()
// Whether the reader has every account showing at once: the lists open that way until an account
// is picked. "All accounts" opens the merged Inbox.
const showingAll = ref(prefersUnified())
const onSwitchAccount = (accountId: string) => {
  showingAll.value = false
  void switchAccount(accountId)
}
</script>
