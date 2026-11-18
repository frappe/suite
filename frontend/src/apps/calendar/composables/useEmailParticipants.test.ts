import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute, useRouter } from 'vue-router'

import { useEmailParticipants } from './useEmailParticipants'

// Mail's composer window, as far as the calendar can see it: whether it was asked for (which loads
// its code), and where the calendar stood when it was. And the server: what was asked of it.
const mail = vi.hoisted<{ asked: number; openedAt: string[]; read: () => string }>(() => ({
  asked: 0,
  openedAt: [],
  read: () => '',
}))
vi.mock('@/apps/mail', async (original) => ({
  ...(await original<typeof import('@/apps/mail')>()),
  useMailCompose: () => ({
    compose: async () => {
      mail.asked++
      mail.openedAt.push(mail.read())
    },
  }),
}))
const asked = vi.hoisted<string[]>(() => [])
vi.hoisted(() => {
  globalThis.fetch = async (input) => {
    asked.push(String(input instanceof Request ? input.url : input))
    return Response.json({ message: [] })
  }
})

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  mail.openedAt = []
})

/** The calendar, an event open on it (its card on a desktop, its sheet on a phone). */
async function openEvent(phone: boolean) {
  let email!: ReturnType<typeof useEmailParticipants>
  const Calendar = defineComponent({
    setup() {
      const route = useRoute()
      const router = useRouter()
      mail.read = () => route.fullPath
      // As the calendar closes its event: off the URL.
      const closeCard = () => {
        const { event: _event, ...query } = route.query
        return router.replace({ query })
      }
      email = useEmailParticipants({ closeCard, isPhone: () => phone })
      return () => null
    },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/calendar/:any(.*)*', component: Calendar },
      { path: '/mail', component: { render: () => null } },
    ],
  })
  await router.push('/calendar/week?event=standup')
  const app = createApp({ render: () => h(RouterView) })
  app.use(router)
  app.mount(document.createElement('div'))
  apps.push(app)
  await vi.waitFor(() => expect(email).toBeDefined())
  return { email, router }
}

// Calendar's list: everyone on the event but the reader.
const people = [
  { email: 'dana@brightwave.example', display_name: 'Dana Whitfield' },
  { email: 'lee@northwind.example' },
]

describe('emailing an event’s participants', () => {
  it('on a phone, goes to Mail by its compose link at once, loading nothing of Mail first', async () => {
    const { email, router } = await openEvent(true)
    asked.length = 0

    await email(people)

    expect(router.currentRoute.value.path).toBe('/mail')
    expect(router.currentRoute.value.query).toEqual({
      compose: '1',
      to: 'dana@brightwave.example,lee@northwind.example',
    })
    expect(mail.asked).toBe(0)
    // Nor anything asked of Mail's server: no user, no identities.
    expect(asked).toEqual([])
    // The event's sheet is still open behind it, for Back.
    router.back()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/calendar/week?event=standup'),
    )
  })

  it('on a desktop, closes the event’s card before Mail’s window opens over the calendar', async () => {
    const { email, router } = await openEvent(false)

    await email(people)

    expect(mail.openedAt).toEqual(['/calendar/week'])
    expect(router.currentRoute.value.path).toBe('/calendar/week')
  })
})
