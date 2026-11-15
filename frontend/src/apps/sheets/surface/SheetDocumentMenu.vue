<script setup lang="ts">
import { Button, Dropdown, type DropdownGroupOption, type DropdownOptions } from 'frappe-ui'
import { computed } from 'vue'

import {
  copyLinkAction,
  PANEL_BUTTONS,
  starAction,
  type DocumentPanel,
  type DocumentSession,
} from '@/apps/drive'
import { translate as __ } from '@/platform/translation'

/**
 * The spreadsheet's menu in the Drive header: the side panels this person can
 * open, Copy link, Star, and the editor's export and import items.
 */
const props = defineProps<{
  session: DocumentSession
  panels: readonly DocumentPanel[]
  panel: DocumentPanel | null
  /** The editor's own groups: Export, and Import and AI settings where allowed. */
  fileOptions: DropdownGroupOption[]
}>()

const emit = defineEmits<{ togglePanel: [panel: DocumentPanel] }>()

const options = computed<DropdownOptions>(() =>
  [
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
    {
      group: __('Document'),
      hideLabel: true,
      options: [copyLinkAction(), ...starAction(props.session)],
    },
    ...props.fileOptions.map((group) => ({ ...group, hideLabel: true })),
  ].filter((group) => group.options.length > 0),
)
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
