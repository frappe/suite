<template>
  <div class="mx-auto w-96 sm:w-[60%] pt-8">
    <div v-for="group in groups" :key="group.label" class="mb-6">
      <Skeleton class="h-3 rounded mb-3" :style="{ width: group.headerWidth }" />
      <div v-for="(row, i) in group.rows" :key="i" class="-mx-3">
        <div class="flex items-center justify-between p-3">
          <Skeleton class="h-3.5 rounded" :style="{ width: row.nameWidth }" />
          <div class="flex items-center gap-3">
            <Skeleton class="size-5 rounded-full" />
            <Skeleton class="h-3 rounded w-20 hidden md:block" />
            <Skeleton class="h-3 rounded w-16" />
          </div>
        </div>
        <hr v-if="i !== group.rows.length - 1" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { Skeleton } from 'frappe-ui'

const groups = [
  {
    label: 'Today',
    headerWidth: '3rem',
    rows: [{ nameWidth: '55%' }, { nameWidth: '40%' }, { nameWidth: '62%' }],
  },
  {
    label: 'Yesterday',
    headerWidth: '4.5rem',
    rows: [{ nameWidth: '48%' }, { nameWidth: '35%' }],
  },
  {
    label: 'Last seven days',
    headerWidth: '6.5rem',
    rows: [{ nameWidth: '57%' }, { nameWidth: '44%' }, { nameWidth: '38%' }],
  },
]
</script>
