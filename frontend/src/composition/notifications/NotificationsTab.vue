<!-- The phone bottom bar's Notifications tab: the bell's place on a phone, with the same count. -->
<template>
  <MobileNavItem :label="__('Notifications')" route="/notifications">
    <template #default="{ active }">
      <span class="relative grid size-6 place-items-center">
        <span
          class="lucide-bell size-6"
          :class="active ? 'text-ink-gray-8' : 'text-ink-gray-5'"
          aria-hidden="true"
        />
        <span
          v-if="unread > 0"
          class="absolute -right-2 -top-1 min-w-4 rounded-full bg-surface-amber-7 px-1 text-center text-2xs-medium leading-4 text-white"
          data-testid="notification-count"
        >
          {{ unreadLabel(unread) }}
        </span>
      </span>
    </template>
  </MobileNavItem>
</template>

<script setup lang="ts">
import { MobileNavItem } from 'frappe-ui'

import { unreadLabel, useUnreadNotifications } from '@/composition/notifications/unread'
import { translate as __ } from '@/platform/translation'

const { unread } = useUnreadNotifications()
</script>
