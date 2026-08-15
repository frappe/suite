<!--
  PROTOTYPE — remove. Workspace switcher at the top of the contextual panel.
  `show-logo="false"` is SidebarHeader's documented answer to a left rail that
  already carries workspace identity — no second avatar.
-->
<template>
  <SidebarHeader
    :title="current.name"
    :subtitle="current.kind"
    :show-logo="false"
    :menu-items="menuItems"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { SidebarHeader } from 'frappe-ui'

import { WORKSPACES } from '../fixtures'

const currentId = ref(WORKSPACES[0].id)
const current = computed(
  () => WORKSPACES.find((w) => w.id === currentId.value) ?? WORKSPACES[0],
)

const menuItems = computed(() =>
  WORKSPACES.map((workspace) => ({
    label: workspace.name,
    icon: workspace.id === 'personal' ? 'lucide-user' : 'lucide-building-2',
    selected: workspace.id === currentId.value,
    onClick: () => (currentId.value = workspace.id),
  })),
)
</script>
