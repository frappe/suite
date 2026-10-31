<!--
  The decided workspace shell (app rail + tabs + contextual panels).
  Fake data only (see fixtures.ts); no persistence, no backend.

  Every overlay is mounted here, as a sibling of the shell rather than inside
  whichever screen opens it: an overlay owned by a panel has its mounting and
  unmounting tangled up with that panel's own rendering.
-->
<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-base">
    <ShellLayout />
    <CommandPalette />
    <NewTabDialog />
    <MailSettingsDialog />
  </div>
</template>

<script setup lang="ts">
import CommandPalette from './CommandPalette.vue'
import MailSettingsDialog from './parts/MailSettingsDialog.vue'
import NewTabDialog from './parts/NewTabDialog.vue'
import ShellLayout from './ShellLayout.vue'
</script>
