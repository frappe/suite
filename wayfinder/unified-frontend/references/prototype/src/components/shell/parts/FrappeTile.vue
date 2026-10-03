<!--
  The Frappe mark on its brand tile, used as the org workspace's avatar. The
  two colours are brand constants, not theme tokens, so the tile keeps its
  identity in dark mode. The caller owns the size; the mark is always half the
  tile.
-->
<template>
  <span class="grid place-items-center rounded-3 bg-[#171717]">
    <FrappeMark class="h-1/2 text-white" />
  </span>
</template>

<script setup lang="ts">
import FrappeMark from './FrappeMark.vue'
</script>
