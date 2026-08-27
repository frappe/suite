<script setup lang="ts">
import { provide } from 'vue'
import { FrappeUIProvider } from 'frappe-ui'

import FDialogs from '@/apps/writer/components/FDialogs.vue'
import { setupTheme } from '@/utils/setupTheme'

/**
 * Writer route-group layout.
 *
 * The suite shell already provides the top-level chrome, so this layout only:
 *   - provides the `inIframe` injection that Document.vue depends on,
 *   - wraps children in FrappeUIProvider + the writer's FDialogs host and
 *     renders the nested <router-view>.
 *
 * Boot side-effects (`allUsers.fetch()`) are triggered on writer module load
 * in routes.ts.
 */
const inIframe = window.self !== window.top
provide('inIframe', inIframe)
setupTheme()

</script>

<template>
  <FrappeUIProvider>
    <div class="flex flex-col h-screen">
      <router-view :key="$route.fullPath" v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </div>
    <FDialogs />
  </FrappeUIProvider>
</template>
