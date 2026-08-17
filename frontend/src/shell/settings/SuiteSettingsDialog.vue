<template>
  <SettingsDialog v-model:open="showSettings" v-model:tab="settingsTab" size="5xl">
    <template #title>{{ __('Settings') }}</template>
    <SettingsSidebar>
      <SettingsNavGroup v-for="group in tabGroups" :key="group.label" :label="__(group.label)">
        <SettingsNavItem v-for="tab in group.items" :key="tab.value" :value="tab.value">
          <template #prefix>
            <Avatar
              v-if="tab.value === 'profile'"
              :image="imageURL"
              :label="fullName"
              size="xs"
              class="shrink-0"
            />
            <component :is="tab.icon" v-else class="size-4 shrink-0 text-ink-gray-6 stroke-[1.5]" />
          </template>
          {{ __(tab.label) }}
        </SettingsNavItem>
      </SettingsNavGroup>
    </SettingsSidebar>
    <SettingsContent>
      <SettingsPanel v-for="tab in visibleTabs" :key="tab.value" :value="tab.value">
        <component :is="tab.component" />
      </SettingsPanel>
    </SettingsContent>
  </SettingsDialog>
</template>

<script setup lang="ts">
import { computed, markRaw, watch } from 'vue'
import {
  Avatar,
  SettingsContent,
  SettingsDialog,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPanel,
  SettingsSidebar,
} from 'frappe-ui'
import { Settings, SlidersHorizontal } from 'lucide-vue-next'

import { useCurrentUser } from '@/boot/session'
import UserProfileSettings from '@/components/settings/UserProfileSettings.vue'
import PreferencesSettings from '@/shell/settings/PreferencesSettings.vue'
import { settingsTab, showSettings } from '@/shell/settings/useSettingsDialog'
import WorkspaceSettings from '@/shell/settings/WorkspaceSettings.vue'

const { fullName, imageURL, systemUser } = useCurrentUser()

const allGroups = [
  {
    label: 'Account',
    items: [
      { label: 'Profile', value: 'profile', component: markRaw(UserProfileSettings) },
      {
        label: 'Preferences',
        value: 'preferences',
        icon: SlidersHorizontal,
        component: markRaw(PreferencesSettings),
      },
    ],
  },
  {
    label: 'Workspace',
    condition: () => systemUser.value,
    items: [
      { label: 'General', value: 'workspace', icon: Settings, component: markRaw(WorkspaceSettings) },
    ],
  },
]

const tabGroups = computed(() => allGroups.filter((group) => !group.condition || group.condition()))
const visibleTabs = computed(() => tabGroups.value.flatMap((group) => group.items))

watch(
  visibleTabs,
  (tabs) => {
    if (!tabs.some((tab) => tab.value === settingsTab.value)) {
      settingsTab.value = 'profile'
    }
  },
  { immediate: true },
)
</script>
