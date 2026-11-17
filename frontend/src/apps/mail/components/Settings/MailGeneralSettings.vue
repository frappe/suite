<template>
  <AppSettingsHeader :title="__('General')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <SettingsSection :title="__('Reading')">
        <div class="divide-y divide-outline-gray-1">
          <!-- The list's layout is for a desktop; a phone has one layout. -->
          <template v-if="hasListLayout">
            <SettingsRow
              :title="__('Split view')"
              :description="__('Preview a message beside the list.')"
            >
              <Switch v-model="splitView" />
            </SettingsRow>
            <SettingsRow
              :title="__('Group by date')"
              :description="__('Show the list under date headings such as Today and Yesterday.')"
            >
              <Switch v-model="groupByDate" />
            </SettingsRow>
          </template>
          <SettingsRow
            v-if="preferences"
            :title="__('Block remote images')"
            :description="__(`Don’t load remote images from untrusted sources by default.`)"
          >
            <Switch v-model="blockRemoteImages" />
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection v-if="hasProvider" :title="__('Region')">
        <div v-if="region" class="divide-y divide-outline-gray-1">
          <SettingsRow :title="__('Locale')">
            <Combobox
              trigger="button"
              align="end"
              :model-value="region.locale"
              :options="locales"
              @update:model-value="(locale) => changeRegion('locale', locale)"
            />
          </SettingsRow>
          <SettingsRow :title="__('Time zone')">
            <Combobox
              trigger="button"
              align="end"
              :model-value="region.time_zone"
              :options="timeZones"
              @update:model-value="(zone) => changeRegion('time_zone', zone)"
            />
          </SettingsRow>
        </div>
        <ErrorMessage :message="regional.error?.message" />
      </SettingsSection>

      <!-- Read-only, so it sits after the settings rather than ahead of them; the sidebar shows
           this meter only once the account is nearly full. -->
      <SettingsSection :title="__('Storage')">
        <StorageMeter class="mt-3" :used-percentage :label :limited="isLimited" />
      </SettingsSection>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Combobox, ErrorMessage, SettingsRow, Switch } from 'frappe-ui'
import { computed } from 'vue'

import { api, client, type InputOf } from '@/api'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { useQuota } from '@/apps/mail/composables/useQuota'
import { useRegionalPreferences } from '@/apps/mail/composables/useRegionalPreferences'
import { userStore } from '@/apps/mail/stores/user'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import StorageMeter from '@/components/StorageMeter.vue'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'

const { isMobile } = useScreenSize()
const { isLimited, usedPercentage, label } = useQuota()
const user = userStore().userResource
const { preferences, flag } = useAccountPreferences()
const blockRemoteImages = flag('block_remote_images')

const hasListLayout = computed(() => !!user.data?.is_jmap_configured && !isMobile.value)
// Saves here are not a component's mutations: those are cancelled when the page goes, and a choice
// made just before leaving the page must still be saved
async function saveLayout(choice: InputOf<typeof api.mail.settings.updatePreferences>) {
  try {
    await client.mutation(api.mail.settings.updatePreferences, choice)
  } catch {
    // The refusal is reported where every failed save is, and the switch goes back with the read
  }
}

/** One on/off choice of the list's layout, as a switch's `v-model`. */
function layoutFlag(field: 'show_reading_pane' | 'group_by_date') {
  return computed({
    get: () => !!user.data?.[field],
    set: (isOn) => void saveLayout({ [field]: isOn ? 1 : 0 }),
  })
}

const splitView = layoutFlag('show_reading_pane')
const groupByDate = layoutFlag('group_by_date')

const { hasProvider, regional, region, change: changeRegion } = useRegionalPreferences()
const locales = computed(() => regional.data?.locales ?? [])
const timeZones = computed(() => regional.data?.time_zones ?? [])
</script>
