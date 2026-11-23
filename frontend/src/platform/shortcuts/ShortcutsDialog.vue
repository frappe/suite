<template>
  <!-- frappe-ui's search sees only its own registry, so Suite's list draws the
       search field and frappe-ui's never shows. -->
  <KeyboardShortcutsDialog
    v-model:open="open"
    :title="__('Keyboard shortcuts')"
    :search-threshold="Infinity"
  >
    <template #default="{ groups }">
      <ShortcutsList :registry="groups" />
    </template>
  </KeyboardShortcutsDialog>
</template>

<script setup lang="ts">
import { KeyboardShortcutsDialog } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

import ShortcutsList from './ShortcutsList.vue'

/** The one shortcuts list in Suite: frappe-ui's dialog, drawing Suite's list. */
const open = defineModel<boolean>('open', { required: true })
</script>
