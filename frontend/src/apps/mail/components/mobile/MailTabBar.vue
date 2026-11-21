<template>
  <!-- Mail's own bottom bar on a phone, where Mail is an app of its own (ticket 047): the
       folder you are in, Search, and your profile. No other apps here: each is its own.
       Profile is Mail's own page: the accounts to switch between, the settings, and Log Out.
       It floats: an island over the page, each tab named under its icon and the one you are on
       lit, and Compose a round
       button over its right end, in the thumb zone. The island keeps its width wherever Compose
       steps aside. It sits in Mail's overlay layer, so the shell's
       bar slot keeps no height and the lists run to the bottom of the screen, under it. It stands
       on whatever else the slot holds (the offer to install), and gives the bottom over to the
       selection bar while mail is selected. It slides away while a list scrolls down
       (`phoneBarsAway`). -->
  <Teleport :to="overlayLayer ?? 'body'">
    <div
      v-if="!isMobileSelectionActive"
      :class="{ 'translate-y-full': away }"
      class="pointer-events-none fixed inset-x-0 bottom-[var(--suite-phone-nav-height,0px)] z-20 flex flex-col transition-transform duration-200 ease-out items-end gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <!-- Not where composing is not the task: search results and the profile page. -->
      <Button
        v-if="!searching && !onProfile"
        variant="solid"
        class="pointer-events-auto !h-14 !w-14 shrink-0 !rounded-full shadow-xl"
        :aria-label="__('Compose')"
        @click="openComposePage(router, store.accountId)"
      >
        <template #icon>
          <span class="lucide-square-pen size-6" aria-hidden="true" />
        </template>
      </Button>
      <nav
        :aria-label="__('Mail')"
        class="bg-surface-elevation-2 pointer-events-auto flex h-14 w-full items-center gap-1 rounded-full border p-1.5 shadow-xl"
      >
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :aria-current="tab.active ? 'page' : undefined"
          class="flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full transition active:scale-95"
          :class="tab.active ? 'bg-surface-gray-3 text-ink-gray-8' : 'text-ink-gray-5'"
          @click="tab.open"
        >
          <Avatar
            v-if="tab.key === 'profile'"
            :image="session.user.value?.avatar ?? undefined"
            :label="accountLabel"
            size="sm"
          />
          <span v-else :class="tab.icon" class="size-5 shrink-0" aria-hidden="true" />
          <span class="max-w-full truncate px-2 text-[11px] !font-semibold">{{ tab.label }}</span>
        </button>
      </nav>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Avatar, Button, usePortalTarget } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { openComposePage } from '@/apps/mail/composables/composeHandoff'
import { usePhoneBarsAway } from '@/apps/mail/composables/phoneBarsAway'
import { userStore } from '@/apps/mail/stores/user'
import { getIcon } from '@/apps/mail/utils'
import { useMobileSearch, useMobileSelection } from '@/apps/mail/utils/composables'
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
const { isMobileSelectionActive } = useMobileSelection()
const overlayLayer = usePortalTarget()
const away = usePhoneBarsAway()

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

const tabs = computed(() => [
  {
    key: 'folder',
    label: folderLabel.value,
    icon: `lucide-${folderIcon.value}`,
    active: inFolder.value,
    open: openFolders,
  },
  {
    key: 'search',
    label: __('Search'),
    icon: 'lucide-search',
    active: searching.value,
    open: openSearch,
  },
  { key: 'profile', label: __('Profile'), icon: '', active: onProfile.value, open: openProfile },
])
</script>
