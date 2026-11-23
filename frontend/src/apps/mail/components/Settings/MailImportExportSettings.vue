<template>
  <AppSettingsHeader :title="__('Import and export')" />
  <AppSettingsBody>
    <!-- Each part opens in a dialog. Import is first: Home's "import your mail" step opens it. -->
    <div class="divide-y divide-outline-gray-1">
      <SettingsDialogRow
        :title="__('Import')"
        section="mail.import-export.import"
        :description="__('Bring in mail or contacts from a file.')"
        :action="__('Import')"
      >
        <ImportSettings />
      </SettingsDialogRow>
      <SettingsDialogRow
        :title="__('Export')"
        section="mail.import-export.export"
        :description="__('Download a copy of your mail or contacts.')"
        :action="__('Export')"
      >
        <ExportSettings />
      </SettingsDialogRow>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import ExportSettings from '@/apps/mail/components/Settings/ExportSettings.vue'
import ImportSettings from '@/apps/mail/components/Settings/ImportSettings.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import { translate as __ } from '@/platform/translation'
</script>
