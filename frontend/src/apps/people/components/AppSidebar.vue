<template>
  <!-- People's own sidebar, in the shell's sidebar slot on a desktop and in the
	     bottom nav's sheet on a phone. -->
  <AreaSidebar area="people" :title="__('People')">
    <!-- The active account leads. With one account there is nothing to pick: it is just named. -->
    <SidebarSection class="!mt-0">
      <Dropdown v-if="accounts.length > 1" :options="accountMenu" :match-trigger-width="true">
        <SidebarItem :label="accountName || __('Account')" icon="lucide-circle-user-round">
          <template #suffix>
            <span
              class="lucide-chevrons-up-down mr-2 size-3.5 text-ink-gray-5"
              aria-hidden="true"
            />
          </template>
        </SidebarItem>
      </Dropdown>
      <SidebarItem v-else :label="accountName || __('Account')" icon="lucide-circle-user-round" />
    </SidebarSection>
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
import { Dropdown, SidebarItem, SidebarSection } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { userStore } from '@/apps/people/stores/user'
import { accountSubmenu, AreaSidebar } from '@/platform/area-sidebar'

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
const accountMenu = computed(() =>
  accountSubmenu(accounts.value, store.accountId, (accountId) =>
    router.push({ name: listFor(String(route.name)), params: { accountId } }),
  ),
)

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
