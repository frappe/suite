import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { translate } from '@/platform/translation'

import SendMail from './SendMail.vue'

// The desktop composer window, mounted whole — window, editor, toolbar, recipient fields — against a
// small Frappe that answers each call as the test tells it to.
const server = vi.hoisted<{
  asked: string[]
  answer: (method: string) => Promise<Response> | Response
}>(() => ({ asked: [], answer: () => new Response('{}') }))
vi.hoisted(() => {
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = url.pathname.split('.').at(-1) ?? ''
    server.asked.push(method)
    return server.answer(method)
  }
})
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// The real frappe-ui pieces the composer is built from (tests otherwise get the recorder's
// stand-ins). Its dialogs stay shut, so they render nothing; its toasts are recorded.
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  const shut = defineComponent({ setup: () => () => null })
  return {
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Avatar')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Button')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Combobox')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Dropdown')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Popover')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Tooltip')),
    ...(await import('../../../../../node_modules/frappe-ui/src/composables/usePortalTarget')),
    ...(await import('../../../../../node_modules/frappe-ui/src/utils/useFileUpload')),
    Dialog: shut,
    ErrorMessage: shut,
    FormControl: shut,
    toast: { ...toasts, dismiss: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})
// The contact picker and Send later open over the composer, and neither is under test.
const { none } = vi.hoisted(() => ({ none: () => ({ default: { render: () => null } }) }))
vi.mock('@/apps/mail/components/Modals/ContactsModal.vue', none)
vi.mock('@/apps/mail/components/Modals/ScheduleSendModal.vue', none)
// Drive's own file picker, which opens over the composer in a dialog of its own: the test picks for
// the user.
const pickFiles = vi.hoisted(() => vi.fn())
vi.mock('@/apps/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/drive')>()),
  useDriveDialogs: () => ({ pickFiles }),
}))
// The suite router, which the mail composables import; the composer gets its own.
vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { computed } = await import('vue')
  const scope = () => ({
    accountId: computed(() => 'acc'),
    account: computed(() => ({ default_outgoing_email: 'maya@example.com' })),
    identities: computed(() => ({ data: [{ email: 'maya@example.com', _name: 'Maya' }] })),
    mailboxIds: computed(() => ({ sent: 'e' })),
  })
  return { injectAccountScope: scope, provideAccountScope: scope }
})

// jsdom lays nothing out; the suggestion list scrolls its highlighted row into view.
Element.prototype.scrollIntoView = () => {}

const apps: ReturnType<typeof createApp>[] = []
beforeEach(() => {
  server.asked = []
  toasts.error.mockReset()
  toasts.success.mockReset()
  pickFiles.mockReset()
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

/** The composer window open on a saved draft to Dana. */
async function openComposer() {
  const show = ref(true)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/mail')
  const app = createApp({
    render: () =>
      h(SendMail, {
        modelValue: show.value,
        'onUpdate:modelValue': (open: boolean) => (show.value = open),
        mailDetails: {
          id: 'draft-1',
          to: [{ email: 'dana@brightwave.example' }],
          subject: 'Brief',
          html_body: '<p>See the brief.</p>',
          attachments: [],
        },
      }),
  })
  app.config.globalProperties.__ = translate
  app.provide('$user', { data: { name: 'maya@example.com', undo_send_period: 10 } })
  app.use(router)
  app.mount(document.body.appendChild(document.createElement('div')))
  apps.push(app)
  await vi.waitFor(() => expect(button('Close')).not.toBeNull())
}

const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  ) ?? null
const type = async (field: HTMLInputElement, text: string) => {
  field.focus()
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('typing a recipient', () => {
  const toField = () => document.querySelector<HTMLInputElement>('[data-recipient-input] input')!
  // A chip's name, without its avatar's initials.
  const chips = () =>
    [...document.querySelectorAll('[data-recipient-input] button .truncate')].map((name) =>
      name.textContent?.trim(),
    )
  const pressEnter = async (field: HTMLInputElement) => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }

  it('keeps an address that is not one, and adds no recipient for it', async () => {
    server.answer = () => reply({ message: [] })
    await openComposer()

    await type(toField(), 'jordan@northwind')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Not a valid email address'))
    await pressEnter(toField())

    expect(toField().value).toBe('jordan@northwind')
    expect(chips()).toEqual(['dana@brightwave.example'])
  })

  it('adds a full address as a recipient', async () => {
    server.answer = () => reply({ message: [] })
    await openComposer()

    await type(toField(), 'jordan@northwind.example')
    await vi.waitFor(() => expect(document.body.textContent).toContain('jordan@northwind.example'))
    await pressEnter(toField())

    await vi.waitFor(() =>
      expect(chips()).toEqual(['dana@brightwave.example', 'jordan@northwind.example']),
    )
  })
})

describe('the Attach menu', () => {
  const menuItem = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === label,
    )
  const chooseFromAttach = async (item: string) => {
    button('Attach')!.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }),
    )
    await vi.waitFor(() => expect(menuItem(item)).toBeDefined())
    menuItem(item)!.click()
    await nextTick()
  }
  // The browser shows its file chooser when a file input is clicked: each one clicked, in order.
  const watchFileChooser = () => {
    const clicked: HTMLInputElement[] = []
    const record = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'file')
        clicked.push(event.target)
    }
    document.addEventListener('click', record, true)
    onTestFinished(() => document.removeEventListener('click', record, true))
    return clicked
  }

  it('opens the device file chooser from Upload from computer', async () => {
    server.answer = () => reply({ message: [] })
    await openComposer()
    const chooserOpened = watchFileChooser()

    await chooseFromAttach('Upload from computer')

    expect(chooserOpened).toHaveLength(1)
    expect(pickFiles).not.toHaveBeenCalled()
  })

  it('attaches the files picked in Drive from Attach from Drive', async () => {
    server.answer = (method) =>
      method === 'attach_drive_files'
        ? reply({
            message: [
              {
                name: 'file-1',
                file_name: 'Invoice.pdf',
                file_url: '/private/files/Invoice.pdf',
                file_size: 2048,
              },
            ],
          })
        : reply({ message: [] })
    pickFiles.mockResolvedValueOnce([{ name: 'node-invoice', title: 'Invoice.pdf' }])
    await openComposer()
    const chooserOpened = watchFileChooser()

    await chooseFromAttach('Attach from Drive')

    expect(pickFiles).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(document.body.textContent).toContain('Invoice.pdf'))
    expect(server.asked).toContain('attach_drive_files')
    expect(chooserOpened).toHaveLength(0)
  })
})

