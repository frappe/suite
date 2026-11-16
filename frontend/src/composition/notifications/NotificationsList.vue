<!--
  The notifications feed: loading, failed, empty, the rows, and Load more. The bell's popover and
  the Notifications page show it under their own headers. A tap on a row marks it read and opens
  its item; `navigate` fires just before the route changes, so the popover can close.
-->
<template>
  <div
    v-if="feed.status === 'pending' && !feed.rows.length"
    class="space-y-3 p-3"
    :aria-label="__('Loading notifications')"
  >
    <Skeleton v-for="index in 5" :key="index" class="h-12 w-full" />
  </div>
  <LoadFailed
    v-else-if="feed.status === 'error' && !feed.rows.length"
    :title="__('Could not load notifications')"
    :retry="() => feed.refetch()"
    class="flex-1 px-4"
  />
  <p
    v-else-if="!feed.rows.length"
    class="flex flex-1 items-center justify-center px-4 py-8 text-p-sm text-ink-gray-5"
  >
    {{ __('No notifications') }}
  </p>
  <ScrollArea v-else class="min-h-0 flex-1" viewport-class="pb-2">
    <button
      v-for="notification in feed.rows"
      :key="notification.name"
      type="button"
      class="flex w-full items-start gap-3 border-b border-outline-gray-1 px-3 py-3 text-left hover:bg-surface-gray-2"
      @click="openNotification(notification)"
    >
      <!-- Who acted, with what kind of item on their badge; a download shows its own icon. -->
      <span class="relative mt-0.5 shrink-0">
        <Avatar
          v-if="'activity' in notification"
          size="lg"
          :label="notification.actor.full_name"
          :image="notification.actor.user_image ?? undefined"
        />
        <span v-else class="flex size-8 items-center justify-center rounded-full bg-surface-gray-2">
          <span class="lucide-download size-4 text-ink-gray-6" aria-hidden="true" />
        </span>
        <span
          v-if="'activity' in notification"
          class="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full bg-surface-white ring-1 ring-outline-gray-1"
          aria-hidden="true"
        >
          <span class="size-3" :class="itemIcon(notification)" />
        </span>
      </span>
      <span class="min-w-0 flex-1">
        <span class="line-clamp-2 block break-words text-base text-ink-gray-7">
          <template
            v-for="(part, index) in notificationParts(notification, session.user.value?.id)"
            :key="index"
          >
            <span v-if="part.strong" class="font-medium text-ink-gray-8">{{ part.text }}</span>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>
        <span
          v-if="notificationExcerpt(notification)"
          class="mt-1 line-clamp-2 block break-words text-sm text-ink-gray-6"
        >
          {{ notificationExcerpt(notification) }}
        </span>
        <span class="mt-1 block text-xs text-ink-gray-5">
          {{ notificationTime(notificationAt(notification)) }}
        </span>
      </span>
      <span
        v-if="!notification.read"
        class="mt-2 size-2 shrink-0 rounded-full bg-surface-amber-7"
        role="img"
        :aria-label="__('Unread')"
      />
    </button>
    <div v-if="feed.hasNext" class="flex justify-center p-2">
      <Button
        :label="__('Load more')"
        :loading="feed.isFetchingNext"
        variant="ghost"
        @click="feed.fetchNext()"
      />
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { Avatar, Button, ScrollArea, Skeleton } from 'frappe-ui'
import { useRouter } from 'vue-router'

import { api, useInfiniteQuery, useMutation } from '@/api'
import {
  driveNodeIcon,
  driveNodeIconTint,
  driveNodeRoute,
  loadDriveNodeSummary,
  type DriveNotification,
} from '@/apps/drive'
import {
  isDownloadExpired,
  notificationAt,
  notificationExcerpt,
  notificationParts,
  notificationTime,
} from '@/composition/notifications/notificationPresentation'
import { toast } from '@/platform/feedback'
import { LoadFailed } from '@/platform/load-failed'
import { mentionedByState } from '@/platform/page-meta'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { isRefusal } from '@/platform/transport'

const props = defineProps<{
  /** Loads the feed while true: the popover loads it only while open. */
  enabled: boolean
}>()
const emit = defineEmits<{ navigate: [] }>()

const router = useRouter()
const feed = useInfiniteQuery(api.drive.notifications.list, () =>
  props.enabled ? { limit: 60 } : false,
)
const session = useSession()
const markRead = useMutation(api.drive.notifications.markRead)

async function openNotification(notification: DriveNotification) {
  if (!notification.read) {
    await markRead.run({ notifications: [notification.name] })
  }
  if ('download' in notification) {
    // A failed or expired download has nothing to open; reading it is enough.
    if (!notification.download.url || isDownloadExpired(notification.download)) return
    emit('navigate')
    window.location.assign(notification.download.url)
    return
  }
  let node: Parameters<typeof driveNodeRoute>[0]
  let mentionedBy = ''
  try {
    node = await loadDriveNodeSummary(notification.activity.node)
  } catch (error) {
    if (!isRefusal(error)) {
      toast.error(__('Could not open this notification'), {
        action: { label: __('Retry'), onClick: () => void openNotification(notification) },
      })
      return
    }

    // Someone mentioned without access can't load the node. The page they land on says whom to ask.
    mentionedBy = notification.actor.full_name
    node = {
      name: notification.activity.node,
      title: notification.node_title,
      kind: notification.node_kind,
    }
  }

  emit('navigate')
  const destination = driveNodeRoute(node)
  await router.push({
    ...destination,
    state: { ...destination.state, ...mentionedByState(mentionedBy) },
  })
}

function itemIcon(notification: Extract<DriveNotification, { activity: unknown }>) {
  const node = {
    kind: notification.node_kind,
    title: notification.node_title,
    mime: notification.node_mime,
    content_doctype: notification.node_content_doctype,
  }
  return [driveNodeIcon(node), driveNodeIconTint(node)]
}
</script>
