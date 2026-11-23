<template>
  <ol class="flex flex-col">
    <li v-for="(entry, index) in entries" :key="entry.key" class="flex gap-3.5">
      <!-- Dots take their colour from the text colour: filled for what happened, an
			outline for what is still to come. -->
      <div class="flex w-3 shrink-0 flex-col items-center" :class="themeInkClass(entry.theme)">
        <span
          class="mt-1 h-2 w-2 shrink-0 rounded-full"
          :class="entry.pending ? 'bg-surface-base border-[1.5px] border-current' : 'bg-current'"
        />
        <span
          v-if="index < entries.length - 1"
          class="border-outline-gray-2 mt-1 flex-1 border-l"
        />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1 pb-4">
        <!-- The time leads on a phone and takes a right-hand lane on wider screens. -->
        <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
          <span
            v-if="entry.time"
            class="text-ink-gray-5 order-first text-xs sm:order-last sm:w-28 sm:shrink-0 sm:text-right"
            :title="formatDateTime(entry.time)"
          >
            {{ formatDateTime(entry.time, 'MMM D, h:mm A') }}
          </span>
          <span class="text-ink-gray-9 min-w-0 flex-1 text-base">{{ entry.title }}</span>
        </div>
        <p v-if="entry.detail" class="text-ink-gray-6 text-sm">{{ entry.detail }}</p>
        <code
          v-if="entry.reply"
          class="bg-surface-gray-1 text-ink-gray-7 self-start rounded-2 px-1.5 py-0.5 font-mono text-xs break-words whitespace-pre-wrap"
        >
          {{ entry.reply }}
        </code>
      </div>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { formatDateTime } from '@/apps/mail/utils/datetime'
import { themeInkClass, type ActivityEntry } from '@/apps/mail/utils/submissionActivity'

defineProps<{ entries: ActivityEntry[] }>()
</script>
