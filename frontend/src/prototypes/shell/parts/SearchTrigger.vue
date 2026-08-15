<!--
  PROTOTYPE — remove. Search lives in the rail, so it sits in the same place on
  every screen — including Mail and Calendar, whose panels differ completely.

  It is a button, not an input: typing happens in the palette, so a real field
  here would take focus the palette immediately steals back.
-->
<template>
  <RailItem label="Search" variant="ghost" @click="commandPaletteOpen = true">
    <span class="lucide-search size-4" aria-hidden="true" />
    <ShortcutHint label="K" />
  </RailItem>
</template>

<script setup lang="ts">
import { RailItem } from 'frappe-ui'

import { commandPaletteOpen } from '../useCommandPalette'
import ShortcutHint from './ShortcutHint.vue'
</script>
