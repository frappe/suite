<template>
  <div class="bg-surface-base border-b w-full px-5 py-2.5 h-12 flex items-center justify-between">
    <div class="bg-surface-gray-2 rounded-[10px] space-x-0.5 h-7 flex items-center px-0.5 py-1">
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
    </div>
    <div>
      <Button
        :loading="notifications.loading"
        icon="refresh-ccw"
        class="mr-2"
        @click="notifications.reload()"
      />
      <Button
        icon-left="check-circle"
        @click="markAllRead"
      >
        Mark all as read
      </Button>
    </div>
  </div>
  <DriveListSkeleton v-if="!notifications.data" />
  <ListView
    v-else-if="notifications.data.length"
    class="px-5 pt-5"
    :columns="columns"
    :options="options"
    :rows="notifications.data"
    row-key="name"
  />
  <NoFilesSection
    v-else
    :icon="LucideInbox"
    title="No notifications"
    description="Updates about your files will show up here."
  />
</template>
<script setup>
import { ref, h, watch } from 'vue'
import { formatTimeAgo } from '@vueuse/core'
import { createResource, Avatar, ListView, TabButtons, Button} from 'frappe-ui'
import { notifCount } from '@/apps/drive/resources/permissions'
import NoFilesSection from '@/apps/drive/components/NoFilesSection.vue'
import DriveListSkeleton from '@/apps/drive/components/DriveListSkeleton.vue'
import { formatDate } from '@/apps/drive/utils/format'
import emitter from '@/apps/drive/emitter'
import LucideInbox from '~icons/lucide/inbox'

const onlyUnread = ref(true)
const options = {
  getRowRoute: (row) =>
    row.entity_type
      ? {
          name: 'drive-' + row.entity_type,
          params: { entityName: row.notif_doctype_name },
        }
      : null,
  onRowClick: (row) => {
    if (row.type === 'Team') emitter.emit('showSettings', 'teams')
    if (onlyUnread.value) {
      markAsRead.submit({ name: row.name })
      if (notifCount.data > 0) notifCount.setData(notifCount.data - 1)
    }
  },
  selectable: false,
  showTooltip: true,
  resizeColumn: false,
}

const columns = [
  {
    label: 'Subject',
    key: 'subject',
    width: '80px',
    getLabel: ({ row }) => row.type,
  },
  {
    label: 'Message',
    key: 'message',
    width: 4,
    getLabel: ({ row }) => row.message,
    prefix: ({ row }) => {
      if (row.from_user)
        return h(Avatar, {
          shape: 'circle',
          label: row.from_user,
          image: row.user_image,
          size: 'sm',
        })
    },
  },
  {
    key: 'creation',
    align: 'end',
    getLabel: ({ row }) => row.relativeTime,
  },
]

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
