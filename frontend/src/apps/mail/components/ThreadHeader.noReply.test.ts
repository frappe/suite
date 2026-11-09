import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  type App,
  type Component,
  type PropType,
} from 'vue'

import ThreadHeader from '@/apps/mail/components/ThreadHeader.vue'
import type { Mail } from '@/apps/mail/types'
import { UNIFIED_THREAD_ROUTE } from '@/apps/mail/utils/unifiedFolders'

const BOXES = { inbox: 'in', archive: 'ar', sent: 'se', snoozed: 'sn', drafts: 'dr', trash: 'tr' }

const screen = vi.hoisted(() => ({
  mobile: false,
  route: { name: '', params: { mailbox: '', folder: '', threadID: 't' }, query: {} },
}))

type Row = {
  label: string
  icon?: Component
  onClick?: () => void
}
type Entry = Row | { group: string; options: Row[] }

// The menu as a list of its rows, so a test clicks what a reader would.
vi.mock('@/platform/feedback', async (original) => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    ...(await original<typeof import('@/platform/feedback')>()),
    Dropdown: define({
      props: {
        // SAFETY: every caller here passes the Dropdown options these entries describe.
        options: { type: Array as PropType<Entry[]>, default: () => [] },
        open: Boolean,
      },
      emits: ['update:open'],
      setup(props, { slots, emit }) {
        const menuRow = (row: Row) =>
          render(
            'button',
            {
              role: 'menuitem',
              onClick: () => {
                emit('update:open', false)
                row.onClick?.()
              },
            },
            [row.icon ? render(row.icon) : null, row.label],
          )
        return () =>
          render('div', [
            render('span', { onClick: () => emit('update:open', true) }, slots.default?.()),
            props.open
              ? render(
                  'div',
                  { role: 'menu' },
                  props.options.flatMap((entry) =>
                    'options' in entry
                      ? [render('h2', entry.group), ...entry.options.map(menuRow)]
                      : [menuRow(entry)],
                  ),
                )
              : null,
          ])
      },
    }),
  }
})
vi.mock('@/apps/mail/components/CustomTimeForm.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    default: define({
      props: { action: { type: String, default: '' }, pastMessage: { type: String, default: '' } },
      emits: ['pick'],
      setup:
        (props, { emit }) =>
        () =>
          render('form', { 'data-past': props.pastMessage }, [
            render('button', { type: 'button', onClick: () => emit('pick', 'OWN') }, props.action),
          ]),
    }),
  }
})
vi.mock('frappe-ui', async (original) => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    ...(await original<typeof import('frappe-ui')>()),
    toast: {},
    Divider: () => null,
    BottomSheet: () => null,
    Button: define({
      props: { tooltip: { type: String, default: '' } },
      setup:
        (props, { slots }) =>
        () =>
          render('button', { 'data-tooltip': props.tooltip }, slots.icon?.()),
    }),
    Dialog: define({
      props: { open: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          props.open ? slots.default?.() : null,
    }),
  }
})
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRoute: () => screen.route,
}))
vi.mock('@/apps/mail/stores/user', () => ({ takesPins: () => false }))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { ref: reference } = await import('vue')
  return {
    injectAccountScope: () => ({
      mailboxes: reference({ data: [{ id: 'se', slug: 'sent', name: 'Sent', role: 'sent' }] }),
      mailboxIds: reference(BOXES),
    }),
  }
})
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref: reference } = await import('vue')
  return { useScreenSize: () => ({ isMobile: reference(screen.mobile) }) }
})

const mail = (id: string, boxes: string[]) =>
  fromPartial<Mail>({ id, draft: 0, mailboxes: boxes.map((mailbox_id) => ({ mailbox_id })) })

let app: App | undefined
let root: HTMLElement
const onSnooze = vi.fn()
const onRemind = vi.fn()

beforeEach(() => {
  window.__ = (text: string) => text
  screen.mobile = false
  viewing('in')
  root = document.createElement('div')
  document.body.append(root)
  onSnooze.mockClear()
  onRemind.mockClear()
})
afterEach(() => {
  app?.unmount()
  root.remove()
})

const viewing = (mailbox: string) => {
  screen.route.name = 'mail-thread'
  screen.route.params.mailbox = mailbox
}

const show = async (thread: Mail[], remindable: boolean) => {
  app = createApp(
    defineComponent({
      setup: () => () =>
        h(ThreadHeader, { thread, threads: ['t'], remindable, onSnooze, onRemind }),
    }),
  )
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  await nextTick()
}

