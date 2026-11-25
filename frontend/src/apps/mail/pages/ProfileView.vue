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
    :all-accounts="{ active: showingAll, unread: unifiedInbox?.unread_threads }"
    :unread="unifiedInbox?.unread_by_account"
    :logout
    @switch-account="onSwitchAccount"
    @switch-to-all="onSwitchToAll"
  >
    <!-- The title bar every tab of Mail's opens on (Inbox, Search): no line under it. -->
    <template #header>
      <MobileTitleHeader :title="__('Settings')" />
    </template>
    <template #account>
      <MailStorageCard />
    </template>
  </MobileProfilePage>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import MailStorageCard from '@/apps/mail/components/mobile/MailStorageCard.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import { sessionStore } from '@/apps/mail/stores/session'
import { userStore } from '@/apps/mail/stores/user'
import { useAccountSwitch } from '@/apps/mail/utils/composables'
import { prefersUnified } from '@/apps/mail/utils/unifiedFolders'
import MobileProfilePage from '@/components/MobileProfilePage.vue'

const store = userStore()
const { logout } = sessionStore()

const accounts = computed(() => store.userResource?.data?.accounts ?? [])
// What is unread in each account's Inbox, and across them all. A system folder's slug is its role.
const unifiedInbox = computed(() =>
  store.unifiedFolders.data?.find((folder) => folder.slug === 'inbox'),
)

// Shared with the sidebar's account submenu. This route carries an accountId, so
// switching stays on Profile with the new account (see useAccountSwitch).
const { switchAccount, switchToAll } = useAccountSwitch()
// Whether the reader has every account showing at once: the lists open that way until an account
// is picked. Picking either stays here, as switching does on any page.
const showingAll = ref(prefersUnified())
const onSwitchAccount = (accountId: string) => {
  showingAll.value = false
  void switchAccount(accountId)
}
const onSwitchToAll = () => {
  showingAll.value = true
  switchToAll()
}
</script>
