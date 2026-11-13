<script setup lang="ts">
import { Button, Dropdown, type DropdownOptions } from 'frappe-ui'
import { computed } from 'vue'

import { PANEL_BUTTONS, type DocumentPanel } from '@/apps/drive'
import { translate as __ } from '@/platform/translation'

/** The spreadsheet's menu in the Drive header: the side panels this person can open. */
const props = defineProps<{
  panels: readonly DocumentPanel[]
  panel: DocumentPanel | null
}>()

const emit = defineEmits<{ togglePanel: [panel: DocumentPanel] }>()

const options = computed<DropdownOptions>(() => [
  {
    group: __('Panels'),
    hideLabel: true,
    options: props.panels.map((name) => ({
      label: __(PANEL_BUTTONS[name].label),
      icon: PANEL_BUTTONS[name].icon,
      selected: props.panel === name,
      onClick: () => emit('togglePanel', name),
    })),
  },
])
</script>

<template>
  <Dropdown :options="options" align="end">
    <Button
      variant="ghost"
      icon="lucide-ellipsis"
      :tooltip="__('More document actions')"
      :aria-label="__('More document actions')"
    />
  </Dropdown>
</template>
