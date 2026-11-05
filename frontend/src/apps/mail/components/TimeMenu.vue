<template>
  <!-- Desktop: a menu off its own button, each choice one click, its exact time beside it. A time of the
       reader's own opens off the same button, with a button of its own to settle it. -->
  <Popover v-if="!isMobile && $slots.default" v-model:open="picking" trigger="manual" align="end">
    <template #trigger>
      <span class="inline-flex">
        <AdaptiveDropdown v-model:open="open" :options align="end">
          <slot />
        </AdaptiveDropdown>
      </span>
    </template>
    <div class="w-64 p-3">
      <CustomTimeForm v-if="picking" :action :past-message :initial-value @pick="pick" />
    </div>
  </Popover>
  <!-- Phone: a sheet, as every menu there; opened by a trigger, or from another sheet by v-model:open. -->
  <template v-else-if="isMobile">
    <AdaptiveDropdown v-model:open="open" :options :title>
      <slot />
    </AdaptiveDropdown>
    <BottomSheet v-model:open="picking" :title>
      <div class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <CustomTimeForm v-if="picking" :action :past-message :initial-value @pick="pick" />
      </div>
    </BottomSheet>
  </template>
</template>

<script setup lang="ts">
import { BottomSheet, Popover } from 'frappe-ui'
import { computed, h, ref } from 'vue'

import CustomTimeForm from '@/apps/mail/components/CustomTimeForm.vue'
import { useScreenSize } from '@/apps/mail/utils/composables'
import type { TimeChoice } from '@/apps/mail/utils/snoozeTimes'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'

// A time to do something at (snooze until, remind on): a few choices, or one of the reader's own.
// Shared so every place a time is asked for asks the same way, and settles on the first click.
const { choices, title, action, pastMessage, initialValue } = defineProps<{
  // Read as the menu opens, so "in 1 hour" is an hour from then.
  choices: () => TimeChoice[]
  // The phone's sheets are headed with it.
  title: string
  // What the reader's own time is settled with.
  action: string
  pastMessage: string
  initialValue?: string
}>()

const emit = defineEmits<{
  pick: [value: string]
}>()

const open = defineModel<boolean>('open', { default: false })
const picking = ref(false)
const { isMobile } = useScreenSize()

const options = computed(() => [
  ...(open.value ? choices() : []).map((choice) => ({
    label: choice.label,
    onClick: () => emit('pick', choice.value),
    slots: {
      suffix: () => h('span', { class: 'text-ink-gray-5 ml-6 shrink-0 text-sm' }, choice.display),
    },
  })),
  {
    group: '',
    hideLabel: true,
    options: [{ label: __('Pick a date and time…'), onClick: () => (picking.value = true) }],
  },
])

const pick = (value: string) => {
  picking.value = false
  emit('pick', value)
}
</script>
