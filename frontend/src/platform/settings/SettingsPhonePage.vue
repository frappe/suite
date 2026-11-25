<!--
  A page of Settings on a phone, over what opened it, with a bar of a
  back arrow, its title and room for its own buttons. A tab's page lays over the list, and a part
  a tab opens (a list of folders, a form) lays over the tab's page in the same way, so going in
  and coming back look the same at every level. Whoever shows it slides it in and out as every
  phone page does (`slideChange`), so it has no motion of its own.

  It covers the nearest positioned box around it: the Settings sheet for a tab, and for a part,
  the page it is on, which it is moved into (`SETTINGS_PHONE_PAGE_EL`).
-->
<template>
  <div
    v-if="open"
    ref="page"
    class="bg-surface-base absolute inset-0 z-10 flex flex-col pt-[env(safe-area-inset-top)]"
    role="region"
    :aria-label="title"
  >
    <div class="flex h-14 shrink-0 items-center gap-1 px-1">
      <button
        type="button"
        class="touch-target text-ink-gray-6 active:bg-surface-gray-2 flex size-10 shrink-0 items-center justify-center rounded-full"
        :aria-label="__('Back')"
        @click="emit('back')"
      >
        <ChevronLeft class="size-5" />
      </button>
      <h2
        class="text-ink-gray-8 min-w-0 flex-1 truncate text-3xl !font-semibold tracking-[-0.01em]"
      >
        {{ title }}
      </h2>
      <div class="mr-2 flex shrink-0 items-center gap-2 empty:hidden">
        <slot name="actions" />
      </div>
    </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { provide, useTemplateRef } from 'vue'

import { SETTINGS_PHONE_PAGE_EL } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'

defineProps<{ open: boolean; title: string }>()
defineSlots<{ default?: () => unknown; actions?: () => unknown }>()
const emit = defineEmits<{ back: [] }>()

// What a part this page opens lays itself over.
provide(SETTINGS_PHONE_PAGE_EL, useTemplateRef<HTMLElement>('page'))
</script>
