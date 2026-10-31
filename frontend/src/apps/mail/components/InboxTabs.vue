<template>
  <!-- The phone's Inbox categories, under the title in a single account's Inbox and in every
       account's at once. In Primary, the other categories sit in one line, each with how many of its
       threads are unread, and open on a tap; the line scrolls sideways when it runs out of room. In
       another category the title names it and leads back to Primary (see useInboxTabs), so the line
       is not drawn. A desktop names the categories in its title bar instead (see InboxHeaderTabs).
       Monochrome: a category with unread mail reads darker, never in a colour of its own.
       px-2 plus each button's own inset puts the first icon on the list's left axis. -->
  <div
    v-if="active === 'primary' && others.length"
    class="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-2 [scrollbar-width:none]"
    data-testid="inbox-tabs"
  >
    <Button
      v-for="tab in others"
      :key="tab.category"
      variant="ghost"
      :route="routeFor(tab.category)"
      class="shrink-0"
    >
      <template #prefix>
        <span
          :class="[tab.icon, tab.unread ? 'text-ink-gray-7' : 'text-ink-gray-5']"
          class="size-4 shrink-0"
          aria-hidden="true"
        />
      </template>
      <span :class="tab.unread ? 'text-ink-gray-8 font-medium' : 'text-ink-gray-5'">
        {{ tab.label }}
      </span>
      <template v-if="tab.unread" #suffix>
        <Badge size="sm" theme="gray">{{ countOf(tab) }}</Badge>
      </template>
    </Button>
    <Dropdown :options="choiceMenu">
      <Button variant="ghost" class="shrink-0" :aria-label="__('Choose categories')">
        <template #icon>
          <span class="lucide-settings-2 text-ink-gray-5 size-4" aria-hidden="true" />
        </template>
      </Button>
    </Dropdown>
  </div>
</template>

<script setup lang="ts">
import { Badge, Button, Dropdown } from 'frappe-ui'
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import {
  useTabChoiceMenu,
  type InboxCategory,
  type InboxTab,
} from '@/apps/mail/composables/useInboxTabs'

const props = defineProps<{
  tabs: InboxTab[]
  active: InboxCategory
  routeFor: (category: InboxCategory) => RouteLocationRaw
}>()

const others = computed(() => props.tabs.filter((tab) => tab.category !== 'primary'))

// Categories on or off, and which get a tab (see useTabChoiceMenu). The phone has no Split View, so
// the layout group holds the one switch.
const { categoriesSwitch, tabGroups } = useTabChoiceMenu()
const choiceMenu = computed(() => [
  ...(categoriesSwitch.value ? [{ group: __('Layout'), options: [categoriesSwitch.value] }] : []),
  ...tabGroups.value,
])
// A count stops at 99+: past that the number only widens the button.
const countOf = (tab: InboxTab) => (tab.unread > 99 ? '99+' : String(tab.unread))
</script>
