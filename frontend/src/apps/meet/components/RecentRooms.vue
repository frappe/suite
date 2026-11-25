<script setup lang="ts">
import { Badge, Button, toast, Tooltip } from 'frappe-ui'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { api, useQuery } from '@/api'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import { dayLabel } from '../utils/homeDates'

const router = useRouter()
const session = useSession()
const rooms = useQuery(api.meet.rooms.mine)
const rows = computed(() =>
  (rooms.data ?? []).map((room) => ({
    name: room.name,
    title: room.title || room.name,
    url: room.url,
    code: room.title ? room.name : '',
    restricted: room.meeting_type === 'restricted',
    cohost: room.owner !== session.user.value?.id,
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
      v-if="rooms.error && !rows.length"
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
          @click="join(room.name)"
        >
          <span class="flex w-full min-w-0 items-center gap-2.5 pe-9">
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
                <Badge v-if="room.cohost" :label="__('Co-host')" size="sm" />
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
        <Button
          class="absolute end-2.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          variant="ghost"
          icon="lucide-copy"
          :tooltip="__('Copy link')"
          :aria-label="__('Copy link to {0}', [room.title])"
          @click="copyLink(room.url)"
        />
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
