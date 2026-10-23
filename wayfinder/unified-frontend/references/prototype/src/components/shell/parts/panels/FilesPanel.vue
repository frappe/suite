<!-- Drive's own panel: the saved views over the file tree. -->
<template>
  <div class="flex h-7 items-center">
    <SidebarLabel>Drive</SidebarLabel>
  </div>
  <nav class="mt-0.5 space-y-0.5">
    <SidebarItem
      v-for="item in FOLDERS"
      :key="item.id"
      :label="item.label"
      :icon="item.icon"
      :to="areaTo('files', item.id)"
      :active="folder === item.id"
    />
  </nav>
</template>

<script setup lang="ts">
import { SidebarItem, SidebarLabel } from 'frappe-ui'

import { FOLDERS } from '../../fixtures'
import { useShellNav } from '../../useShellNav'

const { folder, areaTo } = useShellNav()
</script>
