<template>
  <!-- The Inbox's category tabs, in the title bar where the folder's name would be. Every tab keeps
       its unread count; in a header too narrow for every name, the tabs you are not on keep only
       their icons (named on hover and for screen readers), and one still too narrow scrolls them
       sideways. The row's bottom border is the header's. Which categories get a tab is chosen from the header's
       view menu (see ViewMenu). -->
  <!-- As tall as the title bar (h-12), so each tab centres in it and underlines on its border. The
       underline sits one pixel below the tabs, on that border, and a sideways scroller clips both
       ways: pb-px reaches the scroller down over the border so the underline stays in view. -->
  <Tabs
    :model-value="active"
    class="flex h-12 min-w-0 flex-1 items-stretch"
    data-testid="inbox-tabs"
  >
    <div
      ref="scroller"
      class="box-content h-full min-w-0 flex-1 overflow-x-auto pb-px [scrollbar-width:none]"
      :class="fade"
    >
      <TabList variant="underline" size="md" class="h-full data-[slot=tab-list]:border-b-0">
        <Tooltip v-for="tab in tabs" :key="tab.id" :text="tab.label" :disabled="!iconOnly(tab)">
          <TabTrigger
            :value="tab.id"
            :route="routeFor(tab.id)"
            :icon-left="tab.icon"
            :label="tab.label"
            class="shrink-0 items-center self-stretch"
          >
            <template v-if="iconOnly(tab)" #default>
              <span class="sr-only">{{ tab.label }}</span>
            </template>
            <template #suffix>
              <Badge v-if="tab.unread" size="sm">{{ countOf(tab) }}</Badge>
            </template>
          </TabTrigger>
        </Tooltip>
      </TabList>
    </div>
    <!-- The row with every name, out of sight: how wide the header must be for them all. -->
    <div aria-hidden="true" class="invisible absolute h-0 overflow-hidden">
      <!-- Its own Tabs, so its tabs aren't the row's: not in its keyboard steps, nor underlined -->
      <Tabs :model-value="active">
        <TabList ref="named" variant="underline" size="md" class="w-max">
          <TabTrigger
            v-for="tab in tabs"
            :key="tab.id"
            :value="tab.id"
            :icon-left="tab.icon"
            :label="tab.label"
            class="shrink-0"
          >
            <template #suffix>
              <Badge v-if="tab.unread" size="sm">{{ countOf(tab) }}</Badge>
            </template>
          </TabTrigger>
        </TabList>
      </Tabs>
    </div>
  </Tabs>
</template>

<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { Badge, TabList, Tabs, TabTrigger, Tooltip } from 'frappe-ui'
import { computed, ref, useTemplateRef, type ComponentPublicInstance } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import type { InboxTab, InboxTabId } from '@/apps/mail/composables/useInboxTabs'
import { useOverflowFade } from '@/apps/mail/composables/useOverflowFade'

const props = defineProps<{
  tabs: InboxTab[]
  active: InboxTabId
  routeFor: (tab: InboxTabId) => RouteLocationRaw
}>()

const { scroller, fade } = useOverflowFade()

// Room for the row with every name, against the space the header gives it
const named = useTemplateRef<ComponentPublicInstance>('named')
const namedEl = computed(() => named.value?.$el as HTMLElement | undefined)
const namedWidth = ref(0)
const room = ref(Infinity)
useResizeObserver(namedEl, () => (namedWidth.value = namedEl.value?.scrollWidth ?? 0))
useResizeObserver(scroller, () => (room.value = scroller.value?.clientWidth ?? Infinity))
const iconOnly = (tab: InboxTab) => tab.id !== props.active && namedWidth.value > room.value
// A tab's count stops at 99+: past that the number only widens the tab.
const countOf = (tab: InboxTab) => (tab.unread > 99 ? '99+' : String(tab.unread))
</script>
