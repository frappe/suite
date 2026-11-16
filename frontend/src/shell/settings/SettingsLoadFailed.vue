<!-- Failed settings modules retry through the shared section presentation. -->
<script setup lang="ts">
import { LoadFailed } from '@/platform/load-failed'
import { translate as __ } from '@/platform/translation'

defineProps<{ retry: () => Promise<void> }>()
</script>
<template>
  <LoadFailed variant="section" :title="__('Could not load settings')" :retry="retry" />
</template>
