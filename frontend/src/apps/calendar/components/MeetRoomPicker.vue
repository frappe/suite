<script setup lang="ts">
import { Button, Combobox } from 'frappe-ui'
import { computed } from 'vue'

import { getMeetUrl } from '@/apps/calendar/utils'
import { translate as __ } from '@/platform/translation'

const props = defineProps<{
  rooms: { room: string; title: string | null; meeting_url: string }[]
  label: string
  url?: string
  size?: 'sm' | 'md'
}>()

const emit = defineEmits<{ pick: [url: string | null] }>()

function pickNewLink(close: () => void) {
  emit('pick', null)
  close()
}

const options = computed(() => [
  {
    group: __('Your meets'),
    options: props.rooms.map((room) => ({
      label: room.title || `meet/${room.room}`,
      description: room.title ? `meet/${room.room}` : undefined,
      value: room.meeting_url,
    })),
  },
])
const selectedUrl = computed(
  () =>
    props.rooms.find(({ meeting_url }) => (getMeetUrl(meeting_url) || meeting_url) === props.url)
      ?.meeting_url ?? null,
)
</script>

<template>
  <Combobox
    :model-value="selectedUrl"
    :options="options"
    :placeholder="__('Search meets')"
    :empty-text="__('No matching meets')"
    :aria-label="__('Choose a Meet link')"
    :size="size"
    @update:model-value="typeof $event === 'string' && emit('pick', $event)"
  >
    <template #trigger="{ open }">
      <Button
        :label="label"
        :size="size"
        :aria-expanded="open"
        aria-haspopup="listbox"
        data-meet-picker
        variant="ghost"
        icon-right="lucide-chevron-down"
      />
    </template>
    <template #footer="{ close }">
      <div class="border-t border-outline-gray-1 p-1">
        <Button
          class="w-full justify-start"
          variant="ghost"
          :label="__('New link for this event')"
          @click="pickNewLink(close)"
        />
      </div>
    </template>
  </Combobox>
</template>
