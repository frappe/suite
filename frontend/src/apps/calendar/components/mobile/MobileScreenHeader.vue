<template>
  <!-- The phone's event screens share this header, so the mark on the left and the title beside
	     it land on the same pixels on each of them: the form, its participants screen, and the
	     screen shown while the form loads. -->
  <header
    class="flex shrink-0 items-center justify-between gap-2 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.875rem)]"
  >
    <div class="flex min-w-0 items-center gap-1">
      <!-- -ml-1.5, not -ml-2: an icon-only Button is a 32px square with no padding
			     of its own, so its 20px glyph sits 6px in. Pulling the square 6px left
			     of the header's own 16px margin puts the glyph on that margin — the
			     line the cards below it start on. -->
      <Button
        variant="ghost"
        class="-ml-1.5"
        :aria-label="back ? __('Back') : __('Close')"
        @click="(event: MouseEvent) => emit('leave', event)"
      >
        <template #icon>
          <ChevronLeft v-if="back" class="size-5 text-ink-gray-7" />
          <X v-else class="size-5 text-ink-gray-7" />
        </template>
      </Button>
      <h2 class="truncate text-xl font-medium text-ink-gray-9">{{ title }}</h2>
    </div>
    <slot />
  </header>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { ChevronLeft, X } from 'lucide-vue-next'

import { translate as __ } from '@/platform/translation'

defineProps<{
  title: string
  /** A chevron that steps back to the screen before; without it, a cross that leaves. */
  back?: boolean
}>()
// The tap that asked, so a screen can drop the press state it left on the button.
const emit = defineEmits<{ leave: [event: MouseEvent] }>()
</script>
