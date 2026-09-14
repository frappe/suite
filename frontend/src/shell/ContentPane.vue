<template>
  <div
    data-shell-content-pane
    :data-scroll-owner="scroll"
    class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base text-ink-gray-8"
    :class="scroll === 'content' ? 'h-full overflow-hidden' : 'min-h-full'"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import type { ScrollOwner } from "@/platform/contracts";

withDefaults(defineProps<{ scroll?: ScrollOwner }>(), { scroll: "shell" });
</script>
