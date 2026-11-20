<template>
  <!-- The list's filters as a row of state chips rather than a menu, so a filter can never be
       mistaken for a folder. "All" is none of them ticked; the others combine. A ticked chip keeps
       an outlined chip's 1px border, transparent, so ticking one never changes its size. -->
  <div class="flex items-center gap-1.5">
    <Button
      size="sm"
      :variant="activeKeys.length ? 'outline' : 'subtle'"
      class="rounded-4"
      :class="{
        'border border-transparent !bg-surface-gray-3 hover:!bg-surface-gray-4': !activeKeys.length,
      }"
      :label="__('All')"
      @click="clear()"
    />
    <Button
      v-for="option in filterOptions.filter((o) => !o.condition || o.condition())"
      :key="option.key"
      size="sm"
      :variant="activeKeys.includes(option.key) ? 'subtle' : 'outline'"
      class="rounded-4"
      :class="{
        'border border-transparent !bg-surface-gray-3 hover:!bg-surface-gray-4':
          activeKeys.includes(option.key),
      }"
      :label="option.label"
      @click="option.onClick()"
    />
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'

import type { FilterOption } from '@/apps/mail/utils/listFilter'

const { filter } = defineProps<{
  filterOptions: FilterOption[]
  /** The filters in effect, comma-joined (`filter_by`), or none. */
  filter: string | null
  /** Take every filter off. */
  clear: () => void
}>()

const activeKeys = computed(() => (filter ? filter.split(',') : []))
</script>
