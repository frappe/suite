import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'

import { openComposePage } from '@/apps/mail/composables/composeHandoff'
import { translate } from '@/platform/translation'

import ComposeView from './ComposeView.vue'

// The phone's full-page composer, mounted whole as its own route at phone width, against a small
// Frappe that answers each call as the test tells it to, and records each draft save it is sent.
interface Save {
  method: string
  body: Record<string, unknown>
  keepalive: boolean
}
const SAVES = ['create_mail', 'update_draft_mail']
const server = vi.hoisted<{
  asked: string[]
  saves: Save[]
  answer: (method: string) => Promise<Response> | Response
}>(() => ({ asked: [], saves: [], answer: () => new Response('{}') }))
vi.hoisted(() => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = url.pathname.split('.').at(-1) ?? ''
    server.asked.push(method)
    if (method === 'create_mail' || method === 'update_draft_mail')
      server.saves.push({
        method,
        body: JSON.parse(String(init?.body ?? '{}')),
        keepalive: !!init?.keepalive,
      })
    return server.answer(method)
  }
})
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
// A save, answered as the draft the server keeps: one, under one id.
const savedDraft = () =>
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
const answerSaves = (method: string) =>
  SAVES.includes(method) ? savedDraft() : reply({ message: [] })

// The real frappe-ui pieces the page is built from (tests otherwise get the recorder's stand-ins).
// Its dialogs stay shut, so they render nothing; its bottom sheet is the real one, since that is
// what a phone's menus open as.
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
    ...(await import('../../../../../node_modules/frappe-ui/src/components/BottomSheet')),
    Dialog: shut,
    ErrorMessage: shut,
    FormControl: shut,
    toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})
// A phone: the page is only ever reached at that width, and its menus open as bottom sheets there.
// Set before anything loads, since the app reads the width once, at load.
vi.hoisted(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
})
const { none } = vi.hoisted(() => ({ none: () => ({ default: { render: () => null } }) }))
vi.mock('@/apps/mail/components/Modals/ScheduleSendModal.vue', none)
// Drive's own file picker, which opens over the page in a dialog of its own: the test picks for the
// user.
const pickFiles = vi.hoisted(() => vi.fn())
vi.mock('@/apps/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/drive')>()),
  useDriveDialogs: () => ({ pickFiles }),
}))
// The upload to the server, which the browser makes outside fetch: it answers with the File
// document it would have stored.
const upload = vi.hoisted(() => vi.fn())
vi.mock('@/apps/mail/utils/text-editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/mail/utils/text-editor')>()),
  uploadFunction: upload,
}))
// The suite router, which the mail composables import; the page gets its own.
vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { computed } = await import('vue')
  const scope = () => ({
    accountId: computed(() => 'acc'),
    account: computed(() => ({ default_outgoing_email: 'maya@example.com' })),
    identities: computed(() => ({ data: [{ email: 'maya@example.com', _name: 'Maya' }] })),
    mailboxes: computed(() => ({ data: [] })),
    mailboxIds: computed(() => ({ sent: 'e' })),
  })
  return { injectAccountScope: scope, provideAccountScope: scope }
})

Element.prototype.scrollIntoView = () => {}

const apps: ReturnType<typeof createApp>[] = []
beforeEach(() => {
  server.asked = []
  server.saves = []
  server.answer = answerSaves
  pickFiles.mockReset()
  upload.mockReset()
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

/** The compose page, open on a new mail, from Mail. */
async function openFromMail() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail', component: { render: () => null } },
      { path: '/mail/compose', component: ComposeView },
    ],
  })
  await router.push('/mail')
  await router.push('/mail/compose')
  const app = createApp({ render: () => h(RouterView) })
  app.config.globalProperties.__ = translate
  app.provide('$user', { data: { name: 'maya@example.com', undo_send_period: 10 } })
  app.use(router)
  app.mount(document.body.appendChild(document.createElement('div')))
  apps.push(app)
  await vi.waitFor(() => expect(button('Attach')).not.toBeNull())
}

const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  ) ?? null
// The open bottom sheet's rows, by what they read.
const sheetRows = () =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].map((row) =>
    row.textContent?.trim(),
  )
const sheetRow = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find(
    (row) => row.textContent?.trim() === label,
  )
