<template>
  <!-- Whether the Inbox is split into categories, and which; off, it is one list, and the choice
       is kept for when it is on again. Nothing where the site doesn't sort mail into them. -->
  <SettingsSection v-if="offered" :title="__('Inbox categories')">
    <div class="divide-y divide-outline-gray-1">
      <SettingsRow
        :title="__('Split Inbox into categories')"
        :description="__('Mail that isn’t personal moves out of Primary into its own category.')"
      >
        <Switch :model-value="split" @update:model-value="setSplit" />
      </SettingsRow>
      <template v-if="split">
        <SettingsRow
          v-for="choice in choices"
          :key="choice.category"
          :title="choice.label"
          :description="TAB_DESCRIPTIONS[choice.category]"
        >
          <Switch
            :model-value="choice.on"
            :disabled="isLastOn(choice)"
            @update:model-value="(on) => setTab(choice.category, on)"
          />
        </SettingsRow>
      </template>
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'
import { computed } from 'vue'

import { useTabChoice, type InboxCategory } from '@/apps/mail/composables/useInboxTabs'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'

const { offered, split, choices, setTab, setSplit } = useTabChoice()
const onCount = computed(() => choices.value.filter((choice) => choice.on).length)
// The last one on stays on: turning the split off is the way to one list
function isLastOn(choice: { on: boolean }) {
  return choice.on && onCount.value === 1
}

const TAB_DESCRIPTIONS: Record<InboxCategory, string> = {
  primary: '',
  updates: __('Receipts, alerts, confirmations and other mail sent by systems'),
  forums: __('Mailing lists and discussion groups.'),
  promotions: __('Newsletters, offers and marketing.'),
  social: __('Mail from social networks.'),
}
</script>
