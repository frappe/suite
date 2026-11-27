<!--
  Storage in Settings: what each app holds against its own quota, Drive's and, for someone who
  has Mail, Mail's, one titled part each. The apps keep separate quotas, so each part shows its own.
-->
<template>
  <SettingsTabHeader :title="__('Storage')" />
  <SettingsTabContent>
    <div class="flex flex-col gap-10 pt-6">
      <SettingsSection :title="__('Drive')">
        <DriveStorageUsage class="pt-3" />
      </SettingsSection>
      <SettingsSection v-if="hasMail" :title="__('Mail')">
        <MailStorageUsage class="pt-3" />
      </SettingsSection>
    </div>
  </SettingsTabContent>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { DriveStorageUsage } from '@/apps/drive'
import { mailArea, MailStorageUsage } from '@/apps/mail'
import { hasCapabilities, useSession } from '@/platform/session'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'
import SettingsTabContent from '@/shell/settings/SettingsTabContent.vue'
import SettingsTabHeader from '@/shell/settings/SettingsTabHeader.vue'

const session = useSession()
const hasMail = computed(() => hasCapabilities(mailArea.requires, session))
</script>
