<template>
  <AppSettingsHeader :title="__('Calendars')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <SettingsSection :title="__('Your calendars')">
        <template #actions>
          <Button
            icon-left="lucide-plus"
            :label="__('New calendar')"
            :size="isMobile ? 'md' : 'sm'"
            @click="create"
          />
        </template>
        <div v-if="calendars.data?.length" class="mt-2">
          <!-- A row with no button stands as tall as one with a button -->
          <div
            v-for="calendar in calendars.data"
            :key="calendar.name"
            class="flex min-h-9 items-center justify-between gap-3 py-1 max-sm:min-h-12 max-sm:py-2"
          >
            <div class="flex min-w-0 items-center gap-2 max-sm:gap-3">
              <span
                class="size-2.5 shrink-0 rounded-full"
                :style="{ background: eventColor(calendarColor(calendars.data, calendar.name)) }"
              />
              <span class="truncate text-base text-ink-gray-8">{{ calendar._name }}</span>
              <!-- Beside the name, where every list in Settings keeps what it says of a row -->
              <Badge v-if="calendar.default" :label="__('Default')" size="sm" class="shrink-0" />
              <Badge
                v-if="isReadOnly(calendar)"
                :label="__('Read-only')"
                size="sm"
                class="shrink-0"
              />
            </div>
            <Button
              v-if="canEdit(calendar)"
              class="shrink-0"
              :label="__('Edit')"
              :size="buttonSize"
              @click="edit(calendar)"
            />
          </div>
        </div>
      </SettingsSection>
      <div class="divide-y divide-outline-gray-1">
        <SettingsDialogRow
          :title="__('Invite addresses')"
          section="calendar.calendars.invite-addresses"
          :description="__('The addresses you organize and attend events as.')"
          :action="__('Manage')"
        >
          <ParticipantIdentitySettings />
        </SettingsDialogRow>
      </div>
    </div>

    <CalendarModal v-model="showEdit" :calendar="selected" @delete="deleteSelected" />
    <DeleteCalendarModal v-model="showDelete" :calendar="selected" />
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Badge, Button } from 'frappe-ui'
import { computed } from 'vue'

import CalendarModal from '@/apps/calendar/components/Modals/CalendarModal.vue'
import DeleteCalendarModal from '@/apps/calendar/components/Modals/DeleteCalendarModal.vue'
import ParticipantIdentitySettings from '@/apps/calendar/components/Settings/ParticipantIdentitySettings.vue'
import { useCalendarActions } from '@/apps/calendar/composables/useCalendarActions'
import { userStore } from '@/apps/calendar/stores/user'
import { calendarColor, type CalendarRow } from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import { useScreenSize } from '@/composables/useScreenSize'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import SettingsSection from '@/platform/settings/SettingsSection.vue'

const { calendars } = userStore()
const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))
const { selected, showEdit, showDelete, create, edit, canEdit, deleteSelected } =
  useCalendarActions()

// A calendar shared for reading only: it shows, and nothing about it can be changed
function isReadOnly(calendar: CalendarRow) {
  return !canEdit(calendar)
}
</script>
