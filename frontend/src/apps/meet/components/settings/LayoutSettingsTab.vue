<template>
  <AppSettingsHeader
    :title="__('Layout')"
    :description="__('Customize the meeting interface layout')"
  />
  <AppSettingsBody>
    <div class="space-y-6">
      <SettingsRow
        :title="__('Auto-hide header and controls')"
        :description="
          __('Automatically hide the header and toolbar after 10 seconds of inactivity')
        "
      >
        <Switch v-model="autoHideToolbarLocal" />
      </SettingsRow>
      <SettingsRow
        v-if="supportsFirefoxMeetingPip()"
        :title="__('Meeting picture-in-picture')"
        :description="__('Open the floating meeting window during a call.')"
      >
        <kbd class="rounded-3 bg-surface-gray-2 px-2 py-1 text-sm text-ink-gray-9">{{
          getPlatform() === 'mac' ? 'Control + Shift + M' : 'Alt + Shift + M'
        }}</kbd>
      </SettingsRow>
      <SettingsRow
        v-else-if="supportsAutomaticMeetingPip()"
        :title="__('Automatic picture-in-picture')"
        :description="
          __(
            'Keep the meeting in a floating window when you switch tabs or apps. Requires a supported browser and permission for automatic picture-in-picture.',
          )
        "
      >
        <Switch
          v-model="automaticPictureInPictureLocal"
          :aria-label="__('Automatic picture-in-picture')"
        />
      </SettingsRow>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'
import { computed, ref, watch, type Ref } from 'vue'

import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import { translate as __ } from '@/platform/translation'

import {
  autoHideToolbar,
  automaticPictureInPicture,
  setAutoHideToolbar,
  setAutomaticPictureInPicture,
} from '../../data/mediaPreferences'
import {
  getPlatform,
  supportsAutomaticMeetingPip,
  supportsFirefoxMeetingPip,
} from '../../utils/device'

const automaticPictureInPictureLocal = computed({
  get: () => automaticPictureInPicture.value,
  set: setAutomaticPictureInPicture,
})

const autoHideToolbarLocal: Ref<boolean> = ref(autoHideToolbar.value)

watch(autoHideToolbarLocal, (newValue) => {
  setAutoHideToolbar(newValue)
})

watch(autoHideToolbar, (newValue) => {
  autoHideToolbarLocal.value = newValue
})
</script>
