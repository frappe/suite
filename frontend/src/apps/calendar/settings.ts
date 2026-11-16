import { defineComponent, h, type Component } from 'vue'

import { api, client } from '@/api'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

type BodyModule = { default: Component }

/**
 * Wraps a Calendar tab body in the Calendar injections, loaded with the body.
 * The scope shows the tab's header and the loading state until the account is
 * in, so `title` is the tab's label.
 */
function scoped(title: () => string, load: () => Promise<BodyModule>) {
  return async (): Promise<Component> => {
    const [{ default: Body }, { default: Scope }] = await Promise.all([
      load(),
      import('@/apps/calendar/components/Settings/CalendarSettingsScope.vue'),
    ])
    return defineComponent({
      name: 'CalendarSettingsTab',
      setup: () => () => h(Scope, { title: title() }, { default: () => h(Body) }),
    })
  }
}

const calendarsLabel = () => __('Calendars')
const identityLabel = () => __('Identity')
const transferLabel = () => __('Import & export')
const advancedLabel = () => __('Advanced')

const calendar = {
  label: () => __('Calendar'),
  condition: () => useSession().capabilities.value.jmap,
  tabs: [
    {
      id: 'calendar.calendars',
      label: calendarsLabel,
      icon: 'lucide-calendar-days',
      body: scoped(
        calendarsLabel,
        () => import('@/apps/calendar/components/Settings/CalendarsSettings.vue'),
      ),
    },
    {
      id: 'calendar.identity',
      label: identityLabel,
      icon: 'lucide-contact',
      body: scoped(
        identityLabel,
        () => import('@/apps/calendar/components/Settings/IdentitySettings.vue'),
      ),
    },
    {
      id: 'calendar.transfer',
      label: transferLabel,
      icon: 'lucide-arrow-down-up',
      body: scoped(
        transferLabel,
        () => import('@/apps/calendar/components/Settings/TransferSettings.vue'),
      ),
    },
    {
      id: 'calendar.advanced',
      label: advancedLabel,
      icon: 'lucide-code',
      body: scoped(
        advancedLabel,
        () => import('@/apps/calendar/components/Settings/AdvancedSettings.vue'),
      ),
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
