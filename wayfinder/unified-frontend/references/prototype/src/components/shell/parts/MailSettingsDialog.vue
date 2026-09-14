<!--
  Mail settings.

  Built on the plain Dialog rather than frappe-ui's Settings family. That
  family never behaved in this runtime — its nav components rendered nothing,
  and its sidebar's `title` rendered an empty input — and closing it took the
  account switcher's contents down with it.

  Two columns: a gray rail with one flat list of tabs, and a white panel that
  is one tab at a time.
-->
<template>
  <Dialog v-model:open="mailSettingsOpen" bare size="4xl">
    <div class="flex h-[34rem] overflow-hidden rounded-6 bg-surface-base">
      <div class="flex w-56 shrink-0 flex-col bg-surface-gray-1 p-2">
        <!-- No padding of its own: SidebarLabel carries the same pl-2 that
             SidebarItem does, so left alone the two line up. -->
        <div class="flex h-8 items-center">
          <SidebarLabel>Mail settings</SidebarLabel>
        </div>
        <div class="mt-1 flex flex-col gap-0.5">
          <SidebarItem
            v-for="tab in SETTINGS_TABS"
            :key="tab.id"
            :label="tab.label"
            :icon="tab.icon"
            :active="settingsTab === tab.id"
            @click="settingsTab = tab.id"
          />
        </div>
      </div>

      <div class="relative min-w-0 flex-1 overflow-y-auto p-6">
        <Button
          variant="ghost"
          icon="lucide-x"
          aria-label="Close settings"
          class="absolute right-4 top-4"
          @click="mailSettingsOpen = false"
        />

        <h2 class="text-2xl font-semibold text-ink-gray-9">{{ current.label }}</h2>
        <p class="mt-1 pr-10 text-p-base text-ink-gray-6">{{ current.description }}</p>

        <component :is="panel" class="mt-6" />
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button, Dialog, SidebarItem, SidebarLabel } from 'frappe-ui'

import { SETTINGS_TABS, settingsTab } from '../mailSettings'
import { mailSettingsOpen } from '../useMailAppearance'
import AccountPanel from './settings/AccountPanel.vue'
import AppearancePanel from './settings/AppearancePanel.vue'
import ComposePanel from './settings/ComposePanel.vue'
import NotificationsPanel from './settings/NotificationsPanel.vue'
import PrivacyPanel from './settings/PrivacyPanel.vue'

const PANELS: Record<string, unknown> = {
  account: AccountPanel,
  appearance: AppearancePanel,
  compose: ComposePanel,
  notifications: NotificationsPanel,
  privacy: PrivacyPanel,
}

const current = computed(
  () => SETTINGS_TABS.find((tab) => tab.id === settingsTab.value) ?? SETTINGS_TABS[1],
)
const panel = computed(() => PANELS[current.value.id])
</script>
