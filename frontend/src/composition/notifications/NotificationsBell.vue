<template>
  <Popover v-model:open="open" side="right" align="end" :offset="8">
    <template #trigger>
      <Button :aria-label="__('Notifications')" class="relative" icon="lucide-bell" variant="ghost">
        <template #suffix>
          <span
            v-if="unread > 0"
            class="absolute -right-1 -top-1 min-w-4 rounded-full bg-surface-amber-7 px-1 text-center text-2xs-medium leading-4 text-white"
            data-testid="notification-count"
          >
            {{ unreadLabel(unread) }}
          </span>
        </template>
      </Button>
    </template>

    <div class="flex h-[28rem] w-80 flex-col" data-testid="notifications-popover">
      <div
        class="flex shrink-0 items-center justify-between border-b border-outline-gray-1 px-3 py-2"
      >
        <h2 class="text-base-semibold text-ink-gray-8">
          {{ __('Notifications') }}
        </h2>
        <Button
          :disabled="unread === 0"
          :label="__('Mark all read')"
          :loading="markingAll"
          variant="ghost"
          @click="markAllRead"
        />
      </div>
      <NotificationsList :enabled="open" @navigate="open = false" />
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { Button, Popover } from 'frappe-ui'
import { ref } from 'vue'

import NotificationsList from '@/composition/notifications/NotificationsList.vue'
import { unreadLabel, useUnreadNotifications } from '@/composition/notifications/unread'
import { translate as __ } from '@/platform/translation'

const open = ref(false)
const { unread, markAllRead, markingAll } = useUnreadNotifications()
</script>
