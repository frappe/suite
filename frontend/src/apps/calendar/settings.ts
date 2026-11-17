import { defineComponent, h, type Component } from 'vue'

import { api, client } from '@/api'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

type BodyModule = { default: Component }

/**
 * Wraps a Calendar tab body in the Calendar injections, loaded with the body.
 * The scope shows the tab's header and the loading state until the account is
 * in.
 */
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

const calendar = {
  label: () => __('Calendar'),
  condition: () => useSession().capabilities.value.jmap,
  tabs: [
    {
      id: 'calendar.calendars',
      label: () => __('Calendars'),
      icon: 'lucide-calendar-days',
      body: scoped(() => import('@/apps/calendar/components/Settings/CalendarsSettings.vue')),
    },
    {
      id: 'calendar.identity',
      label: () => __('Identity'),
      icon: 'lucide-contact',
      body: scoped(() => import('@/apps/calendar/components/Settings/IdentitySettings.vue')),
    },
    {
      id: 'calendar.transfer',
      label: () => __('Import & export'),
      icon: 'lucide-arrow-down-up',
      body: scoped(() => import('@/apps/calendar/components/Settings/TransferSettings.vue')),
    },
    {
      id: 'calendar.advanced',
      label: () => __('Advanced'),
      icon: 'lucide-code',
      body: scoped(() => import('@/apps/calendar/components/Settings/AdvancedSettings.vue')),
    },
  ],
} as const

/** Reads the client config for the Advanced tab, then resolves the group. */
export async function calendarSettings() {
  const config = useSession().capabilities.value.jmap
    ? await client.query(api.mail.calendar.clientConfig).catch(() => undefined)
    : undefined
  return {
    ...calendar,
    tabs: calendar.tabs.filter(
      (tab) => tab.id !== 'calendar.advanced' || Boolean(config?.server_url),
    ),
  }
}
