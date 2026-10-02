<!-- Calendar's area icon: a calendar page, with its header as a second layer
     and one day as the accent. -->
<template>
  <DuotoneIcon>
    <rect data-tone="tint" x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path
      data-tone="tint"
      stroke="none"
      d="M3 7a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 7v2.5H3Z"
    />
    <path d="M3 9.5h18M8 2.75v3.5m8-3.5v3.5" />
    <rect data-tone="accent" x="13.5" y="13" width="4" height="4" rx="1" />
  </DuotoneIcon>
</template>

<script setup lang="ts">
import { DuotoneIcon } from "@/platform/duotone-icon";
</script>
