<template>
  <!-- A list's rows before its mail arrives, in a row's own shape and spacing (see MailRow): a
       folder that takes a few seconds, Trash on a large account, shows a list on its way rather
       than a bare spinner. Fixed widths, so the rows don't shuffle on each render. -->
  <div class="animate-pulse" role="status" :aria-label="__('Loading mail')">
    <div
      v-for="(row, i) in ROWS"
      :key="i"
      class="flex space-x-2.5 border-b px-3.5 py-2.5 sm:space-x-5 sm:px-5 sm:py-2"
    >
      <div class="bg-surface-gray-3 h-8 w-8 shrink-0 rounded-full max-sm:h-10 max-sm:w-10" />
      <div class="min-w-0 flex-1 space-y-2 py-1">
        <div class="flex justify-between">
          <div class="bg-surface-gray-3 h-3 rounded-4" :style="{ width: row[0] }" />
          <div class="bg-surface-gray-3 h-3 w-10 rounded-4" />
        </div>
        <div class="bg-surface-gray-3 h-3 rounded-4" :style="{ width: row[1] }" />
        <div class="bg-surface-gray-2 h-3 rounded-4" :style="{ width: row[2] }" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Sender, subject and preview widths per row.
const ROWS = [
  ['28%', '62%', '88%'],
  ['36%', '48%', '76%'],
  ['22%', '70%', '84%'],
  ['30%', '54%', '92%'],
  ['40%', '66%', '72%'],
  ['26%', '58%', '86%'],
  ['34%', '44%', '80%'],
  ['24%', '64%', '90%'],
]
</script>
