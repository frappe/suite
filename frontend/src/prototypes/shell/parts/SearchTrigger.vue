<!--
  PROTOTYPE — remove. Search lives in the rail, so it sits in the same place on
  every screen — including Mail and Calendar, whose panels differ completely.

  It is a button, not an input: typing happens in the palette, so a real field
  here would take focus the palette immediately steals back.
-->
<template>
  <RailItem
    label="Search"
    icon="lucide-search"
    variant="ghost"
    @click="commandPaletteOpen = true"
  />
</template>

<script setup lang="ts">
import { RailItem } from 'frappe-ui'

import { commandPaletteOpen } from '../useCommandPalette'
</script>
