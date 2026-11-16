<!--
  Settings: the composition settings list as a dialog on desktop and as a
  drill-in on phone. Group modules load when it opens; a tab body loads when
  its tab first shows.
-->
<template>
  <SettingsDrillIn
    v-if="isMobile"
    v-model:open="open"
    :groups="groups"
    :failed="failed"
    :retry="load"
    :tab="requestedTab"
  />
  <SettingsDialog v-else v-model:open="open" v-model:tab="activeTab" size="5xl">
    <template #title>{{ __('Settings') }}</template>
    <!-- SettingsDialog draws no close button. This one sits where Dialog
         puts its own. -->
    <Dialog.Close as-child>
      <Button
        variant="ghost"
        icon="lucide-x"
        class="absolute right-4 top-4 z-10"
        :aria-label="__('Close')"
      />
    </Dialog.Close>
    <template v-if="groups">
      <SettingsSidebar>
        <TextInput
          v-model="query"
          type="text"
          :placeholder="__('Search settings')"
          :aria-label="__('Search settings')"
          @keydown.enter="showFirstFound"
        >
          <template #prefix>
            <span class="lucide-search size-4" aria-hidden="true" />
          </template>
        </TextInput>
        <SettingsNavGroup v-for="group in found" :key="group.label" :label="group.label">
          <template v-for="{ tab, sections } in group.tabs" :key="tab.id">
            <SettingsNavItem :value="tab.id">
              <template #prefix>
                <Avatar
                  v-if="isProfile(tab)"
                  :image="avatar"
                  :label="fullName"
                  size="xs"
                  class="shrink-0"
                  aria-hidden="true"
                />
                <span
                  v-else
                  :class="[tab.icon, 'size-4 shrink-0 text-ink-gray-6']"
                  aria-hidden="true"
                />
              </template>
              {{ tab.label() }}
            </SettingsNavItem>
            <!-- Lines up with the tab's label, past its icon -->
            <button
              v-for="section in sections"
              :key="section.id"
              type="button"
              class="flex h-7 w-full items-center rounded-4 pl-8 pr-2 text-left text-base text-ink-gray-6 hover:bg-surface-gray-2"
              @click="showSection(tab, section)"
            >
              <span class="min-w-0 flex-1 truncate">{{ section.label() }}</span>
            </button>
          </template>
        </SettingsNavGroup>
        <p v-if="isNothingFound" class="px-2 text-base text-ink-gray-5">
          {{ __('No settings match your search.') }}
        </p>
        <SettingsLoadFailed v-if="failed" class="px-2 py-1.5" :retry="load" />
      </SettingsSidebar>
      <SettingsContent>
        <SettingsPanel v-for="tab in tabs" :key="tab.id" :value="tab.id">
          <SettingsTabBody :tab="tab" />
        </SettingsPanel>
      </SettingsContent>
    </template>
    <div
      v-else
      class="flex min-h-0 flex-1 items-center justify-center"
      role="status"
      :aria-label="__('Loading')"
    >
      <LoadingIndicator class="size-5 text-ink-gray-5" />
    </div>
  </SettingsDialog>
</template>

<script setup lang="ts">
import {
  Avatar,
  Button,
  Dialog,
  LoadingIndicator,
  SettingsContent,
  SettingsDialog,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPanel,
  SettingsSidebar,
  TextInput,
} from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useSession } from '@/platform/session'
import { settingsSection } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'
import { searchSettings } from '@/shell/settings/searchSettings'
import {
  resolveSettingsTab,
  type SettingsSection,
  type SettingsTab,
  type SettingsTabId,
} from '@/shell/settings/settings'
import SettingsDrillIn from '@/shell/settings/SettingsDrillIn.vue'
import SettingsLoadFailed from '@/shell/settings/SettingsLoadFailed.vue'
import SettingsTabBody from '@/shell/settings/SettingsTabBody.vue'
import { useSettingsGroups } from '@/shell/settings/useSettingsDialog'
import { isMobile } from '@/shell/useIsMobile'

const PROFILE_TAB = 'account.profile'

const open = defineModel<boolean>('open', { default: false })
/** The tab to show. Unset shows the first tab on desktop and the list on phone. */
const requestedTab = defineModel<SettingsTabId | undefined>('tab')

const session = useSession()
const fullName = computed(() => session.user.value?.fullName ?? '')
const avatar = computed(() => session.user.value?.avatar ?? undefined)

function isProfile(tab: SettingsTab) {
  return tab.id === PROFILE_TAB
}

const { groups, failed, load } = useSettingsGroups()
const tabs = computed(() => groups.value?.flatMap((group) => group.tabs) ?? [])

// The dialog's own selection. It follows the requested tab, falls back to the
// settings of the app on screen and then to the first visible tab, and stays
// local so a sidebar click does not rewrite the caller's request
const activeTab = ref<string | undefined>()
const route = useRoute()

watch(
  [groups, requestedTab],
  ([visible, requested]) => {
    if (visible) {
      activeTab.value = resolveSettingsTab(visible, requested, route.meta.area)
    }
  },
  { immediate: true },
)

const query = ref('')
const found = computed(() => searchSettings(groups.value ?? [], query.value))
const isNothingFound = computed(() => !!query.value.trim() && found.value.length === 0)

/** Shows the section's tab. A section that is a dialog opens there, by its name. */
function showSection(tab: SettingsTab, section: SettingsSection) {
  activeTab.value = tab.id
  settingsSection.value = `${tab.id}.${section.id}`
}

function showFirstFound() {
  const first = found.value[0]?.tabs[0]
  if (!first || !query.value.trim()) return

  const section = first.sections[0]
  if (section) {
    showSection(first.tab, section)
    return
  }

  activeTab.value = first.tab.id
}

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      void load()
      return
    }

    // A section whose row never showed must not open the next time Settings does
    settingsSection.value = undefined
    query.value = ''
  },
  { immediate: true },
)
</script>
