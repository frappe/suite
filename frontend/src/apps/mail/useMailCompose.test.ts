import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { takePendingCompose } from '@/apps/mail/composables/composeHandoff'
import { useComposeMail, useScreenSize } from '@/apps/mail/utils/composables'
import { translate } from '@/platform/translation'

import { useMailCompose } from '.'

// Another app writing to people through Mail's public interface, the way the calendar's "Email
// participants" does: a page that has never opened Mail, against a small Frappe that knows one user
// with one mail account (or none), and an alias on it.
const server = vi.hoisted<{
  asked: string[]
  mailAccounts: boolean
  userAnswered: Promise<void>
}>(() => ({ asked: [], mailAccounts: true, userAnswered: Promise.resolve() }))
vi.hoisted(() => {
  const account = {
    account: 'acc',
    id: 'acc',
    _name: 'maya@example.com',
    is_personal: true,
    in_mail: true,
    in_calendar: true,
    jmap_account: 'acc',
    default_outgoing_email: 'maya@example.com',
    enable_screening: false,
    block_remote_images: false,
    on_block_old_mail: 'Keep',
  }
  const user = {
    name: 'maya@example.com',
    email: 'maya@example.com',
    full_name: 'Maya',
    first_name: 'Maya',
    last_name: null,
    enabled: 1,
    user_image: null,
    user_type: 'System User',
    username: null,
    api_key: null,
    time_zone: 'UTC',
    system_time_zone: 'UTC',
    group_by_date: 0,
    show_reading_pane: 0,
    undo_send_period: '10',
    user_settings: '{}',
    is_suite_admin: false,
    is_system_manager: false,
    is_jmap_configured: true,
    max_attachment_size: 25_000_000,
    inbox_tabs: [],
    split_inbox: 0,
    email_classification: false,
    is_suite_cloud_configured: false,
    accounts: [account],
  }
  const alias = {
    name: 'id-1',
    account: 'acc',
    id: 'id-1',
    _name: 'Maya',
    email: 'maya.lead@example.com',
    bcc: [],
    reply_to: [],
    html_signature: '',
    text_signature: '',
    may_delete: 1,
    owner: 'maya@example.com',
    modified_by: 'maya@example.com',
    creation: '2026-01-01 00:00:00',
    modified: '2026-01-01 00:00:00',
  }
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = url.pathname.split('.').at(-1) ?? ''
    server.asked.push(method)
    if (method === 'get_user_info') await server.userAnswered
    const message =
      method === 'get_user_info'
        ? { ...user, accounts: server.mailAccounts ? [account] : [] }
        : method === 'get_identities'
          ? [alias]
          : []
    return new Response(JSON.stringify({ message }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// Each test signs in afresh (see beforeEach), which starts the server-state cache over.
const signIn = vi.hoisted(() => ({ as: (_id: string) => {} }))
vi.mock('@/platform/session', async (original) => {
  const { ref } = await import('vue')
  const session = {
    status: ref('authenticated'),
    user: ref({ id: 'maya@example.com', fullName: 'Maya', avatar: null }),
    capabilities: ref({}),
    onLogout: () => () => {},
  }
  signIn.as = (id) => (session.user.value = { id, fullName: 'Maya', avatar: null })
  return { ...(await original<object>()), useSession: () => session }
})

// Whether Mail's composer has been evaluated — what a page that imported it eagerly would have
// done — and a way to make the next load fail, as a dropped connection or a deploy since the page
// loaded would.
const composerModule = vi.hoisted(() => ({ evaluated: 0, failNext: false }))
vi.mock('./composables/mountComposeHost', async (original) => {
  if (composerModule.failNext) {
    composerModule.failNext = false
    throw new TypeError('Failed to fetch dynamically imported module')
  }
  composerModule.evaluated++
  return original()
})

// The real frappe-ui pieces the composer is built from (tests otherwise get the recorder's
// stand-ins). Its dialogs stay shut, so they render nothing.
const toasts = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  const shut = defineComponent({ setup: () => () => null })
  return {
    ...(await import('../../../../node_modules/frappe-ui/src/components/Avatar')),
    ...(await import('../../../../node_modules/frappe-ui/src/components/Button')),
    ...(await import('../../../../node_modules/frappe-ui/src/components/Combobox')),
    ...(await import('../../../../node_modules/frappe-ui/src/components/Dropdown')),
    ...(await import('../../../../node_modules/frappe-ui/src/components/Popover')),
    ...(await import('../../../../node_modules/frappe-ui/src/components/Tooltip')),
    ...(await import('../../../../node_modules/frappe-ui/src/composables/usePortalTarget')),
    ...(await import('../../../../node_modules/frappe-ui/src/utils/useFileUpload')),
    Dialog: shut,
    ErrorMessage: shut,
    FormControl: shut,
    LoadingIndicator: shut,
    toast: { ...toasts, success: vi.fn(), dismiss: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})
const { none } = vi.hoisted(() => ({ none: () => ({ default: { render: () => null } }) }))
vi.mock('@/apps/mail/components/Modals/ContactsModal.vue', none)
vi.mock('@/apps/mail/components/Modals/ScheduleSendModal.vue', none)
// The suite router, which Mail's store imports; the page gets its own.
vi.mock('@/apps/mail/router', () => ({ default: {} }))

Element.prototype.scrollIntoView = () => {}

const { isMobile } = useScreenSize()
const apps: ReturnType<typeof createApp>[] = []
let signIns = 0
beforeEach(() => {
  signIn.as(`maya+${++signIns}@example.com`)
  server.asked = []
  server.mailAccounts = true
  server.userAnswered = Promise.resolve()
  isMobile.value = false
  toasts.error.mockReset()
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  takePendingCompose()
})

const PAGE = '/calendar/week/2026-11-18?event=standup'
const PARTICIPANTS = ['dana@brightwave.example', 'lee@northwind.example']

/** Another app's page, open on an event, with an "Email participants" button. */
async function openPage(
  participants = PARTICIPANTS,
): Promise<{ router: Router; leave: () => void }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push(PAGE)
  const Page = defineComponent({
    setup() {
      const mail = useMailCompose()
      return () =>
        h('button', { onClick: () => void mail.compose(participants) }, 'Email participants')
    },
  })
  const app = createApp(Page)
  app.config.globalProperties.__ = translate
  app.use(createPinia())
  app.use(router)
  app.mount(document.body.appendChild(document.createElement('div')))
  apps.push(app)
  return { router, leave: () => app.unmount() }
}

const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  ) ?? null
const composer = () => document.querySelector('[role="dialog"][aria-label="New message"]')
// The To field's chips, by name, without their avatars' initials.
const recipients = () =>
  [...(composer()?.querySelectorAll('[data-recipient-input] button .truncate') ?? [])].map((name) =>
    name.textContent?.trim(),
  )

// The first press loads Mail's composer, which takes a while under the test transform.
describe('writing to people from another app', { timeout: 30_000 }, () => {
  // One test, in order: the composer is evaluated once per test file, and these are the first
  // loads of it.
  it('loads Mail on the press, not before, and tries again after a load that failed', async () => {
    await openPage()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(composerModule.evaluated).toBe(0)
    expect(server.asked).toEqual([])

    composerModule.failNext = true
    button('Email participants')!.click()
    await vi.waitFor(() => expect(toasts.error).toHaveBeenCalledOnce())
    expect(composer()).toBeNull()

    button('Email participants')!.click()
    await vi.waitFor(() => expect(composer()).not.toBeNull(), { timeout: 15_000 })
    expect(composerModule.evaluated).toBe(1)
  })

  it("on a desktop, opens Mail's composer over the page, addressed to them, and stays put", async () => {
    const { router } = await openPage()

    button('Email participants')!.click()

    await vi.waitFor(() => expect(composer()).not.toBeNull(), { timeout: 15_000 })
    await vi.waitFor(() => expect(recipients()).toEqual(PARTICIPANTS))
    expect(router.currentRoute.value.fullPath).toBe(PAGE)
  })

  it('leaves out every address that is the reader’s own in Mail', async () => {
    await openPage(['Maya@Example.com', ...PARTICIPANTS, 'maya.lead@example.com'])

    button('Email participants')!.click()

    await vi.waitFor(() => expect(composer()).not.toBeNull(), { timeout: 15_000 })
    await vi.waitFor(() => expect(recipients()).toEqual(PARTICIPANTS))
  })

  it('on a desktop, closing the composer leaves the page where it was', async () => {
    const { router } = await openPage()
    button('Email participants')!.click()
    await vi.waitFor(() => expect(composer()).not.toBeNull(), { timeout: 15_000 })

    button('Close')!.click()

    await vi.waitFor(() => expect(composer()).toBeNull())
    expect(router.currentRoute.value.fullPath).toBe(PAGE)
  })

  it("on a phone, opens Mail's compose page for the account, carrying them, and Back returns", async () => {
    isMobile.value = true
    const { router } = await openPage()

    button('Email participants')!.click()

    await vi.waitFor(
      () => expect(router.currentRoute.value.path).toBe('/mail/account/acc/compose'),
      { timeout: 15_000 },
    )
    expect(composer()).toBeNull()
    expect(takePendingCompose()?.to?.map((r) => r.email)).toEqual(PARTICIPANTS)

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(PAGE))
  })

  it.each([false, true])(
    'with no Mail account, hands them to the device’s mail app (phone: %s)',
    async (phone) => {
      isMobile.value = phone
      server.mailAccounts = false
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)
      const { router } = await openPage()

      button('Email participants')!.click()

      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce(), { timeout: 15_000 })
      expect(decodeURIComponent(String(open.mock.calls[0][0]))).toBe(
        `mailto:${PARTICIPANTS.join(',')}`,
      )
      expect(composer()).toBeNull()
      expect(router.currentRoute.value.fullPath).toBe(PAGE)
      open.mockRestore()
    },
  )

  it('opens nothing later for a page left while Mail was still loading', async () => {
    let answer!: () => void
    server.userAnswered = new Promise((resolve) => (answer = resolve))
    const { leave } = await openPage()

    button('Email participants')!.click()
    await vi.waitFor(() => expect(server.asked).toContain('get_user_info'), { timeout: 15_000 })
    leave()
    answer()
    // Mail has its user, and has looked up the reader's own addresses: the last step before asking.
    await vi.waitFor(() => expect(server.asked).toContain('get_identities'), { timeout: 15_000 })
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Nothing is left asking for a window, which Mail would open the next time it is.
    expect(useComposeMail().composeRequest.value).toBeUndefined()
  })
})
