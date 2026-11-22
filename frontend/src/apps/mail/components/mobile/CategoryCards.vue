<template>
  <!-- A phone's Inbox categories over Primary: the others as cards in a line that scrolls sideways,
       the newest mail first, each naming who its newest mail is from. A category with unread mail
       reads darker, with a dot after its name. In another category the title names it and leads
       back to Primary (see MobileTitleHeader), so the line is not drawn. Until every category's
       mail has come (`ready`), the cards stand in outline, the size they will be.
       A tapped card sinks a little, as the bottom bar's tabs do. -->
  <div class="flex gap-2 overflow-x-auto px-3.5 py-3 [scrollbar-width:none]">
    <template v-if="!ready">
      <div
        v-for="(card, i) in cards"
        :key="card.tab.id"
        :class="CARD"
        class="animate-pulse"
        v-bind="
          i ? { 'aria-hidden': 'true' } : { role: 'status', 'aria-label': __('Loading categories') }
        "
      >
        <!-- Each line carries its card line's type classes, so it is that line's height. -->
        <div class="flex items-center gap-2">
          <div class="bg-surface-gray-3 size-4 shrink-0 rounded-full" />
          <span class="text-base"><span :class="BAR" class="bg-surface-gray-3 w-20" /></span>
        </div>
        <span class="text-sm"><span :class="BAR" class="bg-surface-gray-2 w-32" /></span>
      </div>
    </template>
    <template v-else>
      <RouterLink
        v-for="card in cards"
        :key="card.tab.id"
        :to="routeFor(card.tab.id)"
        :class="CARD"
        class="transition active:scale-95 active:bg-surface-gray-2"
      >
        <div class="flex items-center gap-2">
          <span :class="card.tab.icon" class="text-ink-gray-6 size-4 shrink-0" aria-hidden="true" />
          <span
            class="truncate text-base"
            :class="card.tab.unread ? 'text-ink-gray-8 font-semibold' : 'text-ink-gray-6'"
          >
            {{ card.tab.label }}
          </span>
          <span
            v-if="card.tab.unread"
            class="size-2 shrink-0 rounded-full bg-blue-500"
            :aria-label="__('Unread')"
          />
        </div>
        <span class="text-ink-gray-5 truncate text-sm">
          {{ card.senders.join(', ') || '—' }}
        </span>
      </RouterLink>
    </template>
  </div>
</template>

<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import type { CategoryCard } from '@/apps/mail/composables/useCategoryCards'
import type { InboxTabId } from '@/apps/mail/composables/useInboxTabs'

defineProps<{
  cards: CategoryCard[]
  ready: boolean
  routeFor: (tab: InboxTabId) => RouteLocationRaw
}>()

const BAR = 'inline-block h-3 rounded-4 align-middle'
const CARD = 'flex w-44 shrink-0 flex-col gap-1 rounded-6 border border-outline-gray-2 px-3 py-2.5'
</script>