const openSheet = async (trigger: string) => {
  button(trigger)!.click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
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

describe("the compose page's paperclip", () => {
  it('offers a file from the device and one from Drive, and nothing else', async () => {
    await openFromMail()

    await openSheet('Attach')

    expect(sheetRows()).toEqual(['Upload from computer', 'Attach from Drive'])
  })

  it('attaches the file chosen on the device from Upload from computer', async () => {
    upload.mockResolvedValueOnce({
      name: 'file-2',
      file_name: 'Report.pdf',
      file_url: '/private/files/Report.pdf',
      file_size: 1024,
    })
    await openFromMail()
    const chooserOpened = watchFileChooser()

    await openSheet('Attach')
    sheetRow('Upload from computer')!.click()
    await nextTick()

    expect(chooserOpened).toHaveLength(1)
    expect(pickFiles).not.toHaveBeenCalled()

    // The person picks a file in the chooser.
    const chooser = chooserOpened[0]
    const report = new File(['%PDF'], 'Report.pdf', { type: 'application/pdf' })
    Object.defineProperty(chooser, 'files', { value: [report], configurable: true })
    chooser.dispatchEvent(new Event('change'))

    await vi.waitFor(() => expect(document.body.textContent).toContain('Report.pdf'))
    expect(upload).toHaveBeenCalledWith(report)
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
    await openFromMail()
    const chooserOpened = watchFileChooser()

    await openSheet('Attach')
    sheetRow('Attach from Drive')!.click()

    await vi.waitFor(() => expect(document.body.textContent).toContain('Invoice.pdf'))
    expect(pickFiles).toHaveBeenCalledOnce()
    expect(server.asked).toContain('attach_drive_files')
    expect(chooserOpened).toHaveLength(0)
  })
})

describe("the compose page's More actions", () => {
  it('leaves Drive to the paperclip', async () => {
    await openFromMail()

    await openSheet('More actions')

    expect(sheetRows()).toContain('Schedule send')
    expect(sheetRows()).not.toContain('Attach from Drive')
  })
})

/** The compose page, opened for the event's people as the first page of its document. */
async function openFirstPage(): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/mail/account/:accountId/compose', component: ComposeView }],
  })
  // The first navigation of the router: no page of this document before it.
  await openComposePage(router, 'acc', { to: [{ email: 'dana@brightwave.example' }] })
  const app = createApp({ render: () => h(RouterView) })
  app.config.globalProperties.__ = translate
  app.provide('$user', { data: { name: 'maya@example.com', undo_send_period: 10 } })
  app.use(router)
  app.mount(document.body.appendChild(document.createElement('div')))
  apps.push(app)
  await vi.waitFor(() => expect(subject()).not.toBeNull())
  return router
}

const subject = () =>
  [...document.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('Subject'))
    ?.querySelector('input') ?? null
const typeSubject = async (text: string) => {
  const field = subject()!
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('leaving the compose page for the page before its document', () => {
  it('keeps what was typed when Close goes back', async () => {
    const router = await openFirstPage()
    const back = vi.spyOn(router, 'back')
    await typeSubject('Planning, Thursday')

    button('Close')!.click()

    await vi.waitFor(() => expect(back).toHaveBeenCalledOnce())
    // Saved before going: going back leaves the document, which waits for nothing.
    expect(server.saves).toHaveLength(1)
    expect(server.saves[0]).toMatchObject({
      method: 'create_mail',
      body: { subject: 'Planning, Thursday', to: [{ email: 'dana@brightwave.example' }] },
    })
  })

  it('keeps what was typed when the page is hidden by the Back gesture', async () => {
    await openFirstPage()
    await typeSubject('Planning, Thursday')

    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => expect(server.saves).toHaveLength(1))
    expect(server.saves[0]).toMatchObject({
      method: 'create_mail',
      body: { subject: 'Planning, Thursday' },
      keepalive: true,
    })
  })

  it('sends nothing for a page left as it opened', async () => {
    const router = await openFirstPage()
    const back = vi.spyOn(router, 'back')

    window.dispatchEvent(new Event('pagehide'))
    button('Close')!.click()

    await vi.waitFor(() => expect(back).toHaveBeenCalledOnce())
    expect(server.saves).toEqual([])
  })
})
