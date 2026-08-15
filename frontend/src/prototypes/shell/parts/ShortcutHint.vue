<!--
  PROTOTYPE — remove. Key hint over a rail icon, shown only while Cmd is held.
  It is absolute, so the rail keeps its geometry when the hints appear.
-->
<template>
  <span
    v-if="modifierHeld"
    class="absolute -right-1 -top-1 grid size-4 place-content-center rounded-1 bg-surface-gray-8 text-2xs text-ink-gray-1"
    aria-hidden="true"
  >
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { modifierHeld } from '../useShellShortcuts'

defineProps<{ label: string }>()
</script>
