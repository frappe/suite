<template>
  <!-- People's own sidebar, in the shell's sidebar slot on a desktop and in the
	     bottom nav's sheet on a phone. -->
  <AreaSidebar area="people" :title="__('People')">
    <!-- The active account leads. With one account there is nothing to pick: it is just named. -->
    <AccountSwitcher
      :accounts="accounts"
      :active-id="store.accountId"
      :label="accountName || __('Account')"
      @select="switchAccount"
    />
    <SidebarSection class="!mt-4">
      <SidebarItem
        v-for="item in items"
        :key="item.route.name"
        :label="item.label"
        :icon="item.icon"
        :route="item.route"
        :active="item.activeFor.includes(String(route.name))"
      />
    </SidebarSection>
  </AreaSidebar>
</template>

<script setup lang="ts">
import BookUser from '~icons/lucide/book-user'
import ContactRound from '~icons/lucide/contact-round'
import { SidebarItem, SidebarSection } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { userStore } from '@/apps/people/stores/user'
import { AccountSwitcher, AreaSidebar } from '@/platform/area-sidebar'

const route = useRoute()
const router = useRouter()
const store = userStore()

const accounts = computed(() => store.userResource.data?.accounts ?? [])
const accountName = computed(
  () => accounts.value.find((a: { id: string }) => a.id === store.accountId)?._name ?? '',
)

// Another account has other contacts and address books, so switching leaves an open one for
// the list it was in.
const listFor = (name: string) =>
  name.startsWith('people-address-book') ? 'people-address-books' : 'people-contacts'
const switchAccount = (accountId: string) =>
  router.push({ name: listFor(String(route.name)), params: { accountId } })

const items = computed(() => [
  {
    label: __('Contacts'),
    icon: ContactRound,
    route: { name: 'people-contacts', params: { accountId: store.accountId } },
    activeFor: ['people-contacts', 'people-contact'],
  },
  {
    label: __('Address Books'),
    icon: BookUser,
    route: { name: 'people-address-books', params: { accountId: store.accountId } },
    activeFor: ['people-address-books', 'people-address-book'],
  },
])
</script>
