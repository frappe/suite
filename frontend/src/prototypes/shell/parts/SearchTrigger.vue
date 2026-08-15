<!--
  PROTOTYPE — remove. Search affordance under the workspace switcher. It lives
  in the sidebar, not in a page header, so it sits in the same place on every
  screen — including Mail and Calendar, which have no page header at all.

  It is a button, not an input: typing happens in the palette, so a real field
  here would take focus the palette immediately steals back.
-->
<template>
  <Button
    variant="subtle"
    label="Search"
    icon-left="lucide-search"
    class="w-full justify-start"
    @click="commandPaletteOpen = true"
  >
    <template #suffix>
      <KeyboardShortcut combo="Mod+K" class="ml-auto" />
    </template>
  </Button>
</template>

<script setup lang="ts">
import { Button, KeyboardShortcut } from 'frappe-ui'

import { commandPaletteOpen } from '../useCommandPalette'
</script>
