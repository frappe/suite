<template>
  <div class="sticky top-0 z-20 bg-surface-base border-b w-full px-5 py-2.5 h-12 flex items-center justify-between">
    <TabButtons
      v-model="onlyUnread"
      :options="[
        {
          label: 'Unread',
          value: true,
        },
        { label: 'All', value: false },
      ]"
    />
    <div class="flex items-center gap-2">
      <Button
        :loading="notifications.loading"
        icon="lucide-refresh-ccw"
        @click="notifications.reload()"
      />
      <Button
        icon-left="lucide-check-circle"
        @click="markAllRead"
      >
        Mark all as read
      </Button>
    </div>
  </div>
  <DriveListSkeleton v-if="!notifications.data" />
  <List
    v-else-if="notifications.data.length"
    class="px-5 pt-5"
    :row-height="44"
  >
    <ListRow
      v-for="row in notifications.data"
      :key="row.name"
      :value="row.name"
      @click="onRowClick(row)"
    >
      <ListCell class="w-20 shrink-0">
        <span class="truncate text-sm text-ink-gray-6">{{ row.type }}</span>
      </ListCell>
      <ListCell>
        <div class="flex items-center gap-2 min-w-0">
          <Avatar
            v-if="row.from_user"
            shape="circle"
            :label="row.from_user"
            :image="row.user_image"
            size="sm"
          />
          <span class="truncate text-p-base text-ink-gray-7">{{ row.message }}</span>
        </div>
      </ListCell>
      <ListCell class="justify-end shrink-0">
        <span class="text-sm text-ink-gray-5">{{ row.relativeTime }}</span>
      </ListCell>
    </ListRow>
  </List>
  <NoFilesSection
    v-else
    :icon="LucideInbox"
    title="No notifications"
    description="Updates about your files will show up here."
  />
</template>
<script setup>
import { ref, watch } from 'vue'
import { formatTimeAgo } from '@vueuse/core'
import { createResource, Avatar, TabButtons, Button } from 'frappe-ui'
import { List, ListRow, ListCell } from 'frappe-ui/list'
import { useRouter } from 'vue-router'
import { notifCount } from '@/apps/drive/resources/permissions'
import NoFilesSection from '@/apps/drive/components/NoFilesSection.vue'
import DriveListSkeleton from '@/apps/drive/components/DriveListSkeleton.vue'
import { formatDate } from '@/apps/drive/utils/format'
import LucideInbox from '~icons/lucide/inbox'

const router = useRouter()
const onlyUnread = ref(true)

function onRowClick(row) {
  if (!row.read) {
    row.read = 1
    markAsRead.submit({ name: row.name })
    if (notifCount.data > 0) notifCount.setData(notifCount.data - 1)
  }
  if (row.entity_type) {
    router.push({
      name: 'drive-' + row.entity_type,
      params: { entityName: row.notif_doctype_name },
    })
  }
}

watch(onlyUnread, (newValue) => {
  notifications.fetch({
    only_unread: newValue,
  })
})

const notifications = createResource({
  url: 'suite.drive.api.notifications.get_notifications',
  auto: true,
  params: {
    only_unread: onlyUnread.value,
  },
  onSuccess(data) {
    data.forEach((item) => {
      item.relativeTime = formatTimeAgo(new Date(item.creation))
      item.creation = formatDate(item.creation)
    })
  },
})

const markAsRead = createResource({
  url: 'suite.drive.api.notifications.mark_as_read',
  auto: false,
  method: 'POST',
  params: {
    name: '',
    all: false,
  },
  onSuccess() {
    notifications.reload()
    notifCount.fetch()
  },
})

function markAllRead() {
  markAsRead.submit({ all: true })
}
</script>
