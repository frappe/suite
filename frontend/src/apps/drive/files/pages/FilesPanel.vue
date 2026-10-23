<template>
  <div>
    <SidebarSection label="Locations" class="!mt-0">
      <SidebarItem
        label="My files"
        icon="lucide-folder"
        route="/drive"
        :active="current === 'personal'"
      />
      <SidebarItem
        v-if="discovered.data?.organization"
        label="Organization files"
        icon="lucide-building-2"
        route="/drive/organization"
        :active="current === 'organization'"
      />
    </SidebarSection>
    <SidebarSection label="Views" class="!mt-4">
      <SidebarItem
        label="Shared with me"
        icon="lucide-users"
        route="/drive/shared-with-me"
        :active="current === 'shared'"
      />
      <SidebarItem label="Recent" icon="lucide-clock-3" route="/drive/recent" />
      <SidebarItem label="Starred" icon="lucide-star" route="/drive/starred" />
      <SidebarItem
        label="Trash"
        icon="lucide-trash-2"
        route="/drive/trash"
        :active="current === 'trash' || undefined"
      />
    </SidebarSection>
    <AreaSidebarFooter>
      <StorageMeter />
    </AreaSidebarFooter>
  </div>
</template>

<script setup lang="ts">
import { SidebarItem, SidebarSection } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { api, useQuery } from '@/api'
import StorageMeter from '@/apps/drive/files/features/StorageMeter.vue'
import { locationOf, type FilesLocation } from '@/apps/drive/files/internal/locations'
import { AreaSidebarFooter } from '@/platform/area-sidebar'

const route = useRoute()
const discovered = useQuery(api.drive.roots.list, {})
const folderId = computed(() =>
  route.name === 'files-folder' ? String(route.params.node ?? '') : '',
)
// The same read the folder page makes, so it costs no extra request.
const folder = useQuery(api.drive.nodes.get, () =>
  folderId.value ? { node: folderId.value, expand: 'access,breadcrumbs' } : false,
)

/** The location whose item stays lit, also inside one of its folders. A trashed folder is reached from Trash. */
const current = computed<FilesLocation | 'trash' | null>(() => {
  if (route.name === 'files') return 'personal'
  if (route.name === 'files-organization') return 'organization'
  if (route.name === 'files-shared-with-me') return 'shared'
  if (!folderId.value || !folder.data) return null
  if (folder.data.state === 'Trashed') return 'trash'
  return locationOf(folder.data, discovered.data)
})
</script>
