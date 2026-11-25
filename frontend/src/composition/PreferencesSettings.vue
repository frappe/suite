<!--
  Preferences in Settings: the account's own, then, for someone who has Mail, the Mail server's
  locale and time zone beside the account's Language and Time zone.
-->
<template>
  <PreferencesSettings>
    <MailRegionSettings v-if="hasMail" />
  </PreferencesSettings>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { mailArea, MailRegionSettings } from '@/apps/mail'
import { hasCapabilities, useSession } from '@/platform/session'
import PreferencesSettings from '@/shell/settings/PreferencesSettings.vue'

const session = useSession()
const hasMail = computed(() => hasCapabilities(mailArea.requires, session))
</script>
