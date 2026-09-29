<script setup lang="ts">
import { computed, onScopeDispose, provide } from 'vue'
import { FrappeUIProvider } from 'frappe-ui'
import { useRoute, useRouter } from 'vue-router'

import FDialogs from '@/apps/writer/components/FDialogs.vue'
import { createDocument } from '@/apps/writer/resources'
import { useSessionStore } from '@/boot/session'
import { useRootStore } from '@/stores/root'
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

const router = useRouter()
const route = useRoute()
const isLoggedIn = computed(() => useSessionStore().isLoggedIn)
const unregisterPaletteGroups = useRootStore().registerPaletteGroups('writer-layout', () => {
  if (!isLoggedIn.value || route.name !== 'writer-home') return []

  return [
    {
      commands: [
        {
          id: 'writer-new-document',
          label: 'New document',
          enterHint: 'create document',
          icon: 'lucide-plus',
          keywords: ['create', 'writer'],
          run: () =>
            createDocument.submit(null, {
              onSuccess: (document) =>
                router.push({
                  name: 'writer-document',
                  params: { id: document.name },
                }),
            }),
        },
      ],
    },
  ]
})
onScopeDispose(unregisterPaletteGroups)

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
