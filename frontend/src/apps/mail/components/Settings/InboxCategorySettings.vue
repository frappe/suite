<template>
  <!-- A part of the Inbox page: whether the Inbox is split into categories, and which; off, it is
       one list, and the choice is kept for when it is on again. While it is split, whether the tabs
       end with All mail, on a computer: a phone's Inbox has no tab row to end. Nothing where the site
       doesn't sort mail into them. -->
  <SettingsSection v-if="offered" :title="__('Categories')">
    <SettingsRow
      :title="__('Split Inbox into categories')"
      :description="__('Mail that isn’t personal moves out of Primary into its own category.')"
    >
      <Switch :model-value="split" @update:model-value="setSplit" />
    </SettingsRow>
    <!-- Four of a kind, so they share one row of cards, all one size; a card is the label of its
         check box -->
    <div v-if="split" class="grid auto-rows-fr grid-cols-2 gap-2 pb-4 sm:grid-cols-4">
      <label
        v-for="choice in choices"
        :key="choice.category"
        class="flex flex-col gap-2 rounded-6 border p-3 transition-colors"
        :class="cardLook(choice)"
      >
        <span class="flex items-center justify-between">
          <span class="size-4" :class="choice.icon" aria-hidden="true" />
          <Checkbox
            :model-value="choice.on"
            :disabled="isLastOn(choice)"
            @update:model-value="(on) => tick(choice.category, on)"
          />
        </span>
        <span>
          <span class="text-base-medium block">{{ choice.label }}</span>
          <span class="text-p-sm text-ink-gray-5 mt-0.5 block">
            {{ TAB_DESCRIPTIONS[choice.category] }}
          </span>
        </span>
      </label>
    </div>
    <SettingsRow
      v-if="split && !phonePage"
      :title="__('All mail tab')"
      :description="__('Every category in one list, after the other tabs.')"
    >
      <Switch :model-value="allMail" @update:model-value="setAllMail" />
    </SettingsRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { Checkbox, SettingsRow, Switch } from 'frappe-ui'
import { computed, inject } from 'vue'

import { useTabChoice, type InboxCategory } from '@/apps/mail/composables/useInboxTabs'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'

const { offered, split, allMail, choices, setTab, setSplit, setAllMail } = useTabChoice()
// Read without importing the shell, as a product's settings body must.
const phonePage = inject('app-settings-mobile-page', false)
const onCount = computed(() => choices.value.filter((choice) => choice.on).length)
// The last one on stays on: turning the split off is the way to one list
function isLastOn(choice: { on: boolean }) {
  return choice.on && onCount.value === 1
}

// The check box says 1 and 0 as well as true and false
function tick(category: InboxCategory, on?: boolean | 1 | 0) {
  setTab(category, Boolean(on))
}

// A category that is off reads as set aside: grey, and without its border. The last one on can't
// be clicked off, and its card says so
function cardLook(choice: { on: boolean }) {
  if (!choice.on) {
    return 'bg-surface-gray-1 text-ink-gray-5 cursor-pointer border-transparent'
  }

  if (isLastOn(choice)) {
    return 'border-outline-gray-2 text-ink-gray-8 cursor-not-allowed'
  }

  return 'border-outline-gray-2 text-ink-gray-8 cursor-pointer'
}

const TAB_DESCRIPTIONS: Record<InboxCategory, string> = {
  primary: '',
  updates: __('Receipts, alerts and confirmations'),
  forums: __('Mailing lists and groups'),
  promotions: __('Newsletters and offers'),
  social: __('Mail from social networks'),
}
</script>
