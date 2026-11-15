<script setup lang="ts">
import { Button, Dropdown, type DropdownOption, type DropdownOptions } from 'frappe-ui'
import { computed } from 'vue'

import { useDriveDocumentActions } from '@/apps/drive'
import type { DocumentSession } from '@/apps/drive/client/session'
import type { DocumentPanel } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { copyLinkAction, PANEL_BUTTONS, starAction } from './header'

/**
 * The menu every document header shows, so each one reads alike. Its groups
 * keep one order: the side panels, Copy link and Star, the surface's own
 * items, export and import, then the file's actions. A surface passes only
 * what is its own, and a group with nothing in it leaves no gap.
 */
const props = defineProps<{
  session: DocumentSession
  /** The side panels this person can open, and the one open now. */
  panels?: readonly DocumentPanel[]
  panel?: DocumentPanel | null
  /** A file's own link items, in place of a document's Copy link and Star. */
  link?: DropdownOption[]
  /** What only this surface does to its document, such as Save version. */
  own?: DropdownOption[]
  /** The export items, then the import items. */
  transfer?: DropdownOption[]
  /** A file's own actions, in place of a document's Make a copy and Move to trash. */
  file?: DropdownOption[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  togglePanel: [panel: DocumentPanel]
  /** The menu opened or closed. */
  open: [open: boolean]
  /** The button took focus, as it does when the menu closes. */
  focusBack: []
}>()

const documentActions = useDriveDocumentActions(props.session)

const options = computed<DropdownOptions>(() => {
  const panels = (props.panels ?? []).map((name) => ({
    label: __(PANEL_BUTTONS[name].label),
    icon: PANEL_BUTTONS[name].icon,
    selected: props.panel === name,
    onClick: () => emit('togglePanel', name),
  }))
  const link = props.link ?? [copyLinkAction(), ...starAction(props.session)]
  // The dropdown leaves out a group with nothing to show
  return [
    { group: __('Panels'), options: panels },
    { group: __('Link'), options: link },
    { group: __('Document'), options: props.own ?? [] },
    { group: __('Export and import'), options: props.transfer ?? [] },
    { group: __('File'), options: props.file ?? documentActions.value },
  ].map((group) => ({ ...group, hideLabel: true }))
})
</script>

<template>
  <Dropdown :options="options" align="end" @update:open="emit('open', $event)">
    <Button
      variant="ghost"
      icon="lucide-ellipsis"
      :tooltip="__('More actions')"
      :aria-label="__('More actions')"
      :disabled="disabled"
      @focus="emit('focusBack')"
    />
  </Dropdown>
</template>
