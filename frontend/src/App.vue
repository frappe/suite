<template>
  <FeedbackProvider>
    <ShellLayout :areas="registry.areas" :badges="registry.badges.value">
      <router-view />
      <template #bell>
        <NotificationsBell />
      </template>
    </ShellLayout>
    <DriveUploadTracker v-if="areaWork.showUploadTracker.value" />
  </FeedbackProvider>
</template>

<script setup lang="ts">
import { defineAsyncComponent, provide } from 'vue'

import { DriveUploadTracker } from '@/apps/drive'
import { useAppRegistry, useAreaWork } from '@/composition/appRegistry'
import { documentTypes } from '@/composition/documentRegistry'
import { settingsGroups } from '@/composition/settings'
import { DOCUMENT_TYPES_KEY } from '@/platform/contracts'
import { AREA_PROGRESS_KEY } from '@/shell/areaProgress'
import { SETTINGS_GROUPS_KEY } from '@/shell/settings/settings'

const FeedbackProvider = defineAsyncComponent(() =>
  import('@/platform/feedback').then(({ FeedbackProvider }) => FeedbackProvider),
)
const ShellLayout = defineAsyncComponent(() => import('@/shell/ShellLayout.vue'))
const NotificationsBell = defineAsyncComponent(
  () => import('@/composition/notifications/NotificationsBell.vue'),
)
const registry = useAppRegistry()
provide(DOCUMENT_TYPES_KEY, documentTypes)
provide(SETTINGS_GROUPS_KEY, settingsGroups)
const areaWork = useAreaWork()
provide(AREA_PROGRESS_KEY, areaWork.progress)
</script>
