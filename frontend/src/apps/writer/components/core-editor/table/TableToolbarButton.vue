<template>
  <Dropdown v-if="tableOptions" :options="tableOptions">
    <ToolbarButton icon="lucide-table" :label="__('Table options')" />
  </Dropdown>
  <ToolbarButton
    v-else
    icon="lucide-table"
    :label="__('Table')"
    @click="(event: MouseEvent) => openTableSizePicker(editor, event.currentTarget as Element)"
  />
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Dropdown } from 'frappe-ui'
import { computed, toRef } from 'vue'

import { translate as __ } from '@/platform/translation'

import ToolbarButton from '../ToolbarButton.vue'
import { useEditorVersion } from '../useEditorVersion'
import { TableEditing } from './tableEditing'
import { tableMenu } from './tableMenus'
import { openTableSizePicker } from './tableSizePicker'
import { selectionTarget } from './useTableTarget'

/** The toolbar's Table button: it opens the size grid for a new table, or in a table the table's options */
const props = defineProps<{ editor: Editor }>()

const version = useEditorVersion(toRef(props, 'editor'))

const tableOptions = computed(() => {
  void version.value
  const target = selectionTarget(props.editor)
  if (!target) return null
  return tableMenu({ table: new TableEditing(props.editor, target.cell), target })
})
</script>
