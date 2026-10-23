<!--
  Suite-wide search, in the top bar so it sits in the same place on every
  screen — including Mail and Calendar, whose panels differ completely.

  It is a button, not an input: typing happens in the palette, so a real field
  here would take focus the palette immediately steals back.
-->
<template>
  <button
    type="button"
    class="flex h-8 w-full items-center gap-2 rounded-4 border border-outline-gray-1 bg-surface-gray-1 px-2.5 transition hover:bg-surface-gray-2"
    @click="commandPaletteOpen = true"
  >
    <span class="lucide-search size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
    <span class="min-w-0 flex-1 truncate text-left text-base text-ink-gray-5">
      Search {{ currentWorkspace.name }}…
    </span>
    <span
      class="shrink-0 rounded-1 border border-outline-gray-2 px-1 text-xs text-ink-gray-5"
      aria-hidden="true"
    >
      ⌘K
    </span>
  </button>
</template>

<script setup lang="ts">
import { commandPaletteOpen } from '../useCommandPalette'
import { currentWorkspace } from '../workspaceState'
</script>
