<template>
  <UiSettingsDialog v-model="open" v-model:tab="activeTab" size="5xl" :shortcut="false">
    <template #title>{{ __('Settings') }}</template>
    <SettingsSidebar>
      <SettingsNavGroup
        v-for="group in tabGroups"
        :key="group.label"
        :label="__(group.label)"
      >
        <SettingsNavItem
          v-for="tab in group.items"
          :key="tab.value"
          :value="tab.value"
        >
          <template #prefix>
            <component :is="tab.icon" class="size-4 shrink-0 text-ink-gray-6 stroke-[1.5]" />
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
  </UiSettingsDialog>
</template>
<script setup>
import { ref, markRaw, computed, watch } from 'vue'
import {
  SettingsContent,
  SettingsDialog as UiSettingsDialog,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPanel,
  SettingsSidebar,
} from 'frappe-ui'
import { isAdmin } from '@/apps/drive/resources/permissions'
import ProfileSettings from '@/apps/drive/components/Settings/ProfileSettings.vue'
import PreferencesSettings from '@/apps/drive/components/Settings/PreferencesSettings.vue'
import StorageSettings from './StorageSettings.vue'
import UserListSettings from './UserListSettings.vue'
import LucideCloudCog from '~icons/lucide/cloud-cog'
import LucideChartBar from '~icons/lucide/chart-bar'
import LucideSlidersHorizontal from '~icons/lucide/sliders-horizontal'
import LucideUser from '~icons/lucide/user'
import LucideUserPlus from '~icons/lucide/user-plus'
import BackendSettings from './BackendSettings.vue'

const allGroups = [
  {
    label: 'General',
    items: [
      {
        label: 'Profile',
        value: 'profile',
        icon: LucideUser,
        component: markRaw(ProfileSettings),
      },
      {
        label: 'Preferences',
        value: 'preferences',
        icon: LucideSlidersHorizontal,
        component: markRaw(PreferencesSettings),
      },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        label: 'Teams',
        value: 'teams',
        icon: LucideUserPlus,
        component: markRaw(UserListSettings),
      },
      {
        label: 'Statistics',
        value: 'statistics',
        icon: LucideChartBar,
        component: markRaw(StorageSettings),
      },
    ],
  },
  {
    label: 'Administration',
    adminOnly: true,
    items: [
      {
        label: 'Storage',
        value: 'storage',
        icon: LucideCloudCog,
        component: markRaw(BackendSettings),
      },
    ],
  },
]
if (!isAdmin.data) isAdmin.fetch()

const emit = defineEmits(['update:modelValue'])
const props = defineProps({
  modelValue: Boolean,
  /** Tab value (preferred) or legacy numeric index into visible tabs. */
  suggestedTab: [String, Number],
})

const tabGroups = computed(() =>
  allGroups
    .filter((group) => !group.adminOnly || isAdmin.data?.is_admin)
    .map((group) => ({
      label: group.label,
      items: group.items,
    }))
    .filter((group) => group.items.length > 0),
)

const visibleTabs = computed(() => tabGroups.value.flatMap((group) => group.items))

function resolveTab(suggestion) {
  if (suggestion == null || suggestion === '') return null
  if (typeof suggestion === 'number') {
    return visibleTabs.value[suggestion]?.value ?? null
  }
  if (visibleTabs.value.some((tab) => tab.value === suggestion)) {
    return suggestion
  }
  return null
}

const activeTab = ref(resolveTab(props.suggestedTab) ?? 'profile')

const open = computed({
  get() {
    return props.modelValue
  },
  set(newValue) {
    emit('update:modelValue', newValue)
  },
})

watch(
  () => props.suggestedTab,
  (suggestion) => {
    const value = resolveTab(suggestion)
    if (value) activeTab.value = value
  },
)

watch(
  visibleTabs,
  (list) => {
    if (!list.length) return
    if (!list.some((tab) => tab.value === activeTab.value)) {
      activeTab.value = list[0].value
    }
  },
  { immediate: true },
)
</script>
