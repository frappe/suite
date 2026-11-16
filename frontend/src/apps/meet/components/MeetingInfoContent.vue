<template>
  <div class="space-y-4">
    <div v-if="showHeading || isE2EEActive">
      <h3 v-if="showHeading" class="text-base-medium text-ink-gray-9">
        {{ __('Meeting information') }}
      </h3>
      <p v-if="isE2EEActive" :class="showHeading ? 'mt-1' : ''" class="text-sm text-ink-gray-6">
        {{ __('This is an end-to-end encrypted call') }}
      </p>
    </div>
    <div class="space-y-2">
      <p class="text-sm-medium text-ink-gray-8">{{ __('Meeting ID') }}</p>
      <ClickToCopyField :text-content="meetingId || ''" />
    </div>
    <div class="space-y-2">
      <p class="text-sm-medium text-ink-gray-8">{{ __('Meeting URL') }}</p>
      <ClickToCopyField :text-content="meetingUrl" />
    </div>
    <div v-if="e2eeFingerprint" class="space-y-2">
      <p class="text-sm-medium text-ink-gray-8">{{ __('Encryption fingerprint') }}</p>
      <ClickToCopyField :text-content="e2eeFingerprint" mono />
      <p class="text-xs text-ink-gray-6">
        {{ __('Everyone in this meeting should see the same fingerprint') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import { useE2EEState } from '../composables/useE2EEState'
import ClickToCopyField from './ClickToCopyField.vue'

withDefaults(
  defineProps<{
    meetingId?: string
    showHeading?: boolean
  }>(),
  {
    showHeading: true,
  },
)

const { isContextReady: isE2EEActive, sessionFingerprint: e2eeFingerprint } = useE2EEState()
const meetingUrl = computed(() => window.location.href)
</script>
