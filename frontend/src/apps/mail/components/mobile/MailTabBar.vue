<template>
  <!-- Mail's own bottom bar on a phone, where Mail is an app of its own (ticket 047): the
       folder you are in, Search, and your profile. No other apps here: each is its own.
       Profile is Mail's own page: the accounts to switch between, the settings, and Log Out. -->
  <MobileNav>
    <MobileNavItem :label="folderLabel" :active="inFolder" @click="openFolders">
      <span
        :class="[`lucide-${folderIcon}`, inFolder ? 'text-ink-gray-8' : 'text-ink-gray-5']"
        class="size-6"
        aria-hidden="true"
      />
    </MobileNavItem>
    <MobileNavItem :label="__('Search')" :active="searching" @click="openSearch">
      <span
        class="lucide-search size-6"
        :class="searching ? 'text-ink-gray-8' : 'text-ink-gray-5'"
        aria-hidden="true"
      />
    </MobileNavItem>
    <MobileNavItem :label="__('Profile')" :active="onProfile" @click="openProfile">
      <Avatar :image="session.user.value?.avatar ?? undefined" :label="accountLabel" size="md" />
    </MobileNavItem>
  </MobileNav>
</template>

<script setup lang="ts">
import { Avatar, MobileNav, MobileNavItem } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'
import { getIcon } from '@/apps/mail/utils'
import { useMobileSearch } from '@/apps/mail/utils/composables'
import {
  INBOX_FOLDER,
  mailboxIdForParam,
  prefersUnified,
  STARRED_FOLDER,
  UNIFIED_ROUTE,
  UNIFIED_THREAD_ROUTE,
  unifiedFolderIcon,
  unifiedFolderLabel,
  unifiedFolderRoute,
} from '@/apps/mail/utils/unifiedFolders'
import { openAreaSidebar } from '@/platform/area-sidebar'
import { useSession } from '@/platform/session'

const route = useRoute()
const router = useRouter()
const session = useSession()
const store = userStore()
const { openSearch } = useMobileSearch()

const accountLabel = computed(
  () => session.user.value?.fullName || session.user.value?.id || __('Profile'),
)
const searching = computed(() => route.params.mailbox === 'search')
const onProfile = computed(() => route.name === 'mail-profile')
const inFolder = computed(() => !searching.value && !onProfile.value)
const openProfile = () =>
  void router.push({ name: 'mail-profile', params: { accountId: store.accountId } })
// The folder the list shows: the tab takes its icon and name, as develop's did.
const current = computed(() => {
  const param = route.params.mailbox
  if (!param || param === 'search') return undefined
  const id = mailboxIdForParam(param, store.mailboxes.data)
  return store.mailboxes.data?.find((m) => m.id === id)
})
const starred = computed(() => route.params.mailbox === STARRED_FOLDER)
// A folder merged across the accounts, by its slug.
const unified = computed(() =>
  [UNIFIED_ROUTE, UNIFIED_THREAD_ROUTE].includes(String(route.name))
    ? String(route.params.folder)
    : undefined,
)
const folderLabel = computed(() => {
  if (unified.value) return unifiedFolderLabel(unified.value, store.unifiedFolders.data)
  if (starred.value) return __('Starred')
  return current.value?._name ?? __('Inbox')
})
const folderIcon = computed(() => {
  if (unified.value) return unifiedFolderIcon(unified.value, store.unifiedFolders.data)
  if (starred.value) return 'star'
  return current.value ? getIcon(current.value) : 'inbox'
})

// Tapped from a folder, it opens the folders; from anywhere else (Search, Profile), it goes back to
// the Inbox: every account's, for a reader who chose All accounts and still has more than one.
const openFolders = () => {
  if (current.value || unified.value || starred.value) return openAreaSidebar('mail')
  const accounts = store.userResource?.data?.accounts?.length ?? 0
  void router.push(
    prefersUnified() && accounts > 1
      ? unifiedFolderRoute(INBOX_FOLDER)
      : { name: 'mail-mailbox', params: { accountId: store.accountId, mailbox: INBOX_FOLDER } },
  )
}
</script>
