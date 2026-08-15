<!--
  PROTOTYPE — remove. Search affordance in the page header. It is a button, not
  an input: typing happens in the palette, so a real field here would take focus
  the palette immediately steals back.
-->
<template>
  <Button
    variant="subtle"
    label="Search"
    icon-left="lucide-search"
    @click="commandPaletteOpen = true"
  >
    <template #suffix>
      <KeyboardShortcut combo="Mod+K" />
    </template>
  </Button>
</template>

<script setup lang="ts">
import { Button, KeyboardShortcut } from 'frappe-ui'

import { commandPaletteOpen } from '../useCommandPalette'
</script>
