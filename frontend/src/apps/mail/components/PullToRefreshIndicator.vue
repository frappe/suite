<template>
  <!-- Takes no room: it draws in the gap a pull opens above the list, just below it (see
       usePullToRefresh), clipped to the gap so it never reaches into the title row above. -->
  <div class="pointer-events-none relative h-0 shrink-0" aria-hidden="true">
    <!-- Centred on the space seen between the title and the list's first row, not on the gap
         alone: the title row ends 16px under its title, and the first row starts 4px (filter
         chips) to 12px (category cards) into the list. pb-2 lifts the spinner the 4px between. -->
    <div
      class="absolute inset-x-0 top-0 flex items-center justify-center overflow-hidden pb-2"
      :style="{
        height: `${offset}px`,
        opacity: refreshing ? 1 : progress,
        transition: eased(['height', 'opacity']),
      }"
    >
      <!-- LoaderCircle's own arc, drawn as far as the pull has come: whole at the mark, where it
           starts to spin as the list refreshes. -->
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        class="text-ink-gray-5 size-5 shrink-0"
        :class="{ 'animate-spin': refreshing }"
      >
        <path
          d="M21 12a9 9 0 1 1-6.219-8.56"
          pathLength="1"
          :style="{
            strokeDasharray: `${refreshing ? 1 : progress} 1`,
            transition: eased(['stroke-dasharray']),
          }"
        />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SETTLE_MS } from '@/apps/mail/composables/usePullToRefresh'

const { pulling } = defineProps<{
  offset: number
  progress: number
  pulling: boolean
  refreshing: boolean
}>()

// Under the finger it follows at once; let go, it eases with the list.
const eased = (properties: string[]) =>
  pulling
    ? 'none'
    : properties.map((name) => `${name} ${SETTLE_MS}ms var(--page-slide-ease)`).join(', ')
</script>
