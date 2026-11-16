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
    },
    {
      id: 'calendar.advanced',
      label: () => __('Advanced'),
      icon: 'lucide-code',
      body: scoped(() => import('@/apps/calendar/components/Settings/AdvancedSettings.vue')),
    },
  ],
} as const
