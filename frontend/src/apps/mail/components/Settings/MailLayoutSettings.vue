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
          :title="__('Group Messages By')"
          :description="__('Organize the message list into date-based sections.')"
        >
          <Select
            :model-value="groupMessagesBy"
            :options="GROUP_MESSAGES_OPTIONS"
            @update:model-value="selectGrouping"
          />
        </SettingsRow>
      </template>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Button, Select, SettingsRow, Switch } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const user = userStore().userResource
const { isMobile } = useScreenSize()

const showReadingPane = ref(!!user.data?.show_reading_pane)
const initialGrouping = user.data?.group_messages_by
const groupMessagesBy = ref<'None' | 'Day' | 'Month'>(
  initialGrouping === 'Day' || initialGrouping === 'Month' ? initialGrouping : 'None',
)
function selectGrouping(value: unknown) {
  if (value === 'None' || value === 'Day' || value === 'Month') groupMessagesBy.value = value
}
const saving = ref(false)

const isNotDirty = computed(
  () =>
    showReadingPane.value === !!user.data?.show_reading_pane &&
    groupMessagesBy.value === user.data?.group_messages_by,
)

const saveSettings = useMutation(api.mail.settings.updatePreferences)

const saveLayout = async () => {
  saving.value = true
  try {
    await saveSettings.run({
      show_reading_pane: showReadingPane.value ? 1 : 0,
      group_messages_by: groupMessagesBy.value,
    })
    raiseToast(__('Mail layout updated.'))
  } catch {
    // The shared client reports a refused save.
  } finally {
    saving.value = false
  }
}

const GROUP_MESSAGES_OPTIONS = [
  { label: __('None'), value: 'None' },
  { label: __('Day'), value: 'Day' },
  { label: __('Month'), value: 'Month' },
]
</script>
