<template>
  <AppSettingsHeader
    :title="__('Audio')"
    :description="__('Configure your audio and microphone settings')"
  />
  <AppSettingsBody>
    <div>
      <SettingsRow
        :title="__('Noise cancellation')"
        :description="__('Reduce background noise from your microphone')"
      >
        <Switch v-model="noiseCancellationEnabledLocal" />
      </SettingsRow>
      <SettingsRow
        :title="__('Push to talk')"
        :description="__('Hold spacebar to unmute your microphone')"
      >
        <Switch v-model="pushToTalkEnabledLocal" />
      </SettingsRow>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'
import { ref, watch, type Ref } from 'vue'

import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import { translate as __ } from '@/platform/translation'

import {
  noiseCancellationEnabled,
  pushToTalkEnabled,
  setNoiseCancellationEnabled,
  setPushToTalkEnabled,
} from '../../data/mediaPreferences'

const noiseCancellationEnabledLocal: Ref<boolean> = ref(noiseCancellationEnabled.value)

watch(noiseCancellationEnabledLocal, (newValue) => {
  setNoiseCancellationEnabled(newValue)
})

watch(noiseCancellationEnabled, (newValue) => {
  noiseCancellationEnabledLocal.value = newValue
})

const pushToTalkEnabledLocal: Ref<boolean> = ref(pushToTalkEnabled.value)

watch(pushToTalkEnabledLocal, (newValue) => {
  setPushToTalkEnabled(newValue)
})

watch(pushToTalkEnabled, (newValue) => {
  pushToTalkEnabledLocal.value = newValue
})
</script>
