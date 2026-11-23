import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { useThreadReload } from '@/apps/mail/composables/useThreadReload'
import { translate } from '@/platform/translation'

import ComposeView from './ComposeView.vue'

// The phone's full-page composer, mounted whole as its own route at phone width, against a small
// Frappe that answers each call as the test tells it to.
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

// The real frappe-ui pieces the page is built from (tests otherwise get the recorder's stand-ins).
// Its dialogs stay shut, so they render nothing; its bottom sheet is the real one, since that is
// what a phone's menus open as. Its toasts are recorded.
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
    ...(await import('../../../../../node_modules/frappe-ui/src/components/BottomSheet')),
    Dialog: shut,
    ErrorMessage: shut,
    FormControl: shut,
    toast: { ...toasts, dismiss: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})
// The draft the navigation to the page carries (see composeHandoff): none, unless a test says.
const handoff = vi.hoisted<{ draft?: object }>(() => ({}))
vi.mock('@/apps/mail/composables/composeHandoff', () => ({
  takePendingCompose: () => handoff.draft,
}))
// A phone: the page is only ever reached at that width, and its menus open as bottom sheets there.
// Set before anything loads, since the app reads the width once, at load.
vi.hoisted(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
})
// The time picker for a scheduled send, open on one choice the test taps for the user.
vi.mock('@/apps/mail/components/Modals/ScheduleSendModal.vue', async () => {
  const { defineComponent, h: render } = await import('vue')
  return {
    default: defineComponent({
      props: { modelValue: Boolean, save: Function },
      setup: (props) => () =>
        props.modelValue
          ? render('button', { onClick: () => props.save?.('2026-12-01T09:00:00Z') }, 'Monday 9 AM')
          : null,
    }),
  }
})
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
// The sending identity's signature: none, unless a test has it arrive, as it does once the
// identities load after the page has opened.
const identity = vi.hoisted<{ arrive?: (signature?: string) => void }>(() => ({}))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { computed, ref } = await import('vue')
  const signature = ref<string>()
  identity.arrive = (html) => (signature.value = html)
  const scope = () => ({
    accountId: computed(() => 'acc'),
    account: computed(() => ({ default_outgoing_email: 'maya@example.com' })),
    identities: computed(() => ({
      data: [{ email: 'maya@example.com', _name: 'Maya', html_signature: signature.value }],
    })),
    mailboxIds: computed(() => ({ sent: 'e' })),
  })
  return { injectAccountScope: scope, provideAccountScope: scope }
})

// jsdom lays nothing out; the editor scrolls to its caret.
Element.prototype.scrollIntoView = () => {}
Range.prototype.getClientRects = () => fromPartial<DOMRectList>({ length: 0, item: () => null })
Range.prototype.getBoundingClientRect = () => new DOMRect()

const apps: ReturnType<typeof createApp>[] = []
beforeEach(() => {
  server.asked = []
  server.answer = () => reply({ message: [] })
  pickFiles.mockReset()
  upload.mockReset()
  toasts.error.mockReset()
  toasts.success.mockReset()
  handoff.draft = undefined
  identity.arrive?.(undefined)
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

/** The compose page, open on a new mail, reached from `from` (the folder, unless a test says). */
async function openComposePage(from = '/mail') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail', component: { render: () => null } },
      {
        path: '/mail/account/:accountId/mailbox/:mailbox/:threadID',
        component: { render: () => null },
      },
      { path: '/mail/compose', component: ComposeView },
    ],
  })
  await router.push(from)
  // The page it came from, as a browser's history records it (memory history records nothing).
  await router.push({ path: '/mail/compose', state: { back: from } })
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
    await openComposePage()

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
    await openComposePage()
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
    await openComposePage()
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
    await openComposePage()

    await openSheet('More actions')

    expect(sheetRows()).toContain('Schedule send')
    expect(sheetRows()).not.toContain('Attach from Drive')
  })
})

describe('leaving the compose page', () => {
  // A new mail, with the signature arrived in its body.
  const openSigned = async () => {
    await openComposePage()
    identity.arrive!('<p>Maya, Northwind</p>')
    await vi.waitFor(() =>
      expect(document.querySelector('.ProseMirror')?.textContent).toContain('Maya, Northwind'),
    )
  }
  const close = async () => {
    button('Close')!.click()
    await vi.waitFor(() => expect(button('Close')).toBeNull())
    await new Promise((resolve) => setTimeout(resolve))
  }

  it('leaves nothing in Drafts when nothing was written', async () => {
    await openSigned()

    await close()

    expect(server.asked).not.toContain('create_mail')
  })

  it('keeps what was written as a draft', async () => {
    await openSigned()
    const subject = document.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!
    subject.value = 'Brief'
    subject.dispatchEvent(new Event('input'))

    await close()

    await vi.waitFor(() => expect(server.asked).toContain('create_mail'))
  })
})

describe("the compose page's island", () => {
  it('swaps its tools for the formatting, and back', async () => {
    await openComposePage()
    const shown = () => ({ attach: !!button('Attach'), bold: !!button('Bold') })
    expect(shown()).toEqual({ attach: true, bold: false })

    button('Formatting')!.click()
    await nextTick()
    expect(shown()).toEqual({ attach: false, bold: true })

    button('Formatting')!.click()
    await nextTick()
    expect(shown()).toEqual({ attach: true, bold: false })
  })
})

