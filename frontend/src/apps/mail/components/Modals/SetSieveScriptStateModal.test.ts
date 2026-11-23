import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import SetSieveScriptStateModal from './SetSieveScriptStateModal.vue'

interface Script {
  _name: string
  id: string
  active: number
}

// The scripts on the mail server, of which one runs at a time
const state = vi.hoisted<{ save: Mock; scripts: Script[] }>(() => ({ save: vi.fn(), scripts: [] }))

interface Answer {
  label: string
  onClick: () => void
}
vi.mock('frappe-ui', () => ({
  toast: { create: vi.fn() },
  // An open dialog asks its question and offers its answers
  Dialog: defineComponent(
    (props: { open?: boolean; title?: string; message?: string; actions?: Answer[] }) => () => {
      if (!props.open) {
        return null
      }

      return h('div', { role: 'dialog' }, [
        h('h2', props.title),
        h('p', props.message),
        props.actions?.map((action) => h('button', { onClick: action.onClick }, action.label)),
      ])
    },
    { props: ['open', 'title', 'message', 'actions'] },
  ),
}))
vi.mock('@/api', async () => {
  const { fakeMutation } = await import('@/platform/testing/mutations')
  return {
    api: { mail: { sieve: { update: {} } } },
    useMutation: (_reference: unknown, options?: { silent?: boolean }) =>
      fakeMutation(state.save, vi.fn(), options),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    sieveScripts: {
      get data() {
        return state.scripts
      },
    },
  }),
}))
vi.mock('@/apps/mail/utils', async (original) => ({
  ...(await original<typeof import('@/apps/mail/utils')>()),
  raiseToast: vi.fn(),
}))

/** The words as they are shown, with what they name filled in. */
function shown(message: string, named: unknown[] = []) {
  return message.replace(/\{(\d+)\}/g, (_, index) => String(named[Number(index)]))
}

const FOLDER_AUTOMATION = { _name: 'frappe_mail_automation', id: 'f' }
const NEWSLETTERS = { _name: 'Newsletters', id: 'n' }
const AUTO_REPLY = { _name: 'vacation', id: 'v' }

let app: ReturnType<typeof createApp>
/** Asks about `script`, with `running` the one script that is on. */
function ask(script: Script, running?: Script, action?: () => void) {
  state.scripts = [script, running].filter((each) => each !== undefined)
  const root = document.createElement('div')
  app = createApp({
    setup: () => () => h(SetSieveScriptStateModal, { modelValue: true, script, action }),
  })
  app.mount(root)
  const question = requireTestElement(root.querySelector('[role="dialog"]'), HTMLElement)
  const [confirm] = Array.from(question.querySelectorAll('button'))

  return {
    title: question.querySelector('h2')?.textContent,
    message: question.querySelector('p')?.textContent,
    confirm,
  }
}

beforeEach(() => {
  window.__ = shown
  state.save.mockReset().mockResolvedValue(undefined)
})
afterEach(() => app.unmount())

it.each([
  [{ ...FOLDER_AUTOMATION, active: 1 }, 'This turns off folder automation.'],
  [{ ...AUTO_REPLY, active: 1 }, 'This turns off auto-reply.'],
  [{ _name: 'Receipts', id: 'r', active: 1 }, 'This turns off your rule “Receipts”.'],
])('says what turning on a rule turns off: %o', async (running, turnsOff) => {
  const { title, message, confirm } = ask({ ...NEWSLETTERS, active: 0 }, running)
  expect(title).toBe('Turn on “Newsletters”?')
  expect(message).toContain(turnsOff)
  expect(confirm.textContent).toBe('Turn on rule')

  confirm.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'n', active: true }))
})
it('asks about folder automation by its name, and names the rule it takes over from', () => {
  const { title, message, confirm } = ask(
    { ...FOLDER_AUTOMATION, active: 0 },
    { ...NEWSLETTERS, active: 1 },
  )
  expect(title).toBe('Turn on folder automation?')
  expect(message).toContain('This turns off your rule “Newsletters”.')
  expect(confirm.textContent).toBe('Turn on folder automation')
})
it('says nothing turns off when no other script is on', () => {
  const { message } = ask({ ...NEWSLETTERS, active: 0 })
  expect(message).not.toContain('turns off')
})
it('asks to turn off the rule that is on, and turns off that one', async () => {
  const { title, message, confirm } = ask({ ...NEWSLETTERS, active: 1 })
  expect(title).toBe('Turn off “Newsletters”?')
  expect(message).not.toContain('turns off')
  expect(confirm.textContent).toBe('Turn off rule')

  confirm.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'n', active: false }))
})
it('does what its opener asks in place of its own save, when handed that', () => {
  const action = vi.fn()
  ask({ ...FOLDER_AUTOMATION, active: 0 }, undefined, action).confirm.click()
  expect(action).toHaveBeenCalledOnce()
  expect(state.save).not.toHaveBeenCalled()
})
