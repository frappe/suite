<template>
  <!-- Mail's own bottom bar on a phone, where Mail is an app of its own (ticket 047): the
       folder you are in, Search, and your profile. No other apps here: each is its own.
       Search and the folders are here, under the thumb, so the title row has neither. -->
  <MobileNav>
    <MobileNavItem :label="folderLabel" :active="!searching" @click="openFolders">
      <span
        :class="[`lucide-${folderIcon}`, searching ? 'text-ink-gray-5' : 'text-ink-gray-8']"
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
    <MobileNavItem :label="__('Profile')" @click="$emit('open-account')">
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
  mailboxIdForParam,
  UNIFIED_ROUTE,
  UNIFIED_THREAD_ROUTE,
} from '@/apps/mail/utils/unifiedFolders'
import { openAreaSidebar } from '@/platform/area-sidebar'
import { useSession } from '@/platform/session'

defineEmits<{ 'open-account': [] }>()

const route = useRoute()
const router = useRouter()
const session = useSession()
const store = userStore()
const { openSearch } = useMobileSearch()

const accountLabel = computed(
  () => session.user.value?.fullName || session.user.value?.id || __('Profile'),
)
const searching = computed(() => route.params.mailbox === 'search')
// The folder the list shows: the tab takes its icon and name, as develop's did.
const current = computed(() => {
  const param = route.params.mailbox
  if (!param || param === 'search') return undefined
  const id = mailboxIdForParam(param, store.mailboxes.data)
  return store.mailboxes.data?.find((m) => m.id === id)
})
const unified = computed(() => [UNIFIED_ROUTE, UNIFIED_THREAD_ROUTE].includes(String(route.name)))
const folderLabel = computed(() =>
  unified.value ? __('All Inboxes') : (current.value?._name ?? __('Inbox')),
)
const folderIcon = computed(() => (current.value ? getIcon(current.value) : 'inbox'))

// Tapped from a folder, it opens the folders; from anywhere else (Search), it goes back to the Inbox.
const openFolders = () => {
  if (current.value || unified.value) return openAreaSidebar('mail')
  void router.push({ name: 'mail-mailbox', params: { ...route.params, mailbox: 'inbox' } })
}
</script>
