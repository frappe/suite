import { defineComponent, h, type Component } from 'vue'

import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

type BodyModule = { default: Component }

/** Wraps a Calendar tab body in the Calendar injections, loaded with the body. */
function scoped(load: () => Promise<BodyModule>) {
  return async (): Promise<Component> => {
    const [{ default: Body }, { default: Scope }] = await Promise.all([
      load(),
      import('@/apps/calendar/components/Settings/CalendarSettingsScope.vue'),
    ])
    return defineComponent({
      name: 'CalendarSettingsTab',
      setup: () => () => h(Scope, null, { default: () => h(Body) }),
    })
  }
}

export const calendarSettings = {
  label: () => __('Calendar'),
  area: 'calendar',
  condition: () => useSession().capabilities.value.jmap,
  tabs: [
    {
      id: 'calendar.calendars',
      label: () => __('Calendars'),
      icon: 'lucide-calendar-days',
      body: scoped(() => import('@/apps/calendar/components/Settings/CalendarsSettings.vue')),
      sections: [
        { id: 'your-calendars', label: () => __('Your calendars') },
        { id: 'invite-addresses', label: () => __('Invite addresses') },
      ],
    },
    {
      id: 'calendar.advanced',
      label: () => __('Import and setup'),
      icon: 'lucide-wrench',
      body: scoped(() => import('@/apps/calendar/components/Settings/AdvancedSettings.vue')),
      sections: [
        { id: 'import', label: () => __('Import') },
        { id: 'export', label: () => __('Export'), keywords: () => __('download, backup') },
        {
          id: 'client-setup',
          label: () => __('Calendar client setup'),
          keywords: () => __('CalDAV'),
        },
      ],
    },
  ],
} as const
