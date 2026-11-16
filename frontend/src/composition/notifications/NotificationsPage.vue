<!--
  The Notifications page, /notifications: the bell's list as a page. The phone bottom bar opens
  it, as a phone has no rail and so no bell; on desktop it opens by URL.
-->
<template>
  <div class="flex h-full min-h-0 flex-col">
    <PageHeader v-if="!isMobile">
      <div class="flex w-full items-center justify-between gap-3">
        <PageHeaderTitle :title="__('Notifications')" />
        <Button
          :disabled="unread === 0"
          :label="__('Mark all read')"
          :loading="markingAll"
          variant="subtle"
          @click="markAllRead"
        />
      </div>
    </PageHeader>
    <PageHeaderMobile v-else :title="__('Notifications')">
      <template #suffix>
        <Button
          :disabled="unread === 0"
          :label="__('Mark all read')"
          :loading="markingAll"
          variant="ghost"
          @click="markAllRead"
        />
      </template>
    </PageHeaderMobile>

    <div class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col md:px-5 md:py-4">
      <NotificationsList enabled />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, PageHeader, PageHeaderMobile, PageHeaderTitle } from 'frappe-ui'

import NotificationsList from '@/composition/notifications/NotificationsList.vue'
import { useUnreadNotifications } from '@/composition/notifications/unread'
import { translate as __ } from '@/platform/translation'
import { isMobile } from '@/shell/useIsMobile'

const { unread, markAllRead, markingAll } = useUnreadNotifications()
</script>
