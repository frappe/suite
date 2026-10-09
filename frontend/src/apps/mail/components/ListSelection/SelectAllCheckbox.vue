<template>
  <!-- The toolbar's select-all box, ahead of the list's own row boxes. -->
  <Tooltip :text="selected ? __('Clear All (Esc)') : __('Select All ({0}+A)', [modifier])">
    <div
      class="checkbox-hitbox -m-3 cursor-pointer p-3"
      @click.stop.prevent="emit('toggle', !selected)"
    >
      <Checkbox :model-value="selected" size="md" class="pointer-events-none" />
    </div>
  </Tooltip>
</template>

<script setup lang="ts">
import { Checkbox, Tooltip } from 'frappe-ui'

import { isMac } from '@/apps/mail/utils'

const { selected } = defineProps<{ selected: boolean }>()
const emit = defineEmits<{ toggle: [selected: boolean] }>()

const modifier = isMac ? '⌘' : 'Ctrl'
</script>
