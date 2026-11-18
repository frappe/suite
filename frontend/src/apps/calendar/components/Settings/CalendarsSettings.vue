<!--
  Calendar > Calendars: the account's calendars and the ones shared with it.
  A calendar the user can write to opens its edit dialog; one shared
  read-only is listed with no actions.
-->
<template>
  <SettingsPage
    :description="__('Your calendars and the ones shared with you')"
    :loading="!calendars.data"
    :reads="[calendars]"
  >
    <template #actions>
      <Button icon-left="lucide-plus" :label="__('New')" @click="create" />
    </template>
    <SettingsSection v-if="calendars.data">
      <SettingsListRow
        v-for="calendar in calendars.data"
        :key="calendar.name"
        :title="calendar._name"
        :menu="menu(calendar)"
        :on-open="canEdit(calendar) ? () => edit(calendar) : undefined"
      >
        <template #leading>
          <span
            class="size-2.5 rounded-full"
            :style="{ background: eventColor(calendarColor(calendars.data, calendar.name)) }"
            aria-hidden="true"
          />
        </template>
        <template v-if="calendar.default || !canEdit(calendar)" #trailing>
          <Badge v-if="calendar.default" :label="__('Default')" />
          <Badge v-if="!canEdit(calendar)" :label="__('Read-only')" />
        </template>
      </SettingsListRow>
      <SettingsEmpty
        v-if="!calendars.data.length"
        :title="__('No calendars yet')"
        :description="__('Events live in a calendar. Make one to start adding events.')"
      />
    </SettingsSection>

    <CalendarModal v-model="showEdit" :calendar="selected" />
    <DeleteCalendarModal v-model="showDelete" :calendar="selected" />
  </SettingsPage>
</template>

<script setup lang="ts">
import { Badge, Button } from 'frappe-ui'

import CalendarModal from '@/apps/calendar/components/Modals/CalendarModal.vue'
import DeleteCalendarModal from '@/apps/calendar/components/Modals/DeleteCalendarModal.vue'
import { useCalendarActions } from '@/apps/calendar/composables/useCalendarActions'
import { userStore } from '@/apps/calendar/stores/user'
import { calendarColor, type CalendarRow } from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'
import {
  SettingsEmpty,
  SettingsListRow,
  SettingsPage,
  SettingsSection,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const { calendars } = userStore()
const { selected, showEdit, showDelete, create, edit, canEdit, menuOptions } = useCalendarActions()

// The row hides its menu button when there is nothing in it.
function menu(calendar: CalendarRow) {
  return menuOptions(calendar).filter((option) => option.condition())
}
</script>
