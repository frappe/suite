<!-- The workspace mark at the top of the rail, opening the workspace menu: workspace-level areas such as Admin, inviting people, and workspace settings. -->
<template>
  <Dropdown :options="options" side="right" align="start">
    <button
      type="button"
      class="flex items-center justify-center rounded-5 focus-visible:focus-ring"
      :aria-label="__('Workspace menu')"
    >
      <Avatar :image="mark" :label="name" shape="square" size="xl" />
    </button>
  </Dropdown>
</template>

<script setup lang="ts">
import { Avatar, type DropdownOptions } from 'frappe-ui'
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'

import type { AreaDefinition } from '@/platform/contracts'
import { Dropdown } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { openSettings } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'

const { areas, name, mark } = defineProps<{
  /** Areas placed in this menu rather than the rail; already filtered by capability. */
  areas: readonly AreaDefinition[]
  name: string
  mark: string
}>()

const router = useRouter()
const session = useSession()
const isAdmin = computed(() => Boolean(session.capabilities.value.suiteAdmin))

const options = computed<DropdownOptions>(() => [
  {
    group: __('Workspace'),
    hideLabel: true,
    options: [
      {
        label: name || 'Suite',
        disabled: true,
        slots: {
          item: () =>
            h(
              'span',
              { class: 'block truncate px-2 py-1.5 text-base font-medium text-ink-gray-8' },
              name || 'Suite',
            ),
        },
      },
    ],
  },
  {
    group: __('Manage'),
    hideLabel: true,
    options: [
      ...areas.map((area) => ({
        label: area.label(),
        icon: area.icon,
        onClick: () => void router.push(area.to),
      })),
      // Inviting and workspace settings belong to Suite admins; everyone else
      // gets their own settings.
      ...(isAdmin.value
        ? [
            {
              label: __('Invite people'),
              icon: 'lucide-user-plus',
              onClick: () => void router.push('/admin/users'),
            },
            {
              label: __('Workspace settings'),
              icon: 'lucide-settings',
              onClick: () => void router.push('/admin/settings'),
            },
          ]
        : [{ label: __('Settings'), icon: 'lucide-settings', onClick: () => openSettings() }]),
    ],
  },
])
</script>
