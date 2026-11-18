import { useKeyboardShortcut } from 'frappe-ui'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'

import ComposeHost from '@/apps/mail/components/ComposeHost.vue'
import { takePendingCompose } from '@/apps/mail/composables/composeHandoff'
import { useComposeLinkArrival } from '@/apps/mail/composables/composeLink'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { translate } from '@/platform/translation'

import { useMailCompose, type MailRecipient } from '.'

// Another app writing to people through Mail's public interface, the way the calendar's "Email
// participants" does: a page that has never opened Mail, against a small Frappe that knows one user
// with one mail account (or none), and an alias on it.
const server = vi.hoisted<{
  asked: string[]
  mailAccounts: boolean
  identitiesAsked: number
  identitiesAnswered: Promise<void>
}>(() => ({
  asked: [],
  mailAccounts: true,
  identitiesAsked: 0,
  identitiesAnswered: Promise.resolve(),
}))
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
    // The reader's user and own addresses: what Mail waits on before it asks for a window.
    if (method === 'get_user_info' || method === 'get_identities') {
      server.identitiesAsked++
      await server.identitiesAnswered
    }
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
    ...(await import('../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')),
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
  server.identitiesAnswered = Promise.resolve()
  isMobile.value = false
  toasts.error.mockReset()
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  takePendingCompose()
})

const PAGE = '/calendar/week/2026-11-18?event=standup'
// The event's people, one of them with no name on the event.
const PARTICIPANTS: MailRecipient[] = [
  { email: 'dana@brightwave.example', display_name: 'Dana Whitfield' },
  { email: 'lee@northwind.example' },
]
const ADDRESSES = PARTICIPANTS.map(({ email }) => email)
// What the To field's chips say: the name where there is one, else the address.
const CHIPS = ['Dana Whitfield', 'lee@northwind.example']

// Calendar's own single-key shortcuts, as it registers them: one that keeps out of dialogs, and its
// shortcuts list, which opens from inside one.
const shortcuts = vi.hoisted(() => ({ dayView: vi.fn(), showShortcuts: vi.fn() }))
// The last press's work, done once Mail has opened the composer or decided against it.
let pressed: Promise<void> | undefined

/**
 * Another app's page, open on an event, with an "Email participants" button and the app's
 * shortcuts; beside it, Mail as a phone reaches it: its layout, on the compose link, and its
 * compose page.
 */