describe('scheduling from the compose page', () => {
  it('sends at the time picked from Schedule send', async () => {
    handoff.draft = {
      id: 'draft-1',
      to: [{ email: 'dana@brightwave.example' }],
      subject: 'Brief',
      html_body: '<p>Looks good.</p>',
      attachments: [],
    }
    server.answer = (method) =>
      method === 'update_draft_mail'
        ? reply({
            message: {
              name: 'draft-1',
              id: 'draft-1',
              status: 'Submitted',
              error: null,
              thread_id: null,
              submission_id: 'submission-1',
              send_at: '2026-12-01T09:00:00Z',
              undo_send_period: null,
            },
          })
        : reply({ message: [] })
    await openComposePage()

    await openSheet('More actions')
    sheetRow('Schedule send')!.click()
    await vi.waitFor(() => expect(button('Monday 9 AM')).not.toBeNull())
    button('Monday 9 AM')!.click()

    await vi.waitFor(() =>
      expect(toasts.success.mock.calls.map(([message]) => message)).toContain('Send scheduled'),
    )
  })
})

describe('sending from the compose page', () => {
  // jsdom does not keep the focus or the taps out of an inert element; a phone's browser does.
  it('locks the page from Send until the answer, and gives it back on a refusal', async () => {
    let answer!: (response: Response) => void
    const held = new Promise<Response>((resolve) => (answer = resolve))
    server.answer = (method) => (method === 'update_draft_mail' ? held : reply({ message: [] }))
    // A reply to Dana, saved as a draft: it opens with the caret in its body.
    handoff.draft = {
      id: 'draft-1',
      to: [{ email: 'dana@brightwave.example' }],
      subject: 'Re: Brief',
      html_body: '<p>Looks good.</p>',
      in_reply_to: '<brief@brightwave.example>',
      attachments: [],
    }
    await openComposePage()
    const body = document.querySelector<HTMLElement>('.ProseMirror')!
    await vi.waitFor(() => expect(document.activeElement).toBe(body))

    button('Send')!.click()
    await vi.waitFor(() => expect(server.asked).toContain('update_draft_mail'))
    expect(body.closest('[inert]')).not.toBeNull()
    // The locked page gives up the focus (a browser does this for `inert`; jsdom does not).
    body.blur()

    answer(
      reply({
        message: {
          name: 'draft-1',
          id: 'draft-1',
          status: 'Drafted',
          error: 'Dana’s server refused the address',
          thread_id: null,
          submission_id: null,
          send_at: null,
          undo_send_period: null,
        },
      }),
    )

    await vi.waitFor(() => expect(body.closest('[inert]')).toBeNull())
    expect(toasts.error).toHaveBeenCalledWith('Mail not sent', {
      description: 'Dana’s server refused the address',
    })
    await vi.waitFor(() => expect(document.activeElement).toBe(body))
  })

  // A reply written on the compose page, opened from its thread: Send answers that it went, held
  // for the undo window.
  const sendReply = async (from: string) => {
    handoff.draft = {
      id: 'draft-1',
      to: [{ email: 'dana@brightwave.example' }],
      subject: 'Re: Brief',
      html_body: '<p>Looks good.</p>',
      in_reply_to: '<brief@brightwave.example>',
      attachments: [],
    }
    server.answer = (method) =>
      method === 'update_draft_mail'
        ? reply({
            message: {
              name: 'draft-1',
              id: 'draft-1',
              status: 'Submitted',
              error: null,
              thread_id: 'brief',
              submission_id: 'submission-1',
              send_at: '2026-11-19T10:00:10Z',
              undo_send_period: 10,
            },
          })
        : method === 'cancel_scheduled_mail'
          ? reply({ message: { id: 'draft-1' } })
          : reply({ message: [] })
    await openComposePage(from)
    button('Send')!.click()
    await vi.waitFor(() => expect(sentToast()).toBeDefined())
  }
  const sentToast = () => toasts.success.mock.calls.find(([message]) => message === 'Message sent')

  it('offers no View for the thread the page goes back to', async () => {
    await sendReply('/mail/account/acc/mailbox/inbox/brief')

    expect(sentToast()![1].action.label).toBe('Undo')
    expect(sentToast()![1].cancel).toBeUndefined()
  })

  it('offers View when the page goes back to somewhere else', async () => {
    await sendReply('/mail/account/acc/mailbox/inbox/other-thread')

    expect(sentToast()![1].cancel.label).toBe('View')
  })

  it('has the thread it goes back to rebuilt once sent, and again once the send is undone', async () => {
    const { threadReloadRequest } = useThreadReload()
    await sendReply('/mail/account/acc/mailbox/inbox/brief')
    // Sent: the thread drops the draft's card for the reply when it is back on screen.
    expect(threadReloadRequest.value?.threadId).toBe('brief')
    threadReloadRequest.value = undefined

    sentToast()![1].action.onClick()

    await vi.waitFor(() => expect(threadReloadRequest.value?.threadId).toBe('brief'))
    expect(toasts.success).toHaveBeenCalledWith(
      'Message unsent. It is back in your drafts.',
      undefined,
    )
  })
})
