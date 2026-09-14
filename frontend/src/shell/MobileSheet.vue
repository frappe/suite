<template>
  <BottomSheet
    :open="open"
    :title="title"
    @update:open="$emit('update:open', $event)"
  >
    <div class="flex max-h-[70dvh] min-h-0 flex-col">
      <slot />
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { BottomSheet } from "frappe-ui";

defineProps<{ open: boolean; title?: string }>();
defineEmits<{ "update:open": [value: boolean] }>();
</script>
