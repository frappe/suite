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
 * keep one order: the side panels and what goes with them, Copy link with
 * export and import, the surface's setting above the file's actions, then
 * what removes it. A surface passes only what is its own, and a group with
 * nothing in it leaves no gap.
 */
const props = defineProps<{
  session: DocumentSession
  /** The side panels this person can open, and the one open now. */
  panels?: readonly DocumentPanel[]
  panel?: DocumentPanel | null
  /** What goes with the panels, such as Save version. */
  review?: DropdownOption[]
  /** A file's own items, in place of a document's Copy link. */
  link?: DropdownOption[]
  /** The export items, then the import items. */
  transfer?: DropdownOption[]
  /** What sets this surface's document up, such as Lock. */
  settings?: DropdownOption[]
  /** A file's own actions, in place of a document's Star and Make a copy. */
  file?: DropdownOption[]
  /** What throws this person's own work away, such as Discard my changes. */
  discard?: DropdownOption[]
  /** A file's own ways out, in place of a document's Move to trash. */
  remove?: DropdownOption[]
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
  const { file, remove } = documentActions.value
  // The dropdown leaves out a group with nothing to show
  return [
    { group: __('Comments and versions'), options: [...panels, ...(props.review ?? [])] },
    {
      group: __('Share and export'),
      options: [...(props.link ?? [copyLinkAction()]), ...(props.transfer ?? [])],
    },
    {
      group: __('File'),
      options: [
        ...(props.settings ?? []),
        ...(props.file ?? [...starAction(props.session), ...file]),
      ],
    },
    { group: __('Remove'), options: [...(props.discard ?? []), ...(props.remove ?? remove)] },
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
