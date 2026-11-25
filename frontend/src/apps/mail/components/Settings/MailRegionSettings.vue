<!--
  The Mail server's own locale and time zone for the account, as rows that sit under the account's
  Language and Time zone in Preferences. Only a site with a mail provider has them.
-->
<template>
  <template v-if="hasProvider">
    <template v-if="region">
      <SettingsRow
        :title="__('Mail locale')"
        :description="__('How the mail server writes dates and numbers for you.')"
      >
        <Combobox
          trigger="button"
          align="end"
          :model-value="region.locale"
          :options="locales"
          @update:model-value="(locale) => change('locale', locale)"
        />
      </SettingsRow>
      <SettingsRow
        :title="__('Mail time zone')"
        :description="__('The time zone the mail server keeps for you.')"
      >
        <Combobox
          trigger="button"
          align="end"
          :model-value="region.time_zone"
          :options="timeZones"
          @update:model-value="(zone) => change('time_zone', zone)"
        />
      </SettingsRow>
    </template>
    <ErrorMessage :message="regional.error?.message" />
  </template>
</template>

<script setup lang="ts">
import { Combobox, ErrorMessage, SettingsRow } from 'frappe-ui'
import { computed } from 'vue'

import { useRegionalPreferences } from '@/apps/mail/composables/useRegionalPreferences'
import { translate as __ } from '@/platform/translation'

const { hasProvider, regional, region, change } = useRegionalPreferences()
const locales = computed(() => regional.data?.locales ?? [])
const timeZones = computed(() => regional.data?.time_zones ?? [])
</script>
