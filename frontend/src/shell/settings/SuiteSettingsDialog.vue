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
} from 'frappe-ui'
import { computed, ref, watch } from 'vue'

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

// The dialog's own selection. It follows the requested tab, falls back to the
// first visible tab, and stays local so a sidebar click does not rewrite the
// caller's request.
const activeTab = ref<string | undefined>()

watch(
  [groups, requestedTab],
  ([visible, requested]) => {
    if (visible) activeTab.value = resolveSettingsTab(visible, requested)
  },
  { immediate: true },
)

watch(
  open,
  (isOpen) => {
    if (isOpen) void load()
  },
  { immediate: true },
)
</script>
