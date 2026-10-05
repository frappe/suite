<script setup lang="ts">
import { SidebarItem } from 'frappe-ui'
import { useRoute } from 'vue-router'

import { translate as __ } from '@/platform/translation'

const route = useRoute()
</script>

<template>
  <nav class="space-y-0.5" aria-label="Meet views">
    <SidebarItem
      :label="__('Meetings')"
      icon="lucide-video"
      route="/meet"
      :active="route.name === 'meet-home'"
    />
    <SidebarItem
      label="Recordings"
      icon="lucide-circle-play"
      route="/meet/recordings"
      :active="route.name === 'meet-recordings'"
    />
  </nav>
</template>
