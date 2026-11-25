<script setup lang="ts">
import { Badge, Button, Dropdown, toast, Tooltip } from 'frappe-ui'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation, useQuery } from '@/api'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import { dayLabel } from '../utils/homeDates'

const router = useRouter()
const session = useSession()
const rooms = useQuery(api.meet.rooms.mine)
const defaultInvite = useQuery(api.meet.rooms.defaultInvite)
const setDefaultInvite = useMutation(api.meet.rooms.setDefaultInvite)
const options = (room: (typeof rows.value)[number]) => {
  const selected = defaultInvite.data?.room === room.name
  return [
    {
      // The label says what a click does, so no selected state is needed.
      label: selected ? __('Stop using for calendar invites') : __('Use for calendar invites'),
      disabled: !defaultInvite.data || setDefaultInvite.isPending,
      onClick: async () => {
        try {
          await setDefaultInvite.run({ room: selected ? null : room.name })
        } catch {
          // The mutation client reports the refusal.
        }
      },
    },
  ]
}

const rows = computed(() =>
  (rooms.data ?? []).map((room) => ({
    name: room.name,
    meetTitle: room.title,
    title: room.title || room.name,
    customLink: room.custom_link,
    url: room.url,
    code: room.custom_link || (room.title ? room.name : ''),
    restricted: room.meeting_type === 'restricted',
    cohost: room.owner !== session.user.value?.id,
    invites: defaultInvite.data?.room === room.name,
    used: dayLabel(room.modified),
  })),
)

const copyLink = async (url: string) => {
  try {
    await navigator.clipboard.writeText(url)
    toast.success(__('Link copied'))
  } catch {
    toast.error(__('Could not copy the link'))
  }
}
const join = (name: string) => router.push({ name: 'meet-meeting', params: { meetingId: name } })
</script>

<template>
  <section v-if="rows.length || rooms.error" :aria-label="__('Recent meets')">
    <div class="mb-3 flex h-7 items-center">
      <h2 class="text-base font-medium text-ink-gray-8">{{ __('Recent meets') }}</h2>
    </div>
    <div
      v-if="rooms.error"
      class="flex items-center justify-center gap-2 rounded-7 border border-dashed border-outline-gray-2 px-4 py-6 text-base text-ink-gray-5"
      role="alert"
    >
      {{ __('Could not load recent meets.') }}
      <Button variant="outline" :label="__('Retry')" @click="rooms.refetch()" />
    </div>
    <ul v-else class="overflow-hidden rounded-7 border border-outline-gray-1 bg-surface-gray-1">
      <li
        v-for="room in rows"
        :key="room.name"
        class="room-item group relative border-b border-outline-gray-1 last:border-b-0"
      >
        <Button
          class="room-row"
          variant="ghost"
          :aria-label="__('Join {0}', [room.title])"
          @click="join(room.customLink || room.name)"
        >
          <span class="flex w-full min-w-0 items-center gap-2.5 pe-[4.5rem]">
            <Tooltip :text="__('Restricted')" :disabled="!room.restricted">
              <span
                class="grid size-11 shrink-0 place-items-center rounded-6 border border-outline-gray-1 bg-surface-base"
                aria-hidden="true"
              >
                <span
                  :class="[
                    room.restricted ? 'lucide-lock' : 'lucide-video',
                    'size-4.5 text-ink-gray-7',
                  ]"
                />
              </span>
            </Tooltip>
            <span class="min-w-0 flex-1 text-start">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-sm font-medium text-ink-gray-8">{{ room.title }}</span>
                <!-- The menu no longer marks the meet calendar invites use, so the row does. -->
                <template v-if="room.invites">
                  <Tooltip :text="__('Used for calendar invites')">
                    <span
                      class="lucide-calendar size-3.5 shrink-0 text-ink-gray-5"
                      aria-hidden="true"
                    />
                  </Tooltip>
                  <span class="sr-only">{{ __('Used for calendar invites') }}</span>
                </template>
                <Badge v-if="room.cohost" :label="__('Co-host')" size="sm" />
                <!-- The lock says it on screen; the icon is hidden from screen readers. -->
                <span v-if="room.restricted" class="sr-only">{{ __('Restricted') }}</span>
              </span>
              <span class="mt-1.5 flex min-w-0 items-center gap-0.5 text-sm text-ink-gray-6">
                <span v-if="room.code" class="truncate">{{ room.code }}</span>
                <template v-if="room.used">
                  <span v-if="room.code" aria-hidden="true">{{ '・' }}</span>
                  <span class="shrink-0">{{ room.used }}</span>
                </template>
              </span>
            </span>
          </span>
        </Button>
        <!-- A sibling of the row, not inside it: a button can't hold another button. -->
        <Button
          class="absolute end-11 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          variant="ghost"
          icon="lucide-copy"
          :tooltip="__('Copy link')"
          :aria-label="__('Copy link to {0}', [room.title])"
          @click="copyLink(room.url)"
        />
        <div
          class="absolute end-2.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100"
        >
          <Dropdown align="end" :options="options(room)">
            <template #trigger>
              <Button
                variant="ghost"
                icon="lucide-ellipsis"
                :aria-label="__('More options for {0}', [room.title])"
              />
            </template>
          </Dropdown>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.room-row {
  @apply h-[66px] w-full rounded-none px-2.5 py-2.5 hover:bg-surface-gray-2;
}
.room-row :deep(> span) {
  @apply w-full;
}
</style>
