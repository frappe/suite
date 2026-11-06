<template>
  <div
    class="bg-surface-modal text-ink-gray-8 border-outline-gray-2 shadow-lg fixed right-4 bottom-4 z-50 w-56 rounded-lg border p-3"
  >
    <p class="text-p-sm text-ink-gray-5 mb-2">{{ __('Tweaks (dev only)') }}</p>
    <FormControl
      v-model="mailTweaks.pinLook"
      type="select"
      :label="__('Pinned row')"
      :options="pinLooks"
    />
    <FormControl
      v-model="mailTweaks.returnedLook"
      class="mt-2"
      type="select"
      :label="__('Returned row')"
      :options="returnedLooks"
    />
    <FormControl
      v-model="mailTweaks.remindEntry"
      class="mt-2"
      type="select"
      :label="__('Reminder in composer')"
      :options="remindEntries"
    />
  </div>
</template>

<script setup lang="ts">
import { FormControl } from 'frappe-ui'

import { mailTweaks } from '@/apps/mail/utils/mailTweaks'

const returnedLooks = [
  { label: __('Word'), value: 'badge' },
  { label: __('Bell'), value: 'bell' },
]
const remindEntries = [
  { label: __('Toolbar button'), value: 'toolbar' },
  { label: __('Send menu'), value: 'send-menu' },
]
const pinLooks = [
  { label: __('Pinned section'), value: 'section' },
  { label: __('Icon only'), value: 'icon' },
  { label: __('Tinted row'), value: 'tint' },
]
</script>