const clock = () => root.querySelector<SVGElement>('svg.lucide-clock')
const bell = () => root.querySelector<SVGElement>('svg.lucide-bell-plus')
const unsnooze = () => root.querySelector<SVGElement>('svg.lucide-alarm-clock-off')
const openMenu = async (icon = clock()) => {
  icon!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
const rows = () => [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
const row = (label: string) => rows().find((item) => item.textContent?.trim() === label)
const clickRow = async (label: string) => {
  row(label)!.click()
  await nextTick()
}
const heading = () => root.querySelector('[role="menu"] h2')?.textContent

const YOUR_LAST_WORD = [mail('a', ['in']), mail('b', ['se'])]
const THEIR_LAST_WORD = [mail('a', ['se']), mail('b', ['in'])]
const ONLY_IN_SENT = [mail('a', ['se'])]

describe('the clock', () => {
  it.each([
    ['yours', YOUR_LAST_WORD, true],
    ['theirs', THEIR_LAST_WORD, false],
  ])('only ever snoozes where the last word is %s', async (_, thread, remindable) => {
    await show(thread, remindable)
    await openMenu()
    expect(heading()).toBe('Snooze until')

    await clickRow('Tomorrow')
    expect(onSnooze).toHaveBeenCalledTimes(1)
    expect(onRemind).not.toHaveBeenCalled()
  })

  it("snoozes for a time of the reader's own too", async () => {
    await show(YOUR_LAST_WORD, true)
    await openMenu()
    await clickRow('Pick a date and time…')
    expect(root.querySelector('form')?.dataset.past).toBe('Choose a time in the future.')
    const settle = root.querySelector<HTMLButtonElement>('form button')!
    expect(settle.textContent).toBe('Snooze')

    settle.click()
    await nextTick()
    expect(onSnooze).toHaveBeenCalledWith('OWN')
    expect(onRemind).not.toHaveBeenCalled()
  })

  it('changes the time in Snoozed, where Unsnooze stands beside it', async () => {
    await show([mail('a', ['in']), mail('b', ['se', 'sn'])], true)
    expect(unsnooze()).not.toBeNull()
    await openMenu()
    expect(heading()).toBe('Change snooze time')
  })

  it('leaves nothing where it can be neither snoozed nor brought back', async () => {
    await show(ONLY_IN_SENT, true)
    expect(clock()).toBeNull()
    expect(bell()).toBeNull()
  })

  it('offers a phone nothing there either', async () => {
    screen.mobile = true
    await show(ONLY_IN_SENT, true)
    expect(root.querySelector('[aria-label="More"]')).toBeNull()
  })
})

describe('viewing Sent', () => {
  beforeEach(() => viewing('se'))

  it('the bell asks for a reminder and nothing else', async () => {
    await show(ONLY_IN_SENT, true)
    expect(clock()).toBeNull()
    const button = bell()?.closest('button')
    expect(button?.dataset.tooltip).toBe('Remind me if no reply')
    expect(button?.getAttribute('aria-label')).toBe('Remind me if no reply')

    await openMenu(bell())
    expect(heading()).toBe('Remind me if no reply')
    expect(rows().at(-1)?.textContent).toBe('Pick a date and time…')

    await clickRow('Tomorrow')
    expect(onRemind).toHaveBeenCalledTimes(1)
    expect(onSnooze).not.toHaveBeenCalled()
  })

  it.each([
    ['the Inbox', [mail('a', ['in']), mail('b', ['se'])]],
    ['Archive', [mail('a', ['ar']), mail('b', ['se'])]],
    ['Snoozed', [mail('a', ['sn']), mail('b', ['se'])]],
  ])('still only the bell for a conversation also in %s', async (_, thread) => {
    await show(thread, true)
    expect(bell()).not.toBeNull()
    expect(clock()).toBeNull()
    expect(unsnooze()).toBeNull()
  })

  it('in the combined Sent too', async () => {
    screen.route.name = UNIFIED_THREAD_ROUTE
    screen.route.params.folder = 'sent'
    await show(YOUR_LAST_WORD, true)
    expect(bell()).not.toBeNull()
    expect(clock()).toBeNull()
  })

  it('on a phone, More offers the same reminder under the bell', async () => {
    screen.mobile = true
    await show(ONLY_IN_SENT, true)
    root.querySelector<HTMLElement>('[aria-label="More"]')!.click()
    await nextTick()
    const item = row('Remind me if no reply')
    expect(item?.querySelector('svg.lucide-bell-plus')).not.toBeNull()

    item!.click()
    await nextTick()
    await clickRow('Tomorrow')
    expect(onRemind).toHaveBeenCalledTimes(1)
    expect(onSnooze).not.toHaveBeenCalled()
  })

  it('leaves nothing once there is no reminder to ask for', async () => {
    await show(YOUR_LAST_WORD, false)
    expect(clock()).toBeNull()
    expect(bell()).toBeNull()
    expect(unsnooze()).toBeNull()
  })
})
