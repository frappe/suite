<template>
  <FeedbackProvider>
    <ShellLayout :areas="registry.areas" :active-area="activeArea" :badges="registry.badges.value">
      <router-view />
      <template #bell>
        <NotificationsBell />
      </template>
      <template #bell-tab>
        <NotificationsTab />
      </template>
    </ShellLayout>
    <DriveUploadTracker v-if="areaWork.showUploadTracker.value" />
  </FeedbackProvider>
</template>

<script setup lang="ts">
import { computed, provide } from 'vue'
import { useRoute } from 'vue-router'

import { drivePaletteSearch, DriveUploadTracker } from '@/apps/drive'
import { findArea, useAppRegistry, useAreaWork } from '@/composition/appRegistry'
import { settingsGroups } from '@/composition/settings'
import { PALETTE_SEARCH_KEY } from '@/platform/contracts'
import { defineAsyncWrapper } from '@/platform/load-failure'
import { AREA_PROGRESS_KEY } from '@/shell/areaProgress'
import { SETTINGS_GROUPS_KEY } from '@/shell/settings/settings'

// Each wraps the page or sits beside it: one that fails to load leaves the page showing, the load
// error page included.
const FeedbackProvider = defineAsyncWrapper(() =>
  import('@/platform/feedback').then(({ FeedbackProvider }) => FeedbackProvider),
)
const ShellLayout = defineAsyncWrapper(() => import('@/shell/ShellLayout.vue'))
const NotificationsBell = defineAsyncWrapper(
  () => import('@/composition/notifications/NotificationsBell.vue'),
)
const NotificationsTab = defineAsyncWrapper(
  () => import('@/composition/notifications/NotificationsTab.vue'),
)
const registry = useAppRegistry()
const route = useRoute()
const activeArea = computed(() => findArea(String(route.meta.area ?? '')))
provide(SETTINGS_GROUPS_KEY, settingsGroups)
provide(PALETTE_SEARCH_KEY, drivePaletteSearch)
const areaWork = useAreaWork()
provide(AREA_PROGRESS_KEY, areaWork.progress)
</script>
