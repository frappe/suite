<!--
  PROTOTYPE — remove. Mounts the real Sheets editor inside the shell's content
  area.

  The editor component takes an id and emits close/saved, with no router of its
  own, so the shell can own where those go. Only its height needs correcting:
  it is written for a full viewport.
-->
<template>
  <div class="sheet-pane flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <!-- embedded: the shell's header already names the document. -->
    <SheetEditor :id="id" embedded @close="go('files')" />
    <Dialogs />
  </div>
</template>

<script setup lang="ts">
import { Dialogs } from 'frappe-ui'

import SheetEditor from '@/apps/sheets/components/SheetEditor/index.vue'

import { useShellNav } from '../useShellNav'

defineProps<{ id: string }>()

// The editor's own close button is the shell's way back to the file list.
const { go } = useShellNav()
</script>

<style scoped>
/* The editor sizes itself to the viewport. Inside the shell it has to fill the
   pane instead, or it runs a rail's height past the bottom of the window. */
.sheet-pane :deep(.sn-root) {
  height: 100%;
}
</style>
