<template>
  <div class="flex h-7 w-full items-center justify-between">
    <span :class="labelClasses">{{ label }}</span>
    <slot />
  </div>
</template>

<script setup>
import { labelClasses } from '@/apps/slides/utils/constants'

defineProps({ label: String })
</script>
