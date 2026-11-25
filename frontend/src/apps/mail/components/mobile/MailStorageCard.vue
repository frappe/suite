<template>
  <!-- The account's storage on the phone's Settings page, where a computer shows it in the sidebar
       once the account is nearly full: a phone has no sidebar, and no Storage tab. -->
  <MobileSettingsCard v-if="quota.data">
    <div class="flex flex-col gap-2.5 p-3">
      <div class="flex items-center gap-3 text-base">
        <span class="lucide-hard-drive text-ink-gray-6 size-4 shrink-0" aria-hidden="true" />
        <span class="text-ink-gray-8 flex-1">{{ __('Storage') }}</span>
      </div>
      <MailStorageUsage />
    </div>
  </MobileSettingsCard>
</template>

<script setup lang="ts">
import MobileSettingsCard from '@/apps/mail/components/mobile/MobileSettingsCard.vue'
import MailStorageUsage from '@/apps/mail/components/Settings/MailStorageUsage.vue'
import { useQuota } from '@/apps/mail/composables/useQuota'
import { translate as __ } from '@/platform/translation'

const { quota } = useQuota()
</script>
