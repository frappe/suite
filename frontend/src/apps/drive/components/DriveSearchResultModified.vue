<template>
  <span class="text-ink-gray-5">{{ relativeModified }}</span>
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import { useTimeAgo } from '@vueuse/core'

const props = defineProps<{ modified?: string }>()
const relativeModified = useTimeAgo(toRef(props, 'modified'))
</script>
