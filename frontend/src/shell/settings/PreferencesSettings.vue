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
        :title="__('Cursor')"
        :description="
          __('Show the hand cursor on every control, or only on links that leave the app')
        "
      >
        <Select
          :model-value="cursor.mode.value"
          :options="CURSOR_OPTIONS"
          @update:model-value="selectCursor"
        />
      </SettingsRow>
      <SettingsRow
        :title="__('Language')"
        :description="__('The language that the interface is shown in')"
      >
        <Combobox
          trigger="button"
          align="end"
          :model-value="user.data?.language"
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
          :model-value="normalizeTimezone(user.data?.time_zone || '')"
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
import { Combobox, Select, SettingsRow, toast } from 'frappe-ui'
import { computed } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { useCursor, type CursorMode } from '@/platform/cursor'
import { useSession } from '@/platform/session'
import { useTheme, type ThemeMode } from '@/platform/theme'
import { translate as __ } from '@/platform/translation'
import SettingsTabContent from '@/shell/settings/SettingsTabContent.vue'
import SettingsTabHeader from '@/shell/settings/SettingsTabHeader.vue'
import { normalizeTimezone, useTimezones } from '@/shell/useTimezones'

const THEME_OPTIONS: {
  label: string
  value: ThemeMode
  icon: string
}[] = [
  {
    label: __('Light'),
    value: 'light',
    icon: 'lucide-sun',
  },
  {
    label: __('Dark'),
    value: 'dark',
    icon: 'lucide-moon',
  },
  {
    label: __('Automatic'),
    value: 'automatic',
    icon: 'lucide-monitor',
  },
]
function selectTheme(value?: string | number | null) {
  const option = THEME_OPTIONS.find((candidate) => candidate.value === value)
  if (option) void theme.set(option.value)
}
const CURSOR_OPTIONS: {
  label: string
  value: CursorMode
}[] = [
  {
    label: __('Normal'),
    value: 'normal',
  },
  {
    label: __('Pointer'),
    value: 'pointer',
  },
]
function selectCursor(value?: string | number | null) {
  const option = CURSOR_OPTIONS.find((candidate) => candidate.value === value)
  if (option) cursor.set(option.value)
}
const theme = useTheme()
const cursor = useCursor()
useSession()
const user = useQuery(api.suite.preferences.get)
const updateUser = useMutation(api.suite.preferences.update, {
  silent: true,
})
const saving = computed(() => updateUser.isPending)
const languages = useQuery(api.suite.locales.languages)
const languageOptions = computed(() =>
  (languages.data || []).map((language) => ({
    label: language.language_name,
    value: language.name,
  })),
)
const { timezoneOptions } = useTimezones()

// Language and time zone shape the whole session (translations, rendered
// dates), so a full reload after save is the only way to apply them.
async function saveUserField(fieldname: 'language' | 'time_zone', value?: string | number | null) {
  if (!user.data || saving.value) return
  if (typeof value !== 'string' || !value || value === user.data?.[fieldname]) return
  try {
    await updateUser.run({
      [fieldname]: value,
    })
    window.location.reload()
  } catch {
    toast.error(__('Could not save preferences'))
  }
}
</script>
