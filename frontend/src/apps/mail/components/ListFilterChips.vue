<template>
  <!-- The list's filters as a row of state chips rather than a menu, so a filter can never be
       mistaken for a folder. "All" is none of them ticked; the others combine. A ticked chip keeps
       an outlined chip's 1px border, transparent, so ticking one never changes its size. A phone
       draws the same chips a size up, for a thumb, in a row that scrolls. In `outline` they stand
       as blank chips of the same size, beside other outlines loading around them. -->
  <div
    v-if="outline"
    class="flex w-max animate-pulse items-center gap-1.5"
    aria-hidden="true"
    data-testid="filter-chips-outline"
  >
    <Button
      v-for="label in [__('All'), ...visibleOptions.map((o) => o.label)]"
      :key="label"
      :size="size"
      variant="subtle"
      class="pointer-events-none rounded-4 border border-transparent !bg-surface-gray-2 !text-transparent"
      tabindex="-1"
      :label="label"
    />
  </div>
  <div v-else class="flex w-max items-center gap-1.5">
    <Button
      :size="size"
      :variant="activeKeys.length ? 'outline' : 'subtle'"
      class="rounded-4"
      :class="{
        'border border-transparent !bg-surface-gray-3 hover:!bg-surface-gray-4': !activeKeys.length,
      }"
      :label="__('All')"
      @click="clear()"
    />
    <Button
      v-for="option in visibleOptions"
      :key="option.key"
      :size="size"
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

import { useScreenSize } from '@/apps/mail/utils/composables'
import type { FilterOption } from '@/apps/mail/utils/listFilter'

const {
  filterOptions,
  filter,
  outline = false,
} = defineProps<{
  filterOptions: FilterOption[]
  /** The filters in effect, comma-joined (`filter_by`), or none. */
  filter: string | null
  /** Take every filter off. */
  clear: () => void
  /** Drawn in outline, the chips' size, while what stands around them loads. */
  outline?: boolean
}>()

const { isMobile } = useScreenSize()
const size = computed(() => (isMobile.value ? 'md' : 'sm'))
const activeKeys = computed(() => (filter ? filter.split(',') : []))
const visibleOptions = computed(() => filterOptions.filter((o) => !o.condition || o.condition()))
</script>
