<template>
  <TimeMenu
    v-model:open="open"
    v-model:picking="picking"
    :choices="snoozeChoices"
    :title="changing || current ? __('Change snooze time') : __('Snooze until')"
    :action="__('Snooze')"
    :past-message="__('Choose a time in the future.')"
    :initial-value="current ?? undefined"
    :menu
    @pick="(until: string) => emit('pick', until)"
  >
    <!-- Only a trigger that is there: without one, it opens by v-model:open alone. -->
    <template v-if="$slots.default" #default><slot /></template>
  </TimeMenu>
</template>

<script setup lang="ts">
import TimeMenu from '@/apps/mail/components/TimeMenu.vue'
import { snoozeChoices } from '@/apps/mail/utils/snoozeTimes'

const { menu = true } = defineProps<{
  // The time it is snoozed until now, when it is being changed.
  current?: string | null
  // It is being changed, the time it is snoozed until not being at hand.
  changing?: boolean
  // Off where another menu offers the choices (see TimeMenu).
  menu?: boolean
}>()

const emit = defineEmits<{ pick: [until: string] }>()
const open = defineModel<boolean>('open', { default: false })
const picking = defineModel<boolean>('picking', { default: false })
</script>
