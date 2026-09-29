<!--
  The shell's desktop sidebar slot. `<AreaSidebar>` teleports into it, so a
  page's sidebar sits beside the page header target. With no sidebar on the
  page it takes no space.
-->
<template>
  <div :id="AREA_SIDEBAR_TARGET_ID" class="contents" />
</template>

<script setup lang="ts">
import { AREA_SIDEBAR_TARGET_ID } from './state'
</script>
