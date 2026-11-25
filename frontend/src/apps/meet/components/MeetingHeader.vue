<script setup lang="ts">
import { Breadcrumbs } from 'frappe-ui'
import { computed } from 'vue'

import MeetIcon from '../AreaIcon.vue'

const props = defineProps<{
  meetingId?: string
  meetingTitle?: string
}>()

const crumbs = computed(() => [
  {
    label: 'Meet',
    route: '/meet',
  },
  {
    label: props.meetingTitle || props.meetingId || 'Meeting',
  },
])
</script>

<template>
  <div class="flex items-center justify-between px-4 py-4 shrink-0 z-30">
    <div class="flex items-center gap-2">
      <MeetIcon class="size-5 shrink-0 text-[#E54E17]" />
      <Breadcrumbs :items="crumbs" />
    </div>
    <div v-if="$slots.right" class="flex items-center gap-2">
      <slot name="right" />
    </div>
  </div>
</template>
