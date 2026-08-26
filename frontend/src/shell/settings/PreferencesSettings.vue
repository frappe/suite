<template>
  <SettingsHeader>
    <h2 class="text-md-semibold text-ink-gray-8">{{ __('Preferences') }}</h2>
  </SettingsHeader>
  <SettingsBody>
    <!-- pt-2.5 + first row's py-3.5 = 24px, level with the profile tab's pt-6 -->
    <div class="divide-y divide-outline-gray-1 pt-2.5">
      <SettingsRow
        :title="__('Appearance')"
        :description="__('Choose a light, dark, or system-matched interface')"
      >
        <Select
          :model-value="themeMode"
          :options="THEME_OPTIONS"
          @update:model-value="switchTheme"
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
          :model-value="user.doc?.time_zone"
          :options="timezoneOptions"
          :placeholder="__('Select time zone')"
          :disabled="saving"
          @update:model-value="(value) => saveUserField('time_zone', value)"
        />
      </SettingsRow>
    </div>
  </SettingsBody>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Combobox,
  Select,
  SettingsBody,
  SettingsHeader,
  SettingsRow,
  createDocumentResource,
  createResource,
  toast,
} from 'frappe-ui'

import { useSessionStore } from '@/boot/session'
import { useTimezones } from '@/shell/useTimezones'
import { switchTheme, themeMode } from '@/utils/setupTheme'

const THEME_OPTIONS = [
  { label: __('Light'), value: 'light' },
  { label: __('Dark'), value: 'dark' },
  { label: __('Automatic'), value: 'automatic' },
]

const session = useSessionStore()

const user = createDocumentResource({
  doctype: 'User',
  name: session.user as string,
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
async function saveUserField(fieldname: 'language' | 'time_zone', value?: string | null) {
  if (!user.doc || saving.value) return
  if (!value || value === user.originalDoc?.[fieldname]) return
  try {
    await user.setValue.submit({ [fieldname]: value })
    window.location.reload()
  } catch {
    toast.error(__('Could not save preferences'))
  }
}
</script>
