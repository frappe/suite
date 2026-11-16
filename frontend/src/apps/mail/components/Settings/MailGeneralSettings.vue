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
              :description="__('Preview emails alongside the message list.')"
            >
              <Switch v-model="splitView" />
            </SettingsRow>
            <SettingsRow
              :title="__('Group by date')"
              :description="
                __('Section the message list by date: today, yesterday, this week, and so on.')
              "
            >
              <Switch v-model="groupByDate" />
            </SettingsRow>
          </template>
          <SettingsRow
            v-if="preferences"
            :title="__('Block remote images')"
            :description="__(`Don't load remote images from untrusted sources by default.`)"
          >
            <Switch v-model="blockRemoteImages" />
          </SettingsRow>
        </div>
      </SettingsSection>

      <!-- Apart from the routine switches: each one costs the copy of what you send, and a copy
           that was never kept can't be found or answered from later. -->
      <SettingsSection v-if="preferences" :title="__('Sent copies')">
        <div class="divide-y divide-outline-gray-1">
          <SettingsRow
            :title="__('Don’t keep sent mail')"
            :description="
              __(
                'Mail you send is deleted once it has gone, and is not kept in Sent. You can’t find it, forward it or reply from it later.',
              )
            "
          >
            <Switch v-model="dropSentMail" />
          </SettingsRow>
          <SettingsRow
            :title="__('Don’t keep sent newsletters')"
            :description="
              __(
                'Newsletters, the bulk mail your apps send through this account, are deleted once they have gone rather than kept in Sent.',
              )
            "
          >
            <Switch v-model="dropSentNewsletters" />
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
        <StorageMeter :used-percentage :label :limited="isLimited" />
      </SettingsSection>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Combobox, ErrorMessage, SettingsRow, Switch } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { useQuota } from '@/apps/mail/composables/useQuota'
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
const dropSentMail = flag('destroy_email_after_submit')
const dropSentNewsletters = flag('destroy_newsletter_after_submit')

const hasListLayout = computed(() => !!user.data?.is_jmap_configured && !isMobile.value)
const layout = useMutation(api.mail.settings.updatePreferences)
async function saveLayout(choice: InputOf<typeof api.mail.settings.updatePreferences>) {
  try {
    await layout.run(choice)
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

// The mail provider's own locale and time zone; a site without one has neither
interface Region {
  locale: string
  time_zone: string
}
const hasProvider = computed(() => !!user.data?.is_suite_cloud_configured)
const regional = useQuery(api.mail.settings.regional, () => hasProvider.value && {})
const locales = computed(() => regional.data?.locales ?? [])
const timeZones = computed(() => regional.data?.time_zones ?? [])
const saveRegional = useMutation(api.mail.settings.updateRegional)
const region = ref<Region>()
function showSavedRegion() {
  region.value = regional.data && {
    locale: regional.data.locale,
    time_zone: regional.data.time_zone,
  }
}

watch(() => regional.data, showSavedRegion, { immediate: true })

// The control can also hand back nothing; a name is all there is to save
async function changeRegion(field: keyof Region, value: unknown) {
  if (!region.value || typeof value !== 'string') return

  region.value = { ...region.value, [field]: value }
  try {
    await saveRegional.run({ ...region.value })
  } catch {
    // The refusal is reported where every failed save is; here the choice goes back
    showSavedRegion()
  }
}
</script>