async function openPage(
  participants: MailRecipient[] = PARTICIPANTS,
): Promise<{ router: Router; leave: () => void; app: ReturnType<typeof createApp> }> {
  const Page = defineComponent({
    setup() {
      const mail = useMailCompose()
      useKeyboardShortcut([
        { combo: 'D', description: 'Day View', handler: shortcuts.dayView },
        {
          combo: 'Shift+Slash',
          description: 'View Shortcuts',
          allowInDialog: true,
          handler: shortcuts.showShortcuts,
        },
      ])
      return () =>
        h('button', { onClick: () => (pressed = mail.compose(participants)) }, 'Email participants')
    },
  })
  const MailHome = defineComponent({
    setup() {
      useComposeLinkArrival()
      return () => h(ComposeHost)
    },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail', component: MailHome },
      {
        path: '/mail/account/:accountId/compose',
        name: 'mail-compose',
        component: { render: () => null },
      },
      { path: '/:any(.*)*', component: Page },
    ],
  })
  // Mail's guard, which answers after a wait of its own.
  router.beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 5)))
  await router.push(PAGE)
  const app = createApp({ render: () => h(RouterView) })
  app.config.globalProperties.__ = translate
  app.use(createPinia())
  app.use(router)
  app.mount(document.body.appendChild(document.createElement('div')))
  apps.push(app)
  await vi.waitFor(() => expect(button('Email participants')).not.toBeNull())
  return { router, leave: () => app.unmount(), app }
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
  // Before any load of Mail's composer has landed: a failed load is tried afresh, a landed one is
  // kept for the file.
  it('lets go of a load that fails after the page has gone', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const { leave } = await openPage()
    composerModule.failNext = true

    button('Email participants')!.click()
    leave()
    await pressed
    await new Promise((resolve) => setTimeout(resolve, 50))

    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(composerModule.failNext).toBe(false)
  })

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
    await vi.waitFor(() => expect(recipients()).toEqual(CHIPS))
    expect(router.currentRoute.value.fullPath).toBe(PAGE)
  })

  it("leaves the page's own shortcuts alone while the reader types in the composer", async () => {
    await openPage()
    button('Email participants')!.click()
    await vi.waitFor(() => expect(composer()).not.toBeNull(), { timeout: 15_000 })
    const subject = composer()!.querySelector('input[aria-label="Subject"]')!
    const body = await vi.waitFor(() => {
      const editable = composer()!.querySelector<HTMLElement>('[contenteditable="true"]')
      expect(editable).not.toBeNull()
      return editable!
    })
    // As a keyboard sends them: the key's place on it (which shortcuts go by), and what it types.
    const press = (target: Element, key: 'd' | '?') =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code: key === 'd' ? 'KeyD' : 'Slash',
          shiftKey: key === '?',
          bubbles: true,
        }),
      )
    shortcuts.dayView.mockReset()
    shortcuts.showShortcuts.mockReset()

    press(subject, 'd')
    press(body, 'd')
    press(subject, '?')

    expect(shortcuts.dayView).not.toHaveBeenCalled()
    expect(shortcuts.showShortcuts).not.toHaveBeenCalled()
    // The same keys on the page itself are its shortcuts.
    press(document.body, 'd')
    press(document.body, '?')
    expect(shortcuts.dayView).toHaveBeenCalledOnce()
    expect(shortcuts.showShortcuts).toHaveBeenCalledOnce()
  })

  it('leaves out every address that is the reader’s own in Mail', async () => {
    await openPage([
      { email: 'Maya@Example.com' },
      ...PARTICIPANTS,
      { email: 'maya.lead@example.com', display_name: 'Maya' },
    ])

    button('Email participants')!.click()

    await vi.waitFor(() => expect(composer()).not.toBeNull(), { timeout: 15_000 })
    await vi.waitFor(() => expect(recipients()).toEqual(CHIPS))
  })

  it('on a desktop, closing the composer leaves the page where it was', async () => {
    const { router } = await openPage()
    button('Email participants')!.click()
    await vi.waitFor(() => expect(composer()).not.toBeNull(), { timeout: 15_000 })

    button('Close')!.click()

    await vi.waitFor(() => expect(composer()).toBeNull())
    expect(router.currentRoute.value.fullPath).toBe(PAGE)
  })

  it("on a phone, opens Mail's compose page for them, by Mail's compose link", async () => {
    isMobile.value = true
    const { router } = await openPage()

    button('Email participants')!.click()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('mail-compose'), {
      timeout: 15_000,
    })
    expect(router.currentRoute.value.params.accountId).toBe('acc')
    expect(takePendingCompose()?.to).toEqual(ADDRESSES.map((email) => ({ email })))
    // The link is gone from the page behind it, so Back does not open the composer again.
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/mail'))
  })

  it('on a desktop, with no Mail account, hands them to the device’s mail app', async () => {
    server.mailAccounts = false
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { router } = await openPage()

    button('Email participants')!.click()

    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce(), { timeout: 15_000 })
    expect(decodeURIComponent(String(open.mock.calls[0][0]))).toBe(`mailto:${ADDRESSES.join(',')}`)
    expect(composer()).toBeNull()
    expect(router.currentRoute.value.fullPath).toBe(PAGE)
    open.mockRestore()
  })

  it('opens nothing later for a page left while Mail was still loading', async () => {
    let answer!: () => void
    const { leave } = await openPage()
    // A reader Mail has yet to load: the page goes while Mail is still asking who they are, the
    // step before it asks for a window. (Signed in again with the answers held, as the Mail
    // already loaded by earlier tests asks at once.)
    server.identitiesAnswered = new Promise((resolve) => (answer = resolve))
    signIn.as(`maya+${++signIns}@example.com`)
    const asked = server.identitiesAsked

    button('Email participants')!.click()
    await vi.waitFor(() => expect(server.identitiesAsked).toBeGreaterThan(asked), {
      timeout: 15_000,
    })
    leave()
    answer()
    // Mail has its user, and the press has done all it was going to.
    await pressed

    // Nothing is left asking for a window: the next composer host to mount, as Mail's layout
    // mounts one, opens none.
    const { app } = await openPage()
    const { mountComposeHost } = await import('./composables/mountComposeHost')
    const host = mountComposeHost(app._context)
    // A request left behind opens its window in under half a second here: given three times that.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(composer()).toBeNull()
    host.unmount()
  })
})
