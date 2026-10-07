<template>
  <AppSettingsHeader :title="__('Advanced')" />
  <AppSettingsBody>
    <div v-if="config.server_url" class="flex flex-col gap-4">
      <div class="space-y-1">
        <h2 class="text-base-semibold text-ink-gray-8">
          {{ __('Calendar Client Configuration') }}
        </h2>
        <p class="text-ink-gray-6 text-base">
          {{
            __(
              'Use these CalDAV details to connect a third-party calendar client such as Thunderbird or Apple Calendar. Clients that support autodiscovery only need the Server URL; others take the full Calendar URL.',
            )
          }}
        </p>
      </div>

      <CopyControl :label="__('Server URL')" :value="config.server_url" />
      <CopyControl :label="__('Calendar URL')" :value="config.calendar_url ?? ''" />
      <CopyControl :label="__('Username')" :value="config.username ?? ''" />
      <p class="text-ink-gray-5 text-sm">
        {{ __('Sign in using your existing mail account password.') }}
      </p>
    </div>
  </AppSettingsBody>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import CopyControl from '@/components/CopyControl.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const clientConfig = useQuery(api.mail.calendar.clientConfig)

const config = computed(() => clientConfig.data ?? {})
</script>
