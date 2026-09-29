<template>
  <SettingsDialog
    v-model:open="open"
    v-model:tab="activeTab"
    size="5xl"
    :shortcut="false"
  >
    <template #title>{{ __('Settings') }}</template>
    <SettingsSidebar>
      <SettingsNavGroup v-for="group in visibleGroups" :key="group.id" :label="__(group.label)">
        <SettingsNavItem v-for="tab in group.items" :key="tab.value" :value="tab.value">
          <template #prefix>
            <Avatar
              v-if="tab.value === 'profile'"
              :image="imageURL"
              :label="fullName"
              size="xs"
              class="shrink-0"
            />
            <span
              v-else-if="typeof tab.icon === 'string'"
              :class="[tab.icon, 'size-4 shrink-0 text-ink-gray-6']"
              aria-hidden="true"
            />
            <component
              :is="tab.icon"
              v-else
              class="size-4 shrink-0 text-ink-gray-6 stroke-[1.5]"
            />
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
import { computed, watch } from 'vue'
import {
  Avatar,
  SettingsContent,
  SettingsDialog,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPanel,
  SettingsSidebar,
} from 'frappe-ui'
import { useCurrentUser } from '@/boot/session'
import { getVisibleSettingsGroups } from '@/components/settings/settingsCatalog'
import type { SettingsGroup } from '@/components/settings/types'
import { useCommonSettingsGroups } from '@/components/settings/useCommonSettingsGroups'

const props = withDefaults(
  defineProps<{
    groups?: SettingsGroup[]
    includeCommon?: boolean
  }>(),
  {
    groups: () => [],
    includeCommon: true,
  },
)

const open = defineModel<boolean>('open', { default: false })
const activeTab = defineModel<string>('tab', { default: 'profile' })

const { fullName, imageURL } = useCurrentUser()
const commonGroups = useCommonSettingsGroups()

const visibleGroups = computed(() =>
  getVisibleSettingsGroups([
    ...(props.includeCommon ? commonGroups.value : []),
    ...props.groups,
  ]),
)
const visibleTabs = computed(() => visibleGroups.value.flatMap((group) => group.items))

watch(
  visibleTabs,
  (tabs) => {
    if (!tabs.some((tab) => tab.value === activeTab.value)) {
      activeTab.value = tabs[0]?.value ?? 'profile'
    }
  },
  { immediate: true },
)
</script>
