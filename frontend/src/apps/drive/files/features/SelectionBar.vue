<!--
  The toolbar while items are selected: the count first, then what the
  selection allows, then Done. One selected item also gets its row menu
  behind "…", so a card on a phone, which hides its own "…" while selecting,
  still reaches Rename, Share and Details. A phone shows the actions as icons.
-->
<template>
  <div class="flex min-w-0 items-center gap-2">
    <span class="shrink-0 whitespace-nowrap pr-1 text-base text-ink-gray-7 tabular-nums">{{
      __('{0} selected', [count])
    }}</span>
    <template v-for="action in actions" :key="action.label">
      <Button
        v-if="compact"
        :icon="action.icon"
        :aria-label="action.label"
        :tooltip="action.label"
        :disabled="action.disabled"
        @click="action.onClick"
      />
      <Button
        v-else
        :label="action.label"
        :icon-left="action.icon"
        :disabled="action.disabled"
        @click="action.onClick"
      />
    </template>
    <Dropdown v-if="menu.length" :options="menu" align="start">
      <Button icon="lucide-ellipsis" :aria-label="__('More actions')" />
    </Dropdown>
  </div>
  <Button variant="ghost" :label="__('Done')" @click="emit('done')" />
</template>

<script setup lang="ts">
import { Button, type DropdownItem } from 'frappe-ui'

import { Dropdown } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

export interface SelectionAction {
  label: string
  icon: string
  disabled?: boolean
  onClick: () => unknown
}

defineProps<{
  count: number
  actions: readonly SelectionAction[]
  /** The one selected item's own menu, or empty for several items. */
  menu: DropdownItem[]
  /** Icons only, for a phone. */
  compact: boolean
}>()
const emit = defineEmits<{ done: [] }>()
</script>
