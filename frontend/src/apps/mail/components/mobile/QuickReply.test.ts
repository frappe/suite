import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { ComposeMailData } from '@/apps/mail/types'
import { translate } from '@/platform/translation'

import QuickReply from './QuickReply.vue'

// The quick reply a phone writes in a thread, mounted on its own against a small Frappe that answers
// each call as the test tells it to.
const server = vi.hoisted<{
  asked: string[]
  answer: (method: string, body: string) => Response | Promise<Response>
}>(() => ({ asked: [], answer: () => new Response('{}') }))
vi.hoisted(() => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = url.pathname.split('.').at(-1) ?? ''
    server.asked.push(method)
    return server.answer(method, typeof init?.body === 'string' ? init.body : '')
  }
})
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const shut = defineComponent({ setup: () => () => null })
  return {
    ...(await import('../../../../../../node_modules/frappe-ui/src/components/Avatar')),
    ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
    ...(await import('../../../../../../node_modules/frappe-ui/src/components/Popover')),
    ...(await import('../../../../../../node_modules/frappe-ui/src/components/Tooltip')),
    ...(await import('../../../../../../node_modules/frappe-ui/src/composables/usePortalTarget')),
    ...(await import('../../../../../../node_modules/frappe-ui/src/utils/useFileUpload')),
    // The forward's To field, as far as a test needs it: what is typed goes up as the field's text.
    Combobox: defineComponent({
      emits: ['update:modelValue'],
      setup:
        (_props, { emit }) =>
        () =>
          h('input', {
            onInput: (event: Event) =>
              event.target instanceof HTMLInputElement &&
              emit('update:modelValue', event.target.value),
          }),
    }),
    Dialog: shut,
    ErrorMessage: shut,
    FormControl: shut,
    toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})
vi.hoisted(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
})
vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { computed } = await import('vue')
  const scope = () => ({
    accountId: computed(() => 'acc'),
    account: computed(() => ({ default_outgoing_email: 'maya@example.com' })),
    identities: computed(() => ({
      data: [{ email: 'maya@example.com', _name: 'Maya' }],
    })),
    mailboxIds: computed(() => ({ sent: 'e' })),
  })
  return { injectAccountScope: scope, provideAccountScope: scope }
})

// jsdom lays nothing out; the editor scrolls to its caret.
Element.prototype.scrollIntoView = () => {}
Range.prototype.getClientRects = () => fromPartial<DOMRectList>({ length: 0, item: () => null })
Range.prototype.getBoundingClientRect = () => new DOMRect()

const danasMail: ComposeMailData = {
  name: 'draft:mail-1',
  type: 'reply',
  from_email: 'maya@example.com',
  to: [{ email: 'dana@brightwave.example', display_name: 'Dana Lee' }],
  subject: 'Re: Launch',
  in_reply_to: '<launch@brightwave.example>',
  in_reply_to_id: 'mail-1',
}

// What the server answers a saved draft with.
const savedDraft = {
  name: 'draft-9',
  id: 'draft-9',
  status: 'Drafted',
  error: null,
  thread_id: null,
  submission_id: null,
  send_at: null,
  undo_send_period: null,
}

const apps: ReturnType<typeof createApp>[] = []
beforeEach(() => {
  server.asked = []
  server.answer = () => reply({ message: [] })
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

/** The quick reply, open on a reply to Dana. What it hands back, as it hands it. */
async function openQuickReply(mailDetails: ComposeMailData = danasMail) {
  const expanded: ComposeMailData[] = []
  const startsAt: (string | undefined)[] = []
  const handed = { closed: 0, reloaded: 0, expanded, startsAt }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/mail', component: { render: () => null } }],
  })
  await router.push('/mail')
  const app = createApp({
    render: () =>
      h(QuickReply, {
        mailDetails: structuredClone(mailDetails),
        reloadMails: () => handed.reloaded++,
        showSent: async () => {},
        onClose: () => handed.closed++,
        onExpand: (mail: ComposeMailData, startAt?: string) => {
          handed.expanded.push(mail)
          handed.startsAt.push(startAt)
        },
      }),
  })
  app.config.globalProperties.__ = translate
  app.provide('$user', { data: { name: 'maya@example.com', undo_send_period: 10 } })
  app.use(router)
  app.mount(document.body.appendChild(document.createElement('div')))
  apps.push(app)
  await vi.waitFor(() => expect(document.querySelector('.ProseMirror, input')).not.toBeNull())
  return Object.assign(handed, { app })
}
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name)
type Commands = { insertContent: (text: string) => void; undo: () => void }
const commands = () => {
  // SAFETY: tiptap hangs its editor on the element it mounts, and the test has just found it.
  const { editor } = document.querySelector('.ProseMirror') as HTMLElement & {
    editor: { commands: Commands }
  }
  return editor.commands
}
const write = (text: string) => commands().insertContent(text)
// What was written taken out again, leaving the body as it opened.
const clear = () => commands().undo()

