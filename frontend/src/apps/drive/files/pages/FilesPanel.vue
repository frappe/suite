<template>
  <div>
    <div class="flex h-7 items-center"><SidebarLabel>Locations</SidebarLabel></div>
    <nav class="mt-0.5 space-y-0.5" aria-label="File locations">
      <SidebarItem label="My files" icon="lucide-folder" route="/drive" />
      <SidebarItem v-if="discovered.data?.organization" label="Organization files" icon="lucide-building-2" route="/drive/organization" />
    </nav>
    <div class="mt-5 flex h-7 items-center"><SidebarLabel>Views</SidebarLabel></div>
    <nav class="mt-0.5 space-y-0.5" aria-label="File views">
      <SidebarItem label="Shared with me" icon="lucide-users" route="/drive/shared-with-me" />
      <SidebarItem label="Recent" icon="lucide-clock-3" route="/drive/recent" />
      <SidebarItem label="Starred" icon="lucide-star" route="/drive/starred" />
      <div class="my-2 border-t border-outline-gray-1" />
      <SidebarItem label="Trash" icon="lucide-trash-2" route="/drive/trash" />
    </nav>
  </div>
</template>

<script setup lang="ts">
import { SidebarItem, SidebarLabel } from 'frappe-ui'
import { roots } from '@/apps/drive/client/roots'
import { useQuery } from '@/platform/server-state'

const discovered = useQuery(roots())
</script>
