<!-- The shell hands a Meet room code to a real call. This static prototype has
     nowhere to send it, so joining stops here instead of 404ing. -->
<template>
  <div class="flex h-screen w-full flex-col items-center justify-center gap-3 bg-surface-base text-center">
    <div class="grid size-14 place-items-center rounded-full bg-surface-gray-2 text-ink-gray-5">
      <span class="lucide-video size-6" aria-hidden="true" />
    </div>
    <p class="text-lg font-medium text-ink-gray-8">Joining meeting {{ code }}</p>
    <p class="max-w-sm text-p-sm text-ink-gray-5">
      The real shell hands this room code to Meet. This prototype stops here.
    </p>
    <Button label="Back to the shell" variant="subtle" @click="$router.back()" />
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

defineProps<{ code: string }>()
</script>
