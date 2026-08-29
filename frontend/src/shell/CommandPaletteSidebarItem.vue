<template>
  <SidebarItem
    :label="__('Search')"
    icon="lucide-search"
    :on-click="() => (root.paletteOpen = true)"
  >
    <template #suffix>
      <span class="mr-2 text-sm text-ink-gray-4">{{ shortcut }}</span>
    </template>
  </SidebarItem>
</template>

<script setup lang="ts">
import { SidebarItem } from 'frappe-ui'

import { useRootStore } from '@/stores/root'

const root = useRootStore()
const shortcut = /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌘ + K' : 'Ctrl + K'
</script>
