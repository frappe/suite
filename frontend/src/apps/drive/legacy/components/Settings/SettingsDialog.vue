<template>
  <SuiteSettingsDialog v-model:open="open" v-model:tab="activeTab" :groups="groups" :shortcut="false" />
</template>
<script setup lang="ts">
import { computed, markRaw, ref, watch } from 'vue'
import {
  ChartBar,
  CloudCog,
  HardDrive,
} from 'lucide-vue-next'

import BackendSettings from '@/apps/drive/legacy/components/Settings/BackendSettings.vue'
import StorageSettings from '@/apps/drive/legacy/components/Settings/StorageSettings.vue'
import WebDAVSettings from '@/apps/drive/legacy/components/Settings/WebDAVSettings.vue'
import { isAdmin, webdavConfig } from '@/apps/drive/legacy/resources/permissions'
import type { SettingsGroup } from '@/components/settings/types'
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'

const props = defineProps<{
  suggestedTab?: string | number
}>()

const open = defineModel<boolean>('open', { default: false })
const activeTab = ref('profile')

if (!isAdmin.data) isAdmin.fetch()
if (!webdavConfig.data) webdavConfig.fetch()

const groups = computed<SettingsGroup[]>(() => [
  {
    id: 'drive',
    label: 'Drive',
    items: [
      {
        label: 'Statistics',
        value: 'statistics',
        icon: ChartBar,
        component: markRaw(StorageSettings),
      },
      {
        label: 'External Access',
        value: 'webdav',
        icon: HardDrive,
        component: markRaw(WebDAVSettings),
        condition: () => Boolean(webdavConfig.data && Object.keys(webdavConfig.data).length),
      },
    ],
  },
  {
    id: 'drive-administration',
    label: 'Administration',
    condition: () => Boolean(isAdmin.data?.is_admin),
    items: [
      {
        label: 'Storage',
        value: 'storage',
        icon: CloudCog,
        component: markRaw(BackendSettings),
      },
    ],
  },
])

const legacyTabs = ['profile', 'statistics', 'webdav', 'storage']

watch(
  () => props.suggestedTab,
  (suggestion) => {
    if (typeof suggestion === 'number') activeTab.value = legacyTabs[suggestion] ?? 'profile'
    else if (suggestion) activeTab.value = suggestion
  },
  { immediate: true },
)
</script>
