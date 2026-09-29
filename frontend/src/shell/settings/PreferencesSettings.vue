<template>
  <SettingsTabHeader :title="__('Preferences')" />
  <SettingsTabContent>
    <!-- pt-2.5 + first row's py-3.5 = 24px, level with the profile tab's pt-6 -->
    <div class="divide-y divide-outline-gray-1 pt-2.5">
      <SettingsRow
        :title="__('Appearance')"
        :description="__('Choose a light, dark, or system-matched interface')"
      >
        <Select
          :model-value="theme.savedMode.value"
          :options="THEME_OPTIONS"
          @update:model-value="selectTheme"
        />
      </SettingsRow>
      <SettingsRow
        :title="__('Language')"
        :description="__('The language that the interface is shown in')"
      >
        <Combobox
          trigger="button"
          align="end"
          :model-value="user.doc?.language"
          :options="languageOptions"
          :placeholder="__('Select language')"
          :disabled="saving"
          @update:model-value="(value) => saveUserField('language', value)"
        />
      </SettingsRow>
      <SettingsRow
        :title="__('Time zone')"
        :description="__('Your local time zone for dates and times')"
      >
        <Combobox
          trigger="button"
          align="end"
          :model-value="normalizeTimezone(user.doc?.time_zone || '')"
          :options="timezoneOptions"
          :placeholder="__('Select time zone')"
          :disabled="saving"
          @update:model-value="(value) => saveUserField('time_zone', value)"
        />
      </SettingsRow>
    </div>
  </SettingsTabContent>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Combobox,
  Select,
  SettingsRow,
  createDocumentResource,
  createResource,
  toast,
} from 'frappe-ui'

import { useSession } from '@/platform/session'
import { useTheme, type ThemeMode } from '@/platform/theme'
import { translate as __ } from '@/platform/translation'
import SettingsTabContent from '@/shell/settings/SettingsTabContent.vue'
import SettingsTabHeader from '@/shell/settings/SettingsTabHeader.vue'
import { normalizeTimezone, useTimezones } from '@/shell/useTimezones'

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: __('Light'), value: 'light', icon: 'lucide-sun' },
  { label: __('Dark'), value: 'dark', icon: 'lucide-moon' },
  { label: __('Automatic'), value: 'automatic', icon: 'lucide-monitor' },
]

function selectTheme(value?: string | number | null) {
  const option = THEME_OPTIONS.find((candidate) => candidate.value === value)
  if (option) void theme.set(option.value)
}

const theme = useTheme()
const session = useSession()

const user = createDocumentResource({
  doctype: 'User',
  name: session.user.value?.id ?? '',
  auto: true,
})

const saving = computed(() => user.setValue.loading)

const languageOptions = ref<{ label: string; value: string }[]>([])

createResource({
  url: 'frappe.client.get_list',
  params: {
    doctype: 'Language',
    filters: { enabled: 1 },
    fields: ['name', 'language_name'],
    limit_page_length: 0,
    order_by: 'language_name asc',
  },
  auto: true,
  onSuccess(data: { name: string; language_name: string }[]) {
    languageOptions.value = data.map((lang) => ({ label: lang.language_name, value: lang.name }))
  },
})

const { timezoneOptions } = useTimezones()

// Language and time zone shape the whole session (translations, rendered
// dates), so a full reload after save is the only way to apply them.
async function saveUserField(fieldname: 'language' | 'time_zone', value?: string | number | null) {
  if (!user.doc || saving.value) return
  if (typeof value !== 'string' || !value || value === user.originalDoc?.[fieldname]) return
  try {
    await user.setValue.submit({ [fieldname]: value })
    window.location.reload()
  } catch {
    toast.error(__('Could not save preferences'))
  }
}
</script>
