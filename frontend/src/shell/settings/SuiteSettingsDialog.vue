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
    @update:tab="selectTab"
  />
  <!-- The command palette binds the Settings key (`useSettingsShortcut`),
       so frappe-ui's own binding, which only toggles the dialog, is off. -->
  <SettingsDialog
    v-else
    v-model:open="open"
    :tab="activeTab"
    size="5xl"
    :keyboard-shortcut="false"
    @update:tab="selectTab"
  >
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
        <SettingsNavGroup v-for="group in groups" :key="group.label" :label="group.label">
          <SettingsNavItem v-for="tab in group.tabs" :key="tab.id" :value="tab.id">
            <template #prefix>
              <Avatar
                v-if="tab.id === PROFILE_TAB"
                :image="avatar ?? undefined"
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
        </SettingsNavGroup>
        <SettingsLoadFailed v-if="failed" class="px-2 py-1.5" :retry="load" />
      </SettingsSidebar>
      <SettingsContent>
        <SettingsPanel v-for="tab in tabs" :key="tab.id" :value="tab.id" tabindex="-1">
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
} from 'frappe-ui'
import { computed, watch } from 'vue'

import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { resolveSettingsTab, type SettingsTabId } from '@/shell/settings/settings'
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
const avatar = computed(() => session.user.value?.avatar ?? null)

const { groups, failed, load } = useSettingsGroups()
const tabs = computed(() => groups.value?.flatMap((group) => group.tabs) ?? [])

// The tab on screen: the requested one, or the first visible tab.
const activeTab = computed(() =>
  groups.value ? resolveSettingsTab(groups.value, requestedTab.value) : undefined,
)

function isTabId(id: string | number | undefined): id is SettingsTabId {
  return tabs.value.some((tab) => tab.id === id)
}

// A tab the user picks becomes the request, so a later `openSettings(tab)`
// from inside a tab always differs from it and switches.
function selectTab(id: string | number | undefined) {
  requestedTab.value = isTabId(id) ? id : undefined
}

watch(
  open,
  (isOpen) => {
    if (isOpen) void load()
  },
  { immediate: true },
)
</script>
