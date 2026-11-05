<template>
  <!-- A quiet label: a short tinted row, the date, with the day's checkbox and the fold's
       chevron. -->
  <div
    class="text-ink-gray-5 group flex h-9 items-center border-b px-3.5 text-xs-semibold sm:px-5"
    :class="{
      'bg-surface-amber-1': tinted,
      'bg-surface-gray-1': !tinted,
      'sm:hover:bg-surface-gray-1': collapsible,
      '!bg-surface-gray-1': selected,
      [CURSOR_BAR_CLASS]: focused,
    }"
    :data-row-key="`group:${dateKey}`"
    @click="emit('toggle')"
  >
    <!-- The mailbox list puts its "select the whole day" checkbox here: centred in the row
         whatever its height, and a click on it selects the day without folding it. -->
    <div v-if="$slots.lead" class="flex items-center self-stretch" @click.stop>
      <slot name="lead" />
    </div>

    <span class="select-none pt-[2px]">
      {{ dateGroupLabel(dateKey) }}
    </span>

    <component
      :is="collapsed ? ChevronRight : ChevronDown"
      v-if="collapsible"
      class="icon ml-auto"
    />
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { computed } from 'vue'

import { CURSOR_BAR_CLASS } from '@/apps/mail/constants'
import { dateGroupLabel, PINNED_GROUP } from '@/apps/mail/utils/dateGroups'

/**
 * A date header in a thread list: the day (or month) it covers, a chevron that folds it, and whatever
 * the list wants beside the date.
 *
 * Both lists draw the same header — same classes, same date span, same chevron — and this is the one
 * navigable row neither gets from buildListRows, which is deliberately date-agnostic.
 */

const props = defineProps<{
  /** The group's key (see dateGroup): a recent group's name, or an older month's 'YYYY-MM'. */
  dateKey: string
  /** Currently folded. */
  collapsed: boolean
  /**
   * Whether this group can fold at all. The last one never can — it is where infinite scroll
   * appends, so hiding it would swallow newly loaded rows.
   */
  collapsible: boolean
  /** The keyboard cursor is on this header. */
  focused: boolean
  /** Every thread in the group is selected (the mailbox list's day checkbox). */
  selected?: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()

const tinted = computed(() => props.dateKey === PINNED_GROUP)
</script>
