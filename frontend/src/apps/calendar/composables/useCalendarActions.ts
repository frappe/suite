import { Pencil, Pin, Trash2 } from 'lucide-vue-next'
import { ref } from 'vue'

import { api, client } from '@/api'
import { userStore } from '@/apps/calendar/stores/user'
import { raiseToast } from '@/apps/calendar/utils'
import type { CalendarRow } from '@/apps/calendar/utils/calendars'

/**
 * What can be done to a calendar, for the two places that list them: the sidebar
 * and the Calendars settings tab (the phone's only way in). The caller renders
 * CalendarModal on `showEdit` and DeleteCalendarModal on `showDelete`, both for
 * `selected`.
 */
export const useCalendarActions = () => {
  const store = userStore()

  const selected = ref<CalendarRow>()
  const showEdit = ref(false)
  const showDelete = ref(false)

  const makeDefault = async (calendar: CalendarRow) => {
    try {
      await client.mutation(api.calendar.calendars.update, {
        account: calendar.account,
        id: calendar.id,
        default: true,
      })
      raiseToast(__('Default calendar changed.'))
    } catch {
      /* The shared mutation feedback reports the refusal. */
    }
  }

  // Shown at once and saved behind: a toggle that waited on the server would feel broken,
  // and one that failed puts the calendar back as it was.
  const toggleVisible = (calendar: CalendarRow) => {
    const visible = calendar.visible ? 0 : 1
    calendar.visible = visible
    if (!calendar.may_write_all) {
      store.hiddenShared = visible
        ? store.hiddenShared.filter((name) => name !== calendar.name)
        : [...store.hiddenShared, calendar.name]
      return
    }
    void client
      .mutation(api.calendar.calendars.update, {
        account: calendar.account,
        id: calendar.id,
        visible: !!visible,
      })
      .catch(() => {
        calendar.visible = visible ? 0 : 1
      })
  }

  const create = () => edit(undefined)

  const edit = (calendar?: CalendarRow) => {
    selected.value = calendar
    showEdit.value = true
  }

  // A calendar shared read-only can't be renamed or recoloured, and is no place for new
  // events and invitations to land.
  const canEdit = (calendar: CalendarRow) => !!calendar.may_write_all

  const menuOptions = (calendar: CalendarRow) => [
    {
      label: __('Edit'),
      icon: Pencil,
      condition: () => canEdit(calendar),
      onClick: () => edit(calendar),
    },
    {
      label: __('Set as Default'),
      icon: Pin,
      condition: () => canEdit(calendar) && !calendar.default,
      onClick: () => makeDefault(calendar),
    },
    // The default is where new events and invitations land, so it stays until another takes over.
    {
      label: __('Delete'),
      icon: Trash2,
      theme: 'red',
      condition: () => !calendar.default && !!calendar.may_delete,
      onClick: () => {
        selected.value = calendar
        showDelete.value = true
      },
    },
  ]

  // With nothing to offer, the options button is left out rather than opening an empty menu.
  const hasMenuOptions = (calendar: CalendarRow) =>
    menuOptions(calendar).some((option) => !option.condition || option.condition())

  return {
    selected,
    showEdit,
    showDelete,
    create,
    edit,
    canEdit,
    toggleVisible,
    menuOptions,
    hasMenuOptions,
  }
}
