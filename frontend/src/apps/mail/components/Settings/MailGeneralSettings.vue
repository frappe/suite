<template>
  <AppSettingsHeader :title="__('Layout')" />
  <AppSettingsBody>
    <!-- The list's layout is for a desktop; a phone has one layout. -->
    <div v-if="hasListLayout" class="divide-y divide-outline-gray-1 pt-2.5">
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
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'
import { computed } from 'vue'

import { api, client, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import { translate as __ } from '@/platform/translation'

const { isMobile } = useScreenSize()
const user = userStore().userResource

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
</script>
