<script setup lang="ts">
import { Skeleton } from 'frappe-ui'
import { ListCell, ListRow } from 'frappe-ui/list'

import { SKELETON_BAR, type SkeletonCell } from './listSkeleton'

/** Placeholder rows on a List's tracks: a name, then `cells`, then the actions cell. */
defineProps<{ cells: SkeletonCell[] }>()

/** Name bar widths, varied so the placeholder reads as a list of names. */
const SKELETON_NAMES = [
  'w-40',
  'w-28',
  'w-52',
  'w-36',
  'w-24',
  'w-44',
  'w-32',
  'w-48',
  'w-28',
  'w-36',
]

/** Date bar widths, repeating down the rows. */
const DATE_WIDTHS = ['w-10', 'w-14', 'w-14']

function dateWidth(index: number) {
  return DATE_WIDTHS[index % DATE_WIDTHS.length]
}
</script>

<template>
  <!-- Placeholder rows share the real rows' tracks, so nothing moves when data arrives. -->
  <ListRow v-for="(width, index) in SKELETON_NAMES" :key="index" aria-hidden="true">
    <ListCell>
      <Skeleton class="mr-2 size-4 shrink-0 rounded-1" :class="SKELETON_BAR" />
      <Skeleton class="h-2 max-w-full rounded-full" :class="[SKELETON_BAR, width]" />
    </ListCell>
    <ListCell v-for="(cell, column) in cells" :key="column" :class="cell.class">
      <Skeleton
        v-if="cell.hasDate"
        class="h-2 rounded-full"
        :class="[SKELETON_BAR, dateWidth(index)]"
      />
    </ListCell>
    <ListCell />
  </ListRow>
</template>