describe('the quick reply', () => {
  it('folds away when put down with nothing written, leaving no draft', async () => {
    const handed = await openQuickReply()

    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))

    await vi.waitFor(() => expect(handed.closed).toBe(1))
    expect(server.asked).not.toContain('create_mail')
  })

  it('stays open when put down with something written', async () => {
    const handed = await openQuickReply()
    write('On my way')

    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    await new Promise((resolve) => setTimeout(resolve))

    expect(handed.closed).toBe(0)
  })

  it('folds away when what was written is cleared before it is put down, taking its draft along', async () => {
    // Saved once its answer is read and the tick after it has passed: by then the reply holds the
    // draft's id. A reply an earlier test left behind saves too, so this one is told by its text.
    const saved = { yes: false }
    server.answer = (method, body) => {
      if (method !== 'create_mail' || !body.includes('Running late')) return reply({ message: [] })
      const answer = reply({ message: savedDraft })
      for (const read of ['json', 'text'] as const) {
        const original = answer[read].bind(answer)
        Object.defineProperty(answer, read, {
          value: async () => {
            const body = await original()
            setTimeout(() => (saved.yes = true))
            return body
          },
        })
      }
      return answer
    }
    const handed = await openQuickReply()
    write('Running late')
    await vi.waitFor(() => expect(saved.yes).toBe(true), { timeout: 4000 })

    clear()
    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))

    await vi.waitFor(() => expect(handed.closed).toBe(1))
    await vi.waitFor(() => expect(server.asked).toContain('delete_mail'))
  })

  it('saves what was written when its thread is left, and then has the thread reload to show it', async () => {
    server.answer = (method) =>
      method === 'create_mail' ? reply({ message: savedDraft }) : reply({ message: [] })
    const handed = await openQuickReply()
    write('On my way')

    handed.app.unmount()

    await vi.waitFor(() => expect(handed.reloaded).toBe(1))
    expect(server.asked).toContain('create_mail')
  })

  it('has the thread reload once a save still under way when its thread is left has landed', async () => {
    let land = () => {}
    const landed = new Promise<void>((resolve) => (land = resolve))
    server.answer = (method) =>
      method === 'create_mail'
        ? landed.then(() => reply({ message: savedDraft }))
        : reply({ message: [] })
    const handed = await openQuickReply()
    write('On my way')
    await vi.waitFor(() => expect(server.asked).toContain('create_mail'), { timeout: 4000 })

    handed.app.unmount()
    land()

    await vi.waitFor(() => expect(handed.reloaded).toBe(1))
  })

  it('keeps no draft of a forward, neither as it is addressed nor when it is left', async () => {
    const { app } = await openQuickReply({
      name: 'draft:mail-1',
      type: 'forward',
      from_email: 'maya@example.com',
      to: [],
      subject: 'Fwd: Launch',
      forwarded_from_id: 'mail-1',
    })
    const to = document.querySelector('input')!
    to.value = 'priya@brightwave.example'
    to.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('priya@brightwave.example'))

    // Past the two seconds an edit waits before it saves.
    await new Promise((resolve) => setTimeout(resolve, 2500))
    app.unmount()
    await new Promise((resolve) => setTimeout(resolve))

    expect(server.asked).not.toContain('create_mail')
  })

  it('leaves the caret in place when one of its buttons is pressed, so the keyboard stays up under the tap', async () => {
    await openQuickReply()
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })

    button('Discard')!.dispatchEvent(press)

    expect(press.defaultPrevented).toBe(true)
  })

  it('hands the reply to the full page as the draft it saved, with what was written', async () => {
    server.answer = (method) =>
      method === 'create_mail' ? reply({ message: savedDraft }) : reply({ message: [] })
    const handed = await openQuickReply()
    write('On my way')

    button('Expand')!.click()

    await vi.waitFor(() => expect(handed.expanded).toHaveLength(1))
    expect(handed.expanded[0].id).toBe('draft-9')
    expect(handed.expanded[0].html_body).toContain('On my way')
    expect(handed.expanded[0].to).toEqual(danasMail.to)
  })

  it('sends a tap on who it goes to on to the full page, to start in To there', async () => {
    const handed = await openQuickReply()

    button('Change recipients')!.click()

    await vi.waitFor(() => expect(handed.startsAt).toEqual(['to']))
  })
})