// Going while a save is out, with the composer still open: Mail's own window when the reader leaves
// Mail, and a thread's reply when they move to another thread. Both stay as quiet as they always
// were: the save that was out lands, and nothing more is saved or said. (Only the window over
// another app's page closes as it goes; see useMailCompose.test.ts.)
describe('leaving with the composer open while a save is out', () => {
  const saved = () =>
    reply({
      message: {
        name: 'draft-1',
        id: 'draft-1',
        status: 'Drafted',
        error: null,
        thread_id: null,
        submission_id: null,
        send_at: null,
        undo_send_period: null,
      },
    })
  const refused = () => reply({ exc_type: 'ValidationError', _server_messages: '[]' }, 417)
  const saves = () => server.asked.filter((method) => method === 'update_draft_mail')

  /** Mail's own window, or a reply in a thread, open on a saved draft to Dana. */
  async function openOwn(where: 'window' | 'thread') {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
    })
    await router.push('/mail')
    const mailDetails = {
      id: 'draft-1',
      to: [{ email: 'dana@brightwave.example' }],
      subject: 'Brief',
      html_body: '<p>See the brief.</p>',
      attachments: [],
    }
    const ComposeMailEditor = (await import('./ComposeMailEditor.vue')).default
    const app = createApp({
      render: () =>
        where === 'window'
          ? h(SendMail, { modelValue: true, mailDetails })
          : h(ComposeMailEditor, {
              modelValue: true,
              isInThread: true,
              reloadMails: () => {},
              mailDetails,
            }),
    })
    app.config.globalProperties.__ = translate
    app.provide('$user', { data: { name: 'maya@example.com', undo_send_period: 10 } })
    app.use(router)
    app.mount(document.body.appendChild(document.createElement('div')))
    apps.push(app)
    const subject = await vi.waitFor(() => {
      const field = [...document.querySelectorAll('input')].find((input) => input.value === 'Brief')
      expect(field).toBeDefined()
      return field!
    })
    return { subject, leave: () => app.unmount() }
  }

  it.each([
    ['Mail’s own window', 'saved', 'window', saved],
    ['Mail’s own window', 'refused', 'window', refused],
    ['a thread’s reply', 'saved', 'thread', saved],
    ['a thread’s reply', 'refused', 'thread', refused],
  ] as const)('%s, its save %s, saves nothing more', async (_, _outcome, where, answer) => {
    const { subject, leave } = await openOwn(where)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    server.answer = async (method) => {
      if (method !== 'update_draft_mail') return reply({ message: [] })
      await held
      return answer()
    }
    await type(subject, 'Brief, v2')
    // The autosave goes out, and the server takes its time.
    await vi.waitFor(() => expect(saves()).toHaveLength(1), { timeout: 5_000 })
    await type(subject, 'Brief, v3')

    leave()
    release()
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(saves()).toHaveLength(1)
    // Neither the Close's "Draft saved" nor its "Draft not saved" with Reopen.
    const said = [...toasts.success.mock.calls, ...toasts.error.mock.calls].map(
      ([message]) => message,
    )
    expect(said).not.toContain('Draft saved')
    expect(said).not.toContain('Draft not saved')
  })
})
