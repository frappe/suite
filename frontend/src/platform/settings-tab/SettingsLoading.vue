<!--
  The one loading state in Settings: a spinner where the content will go.
  `SettingsPage :loading` shows it for a whole tab, and the dialog shows it
  while a tab's code loads. Use it alone only for a section that loads apart
  from the rest of its tab.
-->
<template>
  <div class="flex justify-center py-16" role="status" :aria-label="__('Loading')">
    <LoadingIndicator class="size-5 text-ink-gray-5" />
  </div>
</template>

<script setup lang="ts">
import { LoadingIndicator } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'
</script>
