import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute, useRouter } from 'vue-router'

import { useEmailParticipants } from './useEmailParticipants'

// Mail's composer, as far as the calendar can see it: where the calendar stood when it opened.
const opened = vi.hoisted<{ at: string[]; read: () => string }>(() => ({ at: [], read: () => '' }))
vi.mock('@/apps/mail', () => ({
  useMailCompose: () => ({
    compose: async () => {
      opened.at.push(opened.read())
    },
  }),
}))

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  opened.at = []
})

/** The calendar, an event open on it (its card on a desktop, its sheet on a phone). */
async function openEvent(phone: boolean) {
  let email!: ReturnType<typeof useEmailParticipants>
  const Calendar = defineComponent({
    setup() {
      const route = useRoute()
      const router = useRouter()
      opened.read = () => route.fullPath
      // As the calendar closes its event: off the URL.
      const closeCard = () => {
        const { event: _event, ...query } = route.query
        return router.replace({ query })
      }
      email = useEmailParticipants({ closeCard, isCard: () => !phone })
      return () => null
    },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/calendar/:any(.*)*', component: Calendar }],
  })
  await router.push('/calendar/week?event=standup')
  const app = createApp({ render: () => h(RouterView) })
  app.use(router)
  app.mount(document.createElement('div'))
  apps.push(app)
  await vi.waitFor(() => expect(email).toBeDefined())
  return email
}

const people = [{ email: 'dana@brightwave.example', display_name: 'Dana Whitfield' }]

describe('emailing an event’s participants', () => {
  it('on a desktop, closes the event’s card before Mail’s window opens over the calendar', async () => {
    const email = await openEvent(false)

    await email(people)

    expect(opened.at).toEqual(['/calendar/week'])
  })

  it('on a phone, leaves the event’s sheet open behind Mail’s compose page', async () => {
    const email = await openEvent(true)

    await email(people)

    expect(opened.at).toEqual(['/calendar/week?event=standup'])
  })
})
