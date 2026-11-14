import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { translate } from '@/platform/translation'

import MimeMessageView from './MimeMessageView.vue'

const { SOURCE } = vi.hoisted(() => ({
  SOURCE: [
    'From: Jordan Lee <jordan@northwind.test>',
    'To: sam@example.test',
    'Subject: Quarterly numbers',
    '',
    'See the attached sheet.',
  ].join('\r\n'),
}))

// A small Frappe: one message whose source it hands out, one it has not, one that never answers.
vi.hoisted(() => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (!url.pathname.endsWith('.get_mime_message'))
      return reply({ exc_type: 'PageDoesNotExistError' }, 404)
    const body: unknown = JSON.parse(String(init?.body ?? '{}'))
    const name = body && typeof body === 'object' && 'name' in body ? body.name : undefined
    if (name === 'slow') return new Promise<Response>(() => {})
    if (name !== 'acc|m1')
      return reply(
        {
          exc_type: 'DoesNotExistError',
          _server_messages: JSON.stringify([
            JSON.stringify({ message: `Mail Message ${name} not found` }),
          ]),
        },
        404,
      )
    const field = (label: string, value: string) => ({ label, value })
    return reply({
      message: {
        message: SOURCE,
        message_id: field('Message ID', '<m1@northwind.test>'),
        created_at: field('Created at', 'Mon, Nov 2, 2026 at 9:30 AM'),
        subject: field('Subject', 'Quarterly numbers'),
        from: field('From', 'Jordan Lee <jordan@northwind.test>'),
        to: field('To', 'sam@example.test'),
        cc: field('CC', ''),
        bcc: field('BCC', ''),
      },
    })
  }
})

vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    props: ['label'],
    emits: ['click'],
    template: '<button @click="$emit(\'click\')">{{ label }}</button>',
  }),
  Tooltip: defineComponent({ template: '<span><slot /></span>' }),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/platform/feedback', () => ({ reportMutationError: vi.fn() }))

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function open(id: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail', name: 'mail-root-shortcut', component: { render: () => null } },
      { path: '/mail/mime-message/:id', name: 'mail-mime-message', component: MimeMessageView },
    ],
  })
  await router.push(`/mail/mime-message/${encodeURIComponent(id)}`)
  const errors: unknown[] = []
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(RouterView) })
  app.config.globalProperties.__ = translate
  app.config.errorHandler = (error) => errors.push(error)
  app.use(createPinia())
  app.use(router)
  apps.push(app)
  app.mount(element)
  return { element, errors }
}

const button = (element: HTMLElement, label: string) =>
  Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)

describe('MIME message page', () => {
  it('shows the message source, and Copy puts it on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const { element, errors } = await open('acc|m1')

    await vi.waitFor(() => expect(element.querySelector('pre')?.textContent).toBe(SOURCE))
    expect(element.textContent).toContain('Quarterly numbers')
    button(element, 'Copy to clipboard')!.click()
    expect(writeText).toHaveBeenCalledWith(SOURCE)
    expect(errors).toEqual([])
  })

  it('says why when the message cannot be had', async () => {
    const { element, errors } = await open('not-a-name')

    await vi.waitFor(() =>
      expect(element.textContent).toContain('Mail Message not-a-name not found'),
    )
    expect(errors).toEqual([])
  })

  it('shows that it is loading until the message arrives', async () => {
    const { element } = await open('slow')
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve))
      await nextTick()
    }

    expect(element.querySelector('[role="status"]')).not.toBeNull()
    expect(element.querySelector('pre')).toBeNull()
  })
})
