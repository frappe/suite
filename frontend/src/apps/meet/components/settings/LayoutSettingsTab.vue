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
        v-if="supportsAutomaticMeetingPip()"
        :title="__('Picture-in-picture mode')"
        :description="__('Keep the meeting in a floating window when you switch tabs or apps.')"
      >
        <Switch
          v-model="automaticPictureInPictureLocal"
          :aria-label="__('Picture-in-picture mode')"
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
import { supportsAutomaticMeetingPip } from '../../utils/device'

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
