<template>
  <div class="p-5 space-y-0.5">
    <div v-for="i in 10" :key="i" class="flex items-center gap-3 px-3 py-2">
      <Skeleton class="size-5 shrink-0 rounded" />
      <Skeleton class="h-3.5 rounded" :style="{ width: nameWidths[i % nameWidths.length] }" />
      <div class="ml-auto flex items-center gap-10">
        <div class="flex items-center gap-2 w-28">
          <Skeleton class="size-5 shrink-0 rounded-full" />
          <Skeleton class="h-3 rounded w-16" />
        </div>
        <Skeleton class="h-3 rounded w-20" />
        <Skeleton class="h-3 rounded w-12" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { Skeleton } from 'frappe-ui'

const nameWidths = ['45%', '30%', '55%', '38%', '50%', '42%', '60%', '35%', '48%', '52%']
</script>
