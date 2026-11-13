<!--
  The phone account sheet, opened from the avatar in the bottom nav [T010]:
  who is signed in, then Settings and Theme, and Log out set apart. The sheet shows no title,
  so a visually hidden one names the dialog "Account".
-->
<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <div class="px-4 pb-8">
      <DialogTitle class="sr-only">{{ __('Account') }}</DialogTitle>
      <div>
        <div class="flex items-center gap-3 px-1 pb-4">
          <Avatar size="3xl" :image="user?.avatar ?? undefined" :label="name" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-lg font-semibold text-ink-gray-9">{{ name }}</span>
            <span v-if="email" class="truncate text-sm text-ink-gray-5">{{ email }}</span>
          </div>
        </div>

        <nav :aria-label="__('Account')">
          <div class="space-y-0.5">
            <SidebarItem :label="__('Settings')" icon="lucide-settings" @click="showSettings" />
            <div class="flex h-7 items-center justify-between gap-3 pl-2">
              <span class="flex items-center gap-2 text-sm text-ink-gray-8">
                <span class="lucide-sun-moon size-4 text-ink-gray-6" aria-hidden="true" />
                {{ __('Theme') }}
              </span>
              <TabButtons
                :model-value="theme.savedMode.value"
                :options="themeOptions"
                :aria-label="__('Theme')"
                @update:model-value="setTheme"
              />
            </div>
          </div>
          <!-- Set apart from the settings above it, as the desktop menu sets it in a group of its
               own: a tap that meant Theme must not end the session. -->
          <div class="mt-3 border-t pt-3">
            <SidebarItem :label="__('Log out')" icon="lucide-log-out" @click="logOut" />
          </div>
        </nav>
      </div>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { Avatar, BottomSheet, SidebarItem, TabButtons } from 'frappe-ui'
import { DialogTitle } from 'reka-ui'
import { computed } from 'vue'

import { useSession } from '@/platform/session'
import { useTheme, type ThemeMode } from '@/platform/theme'
import { translate as __ } from '@/platform/translation'
import { openSettings } from '@/shell/settings/useSettingsDialog'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const session = useSession()
const theme = useTheme()
const user = computed(() => session.user.value)
const name = computed(() => user.value?.fullName || user.value?.id || __('Account'))
const email = computed(() => user.value?.email ?? null)

const themeOptions: { label: string; value: ThemeMode }[] = [
  { label: __('Light'), value: 'light' },
  { label: __('Dark'), value: 'dark' },
  { label: __('Auto'), value: 'automatic' },
]

function setTheme(value: string | number) {
  const option = themeOptions.find((candidate) => candidate.value === value)
  if (option) void theme.set(option.value)
}

function close() {
  emit('update:open', false)
}

function showSettings() {
  close()
  openSettings()
}

function logOut() {
  void session.logout().then(() => window.location.reload())
}
</script>
