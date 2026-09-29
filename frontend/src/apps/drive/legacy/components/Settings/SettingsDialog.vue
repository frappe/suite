<!--
  The legacy Drive app's Settings dialog: the account and workspace groups,
  then Drive's own. It goes with the legacy Drive app at deletion.
-->
<template>
  <SettingsDialog v-model:open="open" v-model:tab="activeTab" size="5xl" :keyboard-shortcut="false">
    <template #title>{{ __('Settings') }}</template>
    <SettingsSidebar>
      <SettingsNavGroup v-for="group in visibleGroups" :key="group.id" :label="__(group.label)">
        <SettingsNavItem v-for="tab in group.items" :key="tab.value" :value="tab.value">
          <template #prefix>
            <Avatar
              v-if="tab.value === 'profile'"
              :image="avatar ?? undefined"
              :label="fullName"
              size="xs"
              class="shrink-0"
              aria-hidden="true"
            />
            <component :is="tab.icon" v-else class="size-4 shrink-0 stroke-[1.5] text-ink-gray-6" />
          </template>
          {{ __(tab.label) }}
        </SettingsNavItem>
      </SettingsNavGroup>
    </SettingsSidebar>
    <SettingsContent>
      <SettingsPanel v-for="tab in visibleTabs" :key="tab.value" :value="tab.value">
        <component :is="tab.component" v-bind="tab.props" v-on="tab.listeners || {}" />
      </SettingsPanel>
    </SettingsContent>
  </SettingsDialog>
</template>
<script setup lang="ts">
import { computed, markRaw, ref, watch } from 'vue'
import {
  Avatar,
  SettingsContent,
  SettingsDialog,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPanel,
  SettingsSidebar,
} from 'frappe-ui'
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
import { useCommonSettingsGroups } from '@/components/settings/useCommonSettingsGroups'
import { useSession } from '@/platform/session'

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

const session = useSession()
const fullName = computed(() => session.user.value?.fullName ?? '')
const avatar = computed(() => session.user.value?.avatar ?? null)

const commonGroups = useCommonSettingsGroups()

// Drops hidden groups, hidden tabs, and groups left with no tab.
const visibleGroups = computed(() =>
  [...commonGroups.value, ...groups.value]
    .filter((group) => group.condition?.() ?? true)
    .map((group) => ({ ...group, items: group.items.filter((tab) => tab.condition?.() ?? true) }))
    .filter((group) => group.items.length > 0),
)
const visibleTabs = computed(() => visibleGroups.value.flatMap((group) => group.items))

const legacyTabs = ['profile', 'statistics', 'webdav', 'storage']

watch(
  () => props.suggestedTab,
  (suggestion) => {
    if (typeof suggestion === 'number') activeTab.value = legacyTabs[suggestion] ?? 'profile'
    else if (suggestion) activeTab.value = suggestion
  },
  { immediate: true },
)

// A tab the user may not see falls back to the first visible tab.
watch(
  visibleTabs,
  (tabs) => {
    if (!tabs.some((tab) => tab.value === activeTab.value)) activeTab.value = tabs[0]?.value ?? 'profile'
  },
  { immediate: true },
)
</script>
