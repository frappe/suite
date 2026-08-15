<!--
  PROTOTYPE — remove. Workspace switcher at the top of the contextual panel.
  Trigger geometry is copied from Gameplan's CommunityDropdown so the two
  sidebars line up pixel for pixel: rounded-4, px-2 py-1, a text-lg-medium
  title, and a size-7 cell holding the chevron. Two deliberate departures from
  Gameplan: the trigger carries the workspace's own mark, and the chevron is
  the up-down pair, which reads as "switch" rather than "open a menu".
-->
<template>
  <Dropdown :options="menuItems" match-trigger-width>
    <template #default="{ open }">
      <button
        type="button"
        class="flex w-full min-w-0 items-center gap-2 rounded-4 px-2 py-1 text-ink-gray-7 transition"
        :class="open ? 'bg-surface-elevation-2 shadow-sm' : 'hover:bg-surface-gray-2'"
        :title="current.name"
      >
        <Avatar
          v-if="isPersonal(current)"
          :image="USER.avatar"
          :label="USER.name"
          class="size-6 shrink-0"
        />
        <FrappeTile v-else class="size-6 shrink-0" />
        <span class="min-w-0 flex-1 truncate text-left text-lg-medium">
          {{ current.name }}
        </span>
        <div class="grid size-7 shrink-0 place-content-center">
          <span class="lucide-chevrons-up-down size-4 shrink-0 text-ink-gray-5" />
        </div>
      </button>
    </template>
  </Dropdown>
</template>

<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { Avatar, Dropdown } from 'frappe-ui'

import { USER, WORKSPACES } from '../fixtures'
import FrappeTile from './FrappeTile.vue'

const currentId = ref(WORKSPACES[0].id)
const current = computed(
  () => WORKSPACES.find((w) => w.id === currentId.value) ?? WORKSPACES[0],
)

const isPersonal = (workspace: { id: string }) => workspace.id === 'personal'

// The org carries the Frappe mark; the personal workspace carries the user's
// own avatar. Avatar needs a prop, which `icon` cannot pass, so it goes
// through the per-item prefix slot instead.
const menuItems = computed(() =>
  WORKSPACES.map((workspace) => ({
    label: workspace.name,
    selected: workspace.id === currentId.value,
    onClick: () => (currentId.value = workspace.id),
    ...(isPersonal(workspace)
      ? {
          slots: {
            prefix: () =>
              h(Avatar, {
                image: USER.avatar,
                label: USER.name,
                class: 'size-4',
              }),
          },
        }
      : { icon: FrappeTile }),
  })),
)
</script>
