<template>
  <!-- The Inbox's category tabs, in the title bar where the folder's name would be. Every tab keeps
       its name and its unread count; a header too narrow for them scrolls them sideways, and the
       row's bottom border is the header's. Which categories get a tab is chosen from the header's
       view menu (see ViewMenu). -->
  <!-- As tall as the title bar (h-12), so each tab centres in it and underlines on its border. -->
  <Tabs :model-value="active" class="flex h-12 min-w-0 items-stretch" data-testid="inbox-tabs">
    <div ref="scroller" class="h-full min-w-0 overflow-x-auto [scrollbar-width:none]" :class="fade">
      <TabList variant="underline" size="md" class="h-full data-[slot=tab-list]:border-b-0">
        <TabTrigger
          v-for="tab in tabs"
          :key="tab.category"
          :value="tab.category"
          :route="routeFor(tab.category)"
          :icon-left="tab.icon"
          :label="tab.label"
          class="shrink-0 items-center self-stretch"
        >
          <template #suffix>
            <Badge v-if="tab.unread" size="sm">{{ countOf(tab) }}</Badge>
          </template>
        </TabTrigger>
      </TabList>
    </div>
  </Tabs>
</template>

<script setup lang="ts">
import { Badge, TabList, Tabs, TabTrigger } from 'frappe-ui'
import type { RouteLocationRaw } from 'vue-router'

import type { InboxCategory, InboxTab } from '@/apps/mail/composables/useInboxTabs'
import { useOverflowFade } from '@/apps/mail/composables/useOverflowFade'

defineProps<{
  tabs: InboxTab[]
  active: InboxCategory
  routeFor: (category: InboxCategory) => RouteLocationRaw
}>()

const { scroller, fade } = useOverflowFade()
// A tab's count stops at 99+: past that the number only widens the tab.
const countOf = (tab: InboxTab) => (tab.unread > 99 ? '99+' : String(tab.unread))
</script>
