<template>
  <AppSettingsHeader :title="__('Advanced')" />
  <AppSettingsBody>
    <div class="divide-y divide-outline-gray-1">
      <SettingsDialogRow
        :title="__('Import')"
        section="calendar.advanced.import"
        :description="__('Bring events in from a file.')"
        :action="__('Import')"
      >
        <ImportSettings />
      </SettingsDialogRow>
      <SettingsDialogRow
        :title="__('Export')"
        section="calendar.advanced.export"
        :description="__('Download a copy of your events.')"
        :action="__('Export')"
      >
        <ExportSettings />
      </SettingsDialogRow>
      <!-- Only where the site has a CalDAV server to connect to. -->
      <SettingsDialogRow
        v-if="config.server_url"
        :title="__('Calendar client setup')"
        section="calendar.advanced.client-setup"
        :description="__('Server details for apps such as Thunderbird or Apple Calendar.')"
        :action="__('Show')"
        size="xl"
      >
        <div class="flex flex-col gap-4">
          <p class="text-ink-gray-6 text-base">
            {{
              __(
                'Use these CalDAV details to connect a third-party calendar client such as Thunderbird or Apple Calendar. Clients that support autodiscovery only need the Server URL; others take the full Calendar URL.',
              )
            }}
          </p>

          <CopyControl :label="__('Server URL')" :value="config.server_url" />
          <CopyControl :label="__('Calendar URL')" :value="config.calendar_url ?? ''" />
          <CopyControl :label="__('Username')" :value="config.username ?? ''" />
          <p class="text-ink-gray-5 text-sm">
            {{ __('Sign in using your existing mail account password.') }}
          </p>
        </div>
      </SettingsDialogRow>
    </div>
  </AppSettingsBody>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import ExportSettings from '@/apps/calendar/components/Settings/ExportSettings.vue'
import ImportSettings from '@/apps/calendar/components/Settings/ImportSettings.vue'
import CopyControl from '@/components/CopyControl.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'

const clientConfig = useQuery(api.mail.calendar.clientConfig)

const config = computed(() => clientConfig.data ?? {})
</script>
