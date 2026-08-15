<!--
  PROTOTYPE — remove. Search sits in the sidebar, not in a page header, so it is
  in the same place on every screen — including Mail and Calendar, which have no
  page header at all. It is a SidebarItem so it reads as one of the nav rows.

  It is a button, not an input: typing happens in the palette, so a real field
  here would take focus the palette immediately steals back.
-->
<template>
  <SidebarItem
    label="Search"
    icon="lucide-search"
    @click="commandPaletteOpen = true"
  >
    <template #suffix>
      <KeyboardShortcut combo="Mod+K" :show-plus="false" class="mr-2" />
    </template>
  </SidebarItem>
</template>

<script setup lang="ts">
import { KeyboardShortcut, SidebarItem } from 'frappe-ui'

import { commandPaletteOpen } from '../useCommandPalette'
</script>
