<template>
  <div class="h-full min-h-0">
    <AreaSidebar area="admin" :title="__('Suite Admin')">
      <nav class="space-y-0.5" :aria-label="__('Administration')">
        <SidebarItem
          v-for="item in navigation"
          :key="item.to"
          :route="item.to"
          :label="item.label"
          :icon="item.icon"
          :active="item.to === '/admin' ? route.path === '/admin' : route.path.startsWith(item.to)"
        />
        <template v-for="group in groups" :key="group.label">
          <h2 class="px-2 pb-1 pt-5 text-xs font-medium text-ink-gray-5">{{ group.label }}</h2>
          <SidebarItem
            v-for="item in group.items"
            :key="item.to"
            :route="item.to"
            :label="item.label"
            :icon="item.icon"
            :active="route.path.startsWith(item.to)"
          />
        </template>
      </nav>
    </AreaSidebar>
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { SidebarItem } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { api, useQuery } from '@/api'
import { AreaSidebar } from '@/platform/area-sidebar'
import { translate as __ } from '@/platform/translation'

const storage = useQuery(api.suite.storage.get)
const route = useRoute()
const navigation = [
  { to: '/admin', label: __('Overview'), icon: 'lucide-layout-dashboard' },
  { to: '/admin/users', label: __('Users'), icon: 'lucide-users' },
  { to: '/admin/storage', label: __('Storage'), icon: 'lucide-hard-drive' },
]
const groups = computed(() => [
  ...(storage.data?.cloud
    ? [
        {
          label: __('Mail'),
          items: [
            { to: '/admin/mail/invitations', label: __('Invitations'), icon: 'lucide-mail-plus' },
            { to: '/admin/mail/domains', label: __('Domains'), icon: 'lucide-globe' },
            { to: '/admin/mail/groups', label: __('Groups'), icon: 'lucide-users-round' },
            { to: '/admin/mail/mailing-lists', label: __('Mailing lists'), icon: 'lucide-list' },
            { to: '/admin/mail/dmarc', label: __('DMARC reports'), icon: 'lucide-shield' },
            { to: '/admin/mail/tls', label: __('TLS reports'), icon: 'lucide-lock' },
          ],
        },
      ]
    : []),
  {
    label: __('Settings'),
    items: [{ to: '/admin/settings', label: __('General'), icon: 'lucide-settings' }],
  },
])
</script>
