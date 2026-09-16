<template>
  <Popover v-model:open="open" side="right" align="end" :offset="8">
    <template #trigger>
      <Button
        :aria-label="__('Notifications')"
        class="relative"
        icon="lucide-bell"
        variant="ghost"
      >
        <template #suffix>
          <span
            v-if="unread > 0"
            class="absolute -right-1 -top-1 min-w-4 rounded-full bg-surface-amber-7 px-1 text-center text-2xs-medium leading-4 text-white"
            data-testid="notification-count"
          >
            {{ unread > 99 ? "99+" : unread }}
          </span>
        </template>
      </Button>
    </template>

    <div
      class="flex h-[28rem] w-80 flex-col"
      data-testid="notifications-popover"
    >
      <div
        class="flex shrink-0 items-center justify-between border-b border-outline-gray-1 px-3 py-2"
      >
        <h2 class="text-base-semibold text-ink-gray-8">
          {{ __("Notifications") }}
        </h2>
        <Button
          :disabled="unread === 0"
          :label="__('Mark all read')"
          :loading="markRead.isPending"
          variant="ghost"
          @click="markAllRead"
        />
      </div>

      <div
        v-if="feed.status === 'pending' && !feed.rows.length"
        class="space-y-3 p-3"
        aria-label="Loading notifications"
      >
        <Skeleton v-for="index in 5" :key="index" class="h-12 w-full" />
      </div>
      <div
        v-else-if="feed.status === 'error' && !feed.rows.length"
        class="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center"
      >
        <p class="text-p-sm text-ink-red-7">
          {{ feed.error?.message || __("Could not load notifications.") }}
        </p>
        <Button :label="__('Retry')" @click="feed.refetch()" />
      </div>
      <p
        v-else-if="!feed.rows.length"
        class="flex flex-1 items-center justify-center px-4 text-p-sm text-ink-gray-5"
      >
        {{ __("No notifications") }}
      </p>
      <ScrollArea v-else class="min-h-0 flex-1" viewport-class="pb-2">
        <button
          v-for="notification in feed.rows"
          :key="notification.name"
          type="button"
          class="flex w-full gap-3 border-b border-outline-gray-1 px-3 py-3 text-left hover:bg-surface-gray-2"
          :class="
            notification.read
              ? 'text-ink-gray-7'
              : 'bg-surface-amber-2 text-ink-gray-8'
          "
          @click="openNotification(notification)"
        >
          <span
            class="mt-1 size-2 shrink-0 rounded-full"
            :class="
              notification.read ? 'bg-surface-gray-3' : 'bg-surface-amber-7'
            "
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span
              class="block truncate"
              :class="notification.read ? 'text-base' : 'text-base-semibold'"
            >
              {{ notificationTitle(notification) }}
            </span>
            <span class="mt-1 block truncate text-sm text-ink-gray-6">
              {{ notificationDescription(notification) }}
            </span>
            <span class="mt-1 block text-xs text-ink-gray-5">
              {{
                notificationTime(
                  notification.creation || notification.activity.at,
                )
              }}
            </span>
          </span>
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
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Button, Popover, ScrollArea, Skeleton } from "frappe-ui";
import { useRouter } from "vue-router";

import { driveNodeRoute, type DriveNodeSummary } from "@/apps/drive";
import {
  loadNotificationNode,
  markNotificationsRead,
  notificationsFeed,
  notificationUnreadCount,
  type DriveNotification,
} from "@/composition/notifications/client";
import {
  notificationDescription,
  notificationTime,
  notificationTitle,
} from "@/composition/notifications/notificationPresentation";
import { useMutation, useQuery } from "@/platform/server-state";
import { translate as __ } from "@/platform/translation";

const router = useRouter();
const open = ref(false);
const count = useQuery(notificationUnreadCount());
const feed = useQuery(() => (open.value ? notificationsFeed() : false));
const markRead = useMutation(markNotificationsRead);
const unread = computed(() => count.data?.unread ?? 0);

async function openNotification(notification: DriveNotification) {
  if (!notification.read) {
    await markRead.run({ notifications: [notification.name] });
  }
  const node = await loadNotificationNode(notification.activity.node);
  open.value = false;
  await router.push(driveNodeRoute(node as DriveNodeSummary));
}

async function markAllRead() {
  if (!unread.value) return;
  await markRead.run({ all: true });
}
</script>
