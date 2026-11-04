<!-- One line of placeholder text. Give it the text class of the line it stands in for
     (`text-sm`, `text-p-sm`, …) so it takes exactly that line's height. -->
<template>
  <p class="min-w-0 flex-1" aria-hidden="true">
    <Skeleton
      class="inline-block h-[0.75em] max-w-full rounded-4 align-middle"
      :style="{ width }"
    />
  </p>
</template>

<script setup lang="ts">
import { Skeleton } from 'frappe-ui'

const { width = '100%' } = defineProps<{ width?: string }>()
</script>
