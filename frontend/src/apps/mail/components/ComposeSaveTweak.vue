<template>
  <!-- Dev only, and absent from a production build: MailLayout imports it behind
       `import.meta.env.DEV`. For choosing where the save state sits; goes once that's decided. -->
  <div
    class="bg-surface-base fixed z-50 flex flex-col gap-1.5 rounded border p-2 shadow-lg"
    :class="
      isComposeWindowOpen()
        ? 'bottom-4 right-[calc(600px+2rem)]'
        : 'bottom-24 left-4 sm:bottom-4 sm:left-auto sm:right-4'
    "
  >
    <span class="text-ink-gray-5 text-p-xs">{{ __('Tweak · save state') }}</span>
    <TabButtons v-model="draftSavePlacement" :options />
  </div>
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { watch } from 'vue'

import { isComposeWindowOpen } from '@/apps/mail/composables/useComposeWindow'
import { draftSavePlacement, type DraftSavePlacement } from '@/apps/mail/utils/draftSavePlacement'

const KEY = 'suite.mail.tweak.draftSavePlacement'
const options: { value: DraftSavePlacement; label: string }[] = [
  { value: 'toolbar', label: __('Bar') },
  { value: 'title', label: __('Title') },
  { value: 'send', label: __('Send') },
]
try {
  const saved = localStorage.getItem(KEY) as DraftSavePlacement | null
  if (options.some((option) => option.value === saved)) draftSavePlacement.value = saved!
} catch {
  /* The panel works for this page without it. */
}
watch(draftSavePlacement, (value) => {
  try {
    localStorage.setItem(KEY, value)
  } catch {
    /* Likewise. */
  }
})
</script>
