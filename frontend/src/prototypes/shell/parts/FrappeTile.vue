<!--
  PROTOTYPE — remove. The Frappe mark on its brand tile, used as the org
  workspace's avatar. Composed rather than pulled from frappe.io, whose logo
  file is a 160px transparent PNG with no tile; this stays crisp at any size.

  The two colours are brand constants, not theme tokens, so the tile keeps its
  identity in dark mode the way an uploaded workspace avatar would. #171717 is
  Frappe's own mark colour, taken from frappe-favicon.svg and from the logo on
  frappe.io. Same reasoning as suite.svg, which bakes in its purple.

  The caller owns the size; the mark is always half the tile.
-->
<template>
  <span class="grid place-items-center rounded-3 bg-[#171717]">
    <FrappeMark class="h-1/2 text-white" />
  </span>
</template>

<script setup lang="ts">
import FrappeMark from './FrappeMark.vue'
</script>
