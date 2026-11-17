<!--
  The header of a Settings list with bulk actions: a checkbox that selects
  every row, and once rows are selected, their count, the bulk actions and a
  button that clears the selection. Put it in the `SettingsSection` straight
  above the rows, with a `useSettingsSelection` shared by both.

  - `#actions`: the bulk actions, as small buttons. A destructive one asks
    first, naming the count.

  Its checkbox sits on the column where each row shows its own, so the two
  line up.
-->
<template>
  <div class="flex min-h-12 items-center gap-3 py-2">
    <!-- With nothing selected, the checkbox carries its own "Select all" label;
         after that the count takes the label's place. -->
    <Checkbox
      :model-value="selection.all"
      :indeterminate="selection.count > 0 && !selection.all"
      :aria-label="selection.count ? __('Select all') : undefined"
      @update:model-value="selection.toggleAll()"
    >
      <template v-if="!selection.count" #label>
        <span class="text-base text-ink-gray-6">{{ __('Select all') }}</span>
      </template>
    </Checkbox>
    <template v-if="selection.count">
      <span class="min-w-0 flex-1 truncate text-base text-ink-gray-8">
        {{ __('{0} selected', [selection.count]) }}
      </span>
      <div class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
        <Button
          variant="ghost"
          icon="lucide-x"
          :aria-label="__('Clear selection')"
          @click="selection.clear()"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Button, Checkbox } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

import type { SettingsSelection } from './useSettingsSelection'

defineProps<{ selection: SettingsSelection }>()
defineSlots<{ actions?: () => unknown }>()
</script>
