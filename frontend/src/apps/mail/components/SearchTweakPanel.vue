<template>
  <!-- A development build's way to try the search view's undecided looks: see useSearchTweaks. Above
       the phone's tab bar, and out of the reading pane's way on a desktop's corner. -->
  <div
    class="fixed bottom-20 right-4 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-6 border border-outline-gray-1 bg-surface-base text-ink-gray-8 shadow-lg sm:bottom-4"
  >
    <button
      class="flex w-full items-center justify-between px-3 py-2 text-base-medium"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ __('Tweak search') }}
      <span :class="open ? 'lucide-chevron-down' : 'lucide-chevron-up'" class="size-4" />
    </button>
    <div v-if="open" class="space-y-3 border-t border-outline-gray-1 p-3">
      <FormControl
        v-for="(tweak, key) in SEARCH_TWEAKS"
        :key="key"
        type="select"
        size="sm"
        :label="tweak.label"
        :options="[...tweak.options]"
        :model-value="tweaks[key]"
        @update:model-value="(value: never) => set(key, value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { FormControl } from 'frappe-ui'
import { ref } from 'vue'

import { SEARCH_TWEAKS, useSearchTweaks } from '@/apps/mail/composables/useSearchTweaks'

const { tweaks, set } = useSearchTweaks()
const open = ref(true)
</script>
