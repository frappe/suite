<template>
  <!-- The toolbar's select-all box, ahead of the list's own row boxes. With only some of the list
       ticked it shows a dash, and a click clears them, as it does with all of them ticked. -->
  <Tooltip :text="selected || some ? __('Clear All (Esc)') : __('Select All ({0}+A)', [modifier])">
    <div
      class="checkbox-hitbox -m-3 flex cursor-pointer items-center p-3"
      @click.stop.prevent="emit('toggle', !(selected || some))"
    >
      <Checkbox
        :model-value="selected"
        :indeterminate="some && !selected"
        size="md"
        class="pointer-events-none"
      />
    </div>
  </Tooltip>
</template>

<script setup lang="ts">
import { Checkbox, Tooltip } from 'frappe-ui'

import { isMac } from '@/apps/mail/utils'

const { selected, some = false } = defineProps<{
  selected: boolean
  /** Some of the list is ticked, but not all of it. */
  some?: boolean
}>()
const emit = defineEmits<{ toggle: [selected: boolean] }>()

const modifier = isMac ? '⌘' : 'Ctrl'
</script>
