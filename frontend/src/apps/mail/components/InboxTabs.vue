<template>
  <!-- The phone's Inbox category tabs: a row of pills that scrolls sideways, between the title and
       the toolbar that acts on the open one. A desktop names the tabs in its title bar instead (see
       InboxHeaderTabs). -->
  <div class="shrink-0 overflow-x-auto px-4 pb-3 [scrollbar-width:none]" data-testid="inbox-tabs">
    <Tabs :model-value="active" class="flex items-center gap-1">
      <TabList variant="ghost" size="md">
        <TabTrigger
          v-for="tab in tabs"
          :key="tab.category"
          :value="tab.category"
          :route="routeFor(tab.category)"
          :icon-left="tab.icon"
          :label="tab.label"
        >
          <template #suffix>
            <Badge v-if="tab.unread" size="sm">{{ countOf(tab) }}</Badge>
          </template>
        </TabTrigger>
      </TabList>
      <Dropdown :options="choiceMenu">
        <Button variant="ghost" :aria-label="__('Choose categories')">
          <template #icon>
            <span class="lucide-settings-2 icon" aria-hidden="true" />
          </template>
        </Button>
      </Dropdown>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { Badge, Button, Dropdown, TabList, Tabs, TabTrigger } from 'frappe-ui'
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import {
  useTabChoiceMenu,
  type InboxCategory,
  type InboxTab,
} from '@/apps/mail/composables/useInboxTabs'

defineProps<{
  tabs: InboxTab[]
  active: InboxCategory
  routeFor: (category: InboxCategory) => RouteLocationRaw
}>()

// Categories on or off, and which get a tab (see useTabChoiceMenu). The phone has no Split View, so
// the layout group holds the one switch.
const { categoriesSwitch, tabGroups } = useTabChoiceMenu()
const choiceMenu = computed(() => [
  ...(categoriesSwitch.value ? [{ group: __('Layout'), options: [categoriesSwitch.value] }] : []),
  ...tabGroups.value,
])
// A tab's count stops at 99+: past that the number only widens the tab.
const countOf = (tab: InboxTab) => (tab.unread > 99 ? '99+' : String(tab.unread))
</script>
