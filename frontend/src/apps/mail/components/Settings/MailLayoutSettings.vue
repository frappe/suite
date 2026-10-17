<template>
  <AppSettingsHeader :title="__('Mail layout')">
    <template #actions>
      <Button
        :label="__('Save')"
        variant="solid"
        :size="isMobile ? 'md' : 'sm'"
        :loading="saving"
        :disabled="isNotDirty"
        @click="saveLayout"
      />
    </template>
  </AppSettingsHeader>
  <AppSettingsBody>
    <div class="flex flex-col gap-5">
      <template v-if="user.data?.is_jmap_configured && !isMobile">
        <SettingsRow
          class="!py-0"
          :title="__('Split View')"
          :description="__('Preview emails alongside the message list.')"
        >
          <Switch
            :model-value="showReadingPane"
            @update:model-value="(v) => (showReadingPane = v)"
          />
        </SettingsRow>
        <SettingsRow
          class="!py-0"
          :title="__('Group by date')"
          :description="
            __('Section the message list by date: today, yesterday, this week, and so on.')
          "
        >
          <Switch :model-value="groupByDate" @update:model-value="(v) => (groupByDate = v)" />
        </SettingsRow>
      </template>

      <!-- Whether the Inbox is split into categories, and which; off, it is one list, and the choice
           is kept for when it is on again. -->
      <p v-if="isMobile && !tabsOffered" class="text-p-sm text-ink-gray-5">
        {{ __('Your Inbox isn’t split into categories on this site.') }}
      </p>
      <template v-if="tabsOffered">
        <h3 class="text-lg-semibold text-ink-gray-8 mt-3">{{ __('Inbox categories') }}</h3>
        <SettingsRow
          class="!py-0"
          :title="__('Split Inbox into categories')"
          :description="__('Mail that isn’t personal moves out of Primary into its own category.')"
        >
          <Switch :model-value="splitInbox" @update:model-value="(on) => (splitInbox = on)" />
        </SettingsRow>
        <template v-if="splitInbox">
          <SettingsRow
            v-for="choice in choices"
            :key="choice.category"
            class="!py-0"
            :title="choice.label"
            :description="TAB_DESCRIPTIONS[choice.category]"
          >
            <!-- The last one on stays on: turning the split off is the way to one list. -->
            <Switch
              :model-value="chosenTabs.includes(choice.category)"
              :disabled="chosenTabs.length === 1 && chosenTabs.includes(choice.category)"
              @update:model-value="(on) => chooseTab(choice.category, on)"
            />
          </SettingsRow>
        </template>
      </template>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Button, SettingsRow, Switch } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation } from '@/api'
import { useTabChoice, type InboxCategory } from '@/apps/mail/composables/useInboxTabs'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const user = userStore().userResource
const { isMobile } = useScreenSize()

const showReadingPane = ref(!!user.data?.show_reading_pane)
const groupByDate = ref(!!user.data?.group_by_date)

const { offered: tabsOffered, split, choices, tabsFor } = useTabChoice()
const splitInbox = ref(split.value)
const savedTabs = () => choices.value.filter((choice) => choice.on).map((choice) => choice.category)
const chosenTabs = ref<InboxCategory[]>(savedTabs())
const chooseTab = (category: InboxCategory, on: boolean) => {
  chosenTabs.value = on
    ? [...chosenTabs.value, category]
    : chosenTabs.value.filter((chosen) => chosen !== category)
}
const TAB_DESCRIPTIONS: Record<InboxCategory, string> = {
  primary: '',
  updates: __('Receipts, alerts, confirmations and other mail sent by systems.'),
  forums: __('Mailing lists and discussion groups.'),
  promotions: __('Newsletters, offers and marketing.'),
  social: __('Mail from social networks.'),
}

const isNotDirty = computed(
  () =>
    showReadingPane.value === !!user.data?.show_reading_pane &&
    groupByDate.value === !!user.data?.group_by_date &&
    splitInbox.value === split.value &&
    [...chosenTabs.value].sort().join() === savedTabs().sort().join(),
)

const saveSettings = useMutation(api.mail.settings.updatePreferences)
const saving = computed(() => saveSettings.isPending)

const saveLayout = async () => {
  await saveSettings.run({
    show_reading_pane: showReadingPane.value ? 1 : 0,
    group_by_date: groupByDate.value ? 1 : 0,
    ...(tabsOffered.value
      ? { split_inbox: splitInbox.value ? 1 : 0, inbox_tabs: tabsFor(chosenTabs.value) }
      : {}),
  })
  raiseToast(__('Mail layout updated.'))
}
</script>
