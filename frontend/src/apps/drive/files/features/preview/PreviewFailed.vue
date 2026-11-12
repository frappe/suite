<script setup lang="ts">
import { translate as __ } from '@/platform/translation'

import PreviewFallback from './PreviewFallback.vue'

/** Shown when a preview did not load, with the file's download link when it has one. */
defineProps<{ download?: string }>()
</script>

<template>
  <PreviewFallback
    :title="__('Could not load the preview')"
    :message="__('Download this file to open it.')"
    :download="download"
  />
</template>
