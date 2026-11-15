import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { useDocumentComments, type DocumentSession, type DocumentThread } from '@/apps/drive'
import { translationPlugin } from '@/platform/translation'

import { cellCommentAnchors } from './commentPlaces'
import { cellAnchor } from './records'
import SheetComments from './SheetComments.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

// Plain stand-ins: a Button is a <button>, and a Textarea a <textarea> that takes the focus
vi.mock('frappe-ui', async (importOriginal) => {
  const vue = await import('vue')
  const Button = vue.defineComponent({
    inheritAttrs: false,
    props: ['label', 'loading', 'disabled', 'type'],
    setup:
      (props, { attrs, slots }) =>
      () =>
        vue.h(
          'button',
          { ...attrs, type: props.type ?? 'button', disabled: props.disabled || props.loading },
          props.label ?? slots.default?.(),
        ),
  })
  const Textarea = vue.defineComponent({
    inheritAttrs: false,
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(props, { attrs, emit, expose }) {
      const box = vue.ref<HTMLTextAreaElement | null>(null)
      expose({
        focus: () => box.value?.focus(),
        get inputElement() {
          return box.value
        },
      })
      return () =>
        vue.h('textarea', {
          ...attrs,
          ref: box,
          value: props.modelValue,
          onInput: () => emit('update:modelValue', box.value?.value),
        })
    },
  })
  const Empty = vue.defineComponent({ render: () => null })
  return {
    ...(await importOriginal<typeof import('frappe-ui')>()),
    Button,
    Textarea,
    TextInput: Empty,
    Avatar: Empty,
    Dropdown: Empty,
    toast: { error: () => {} },
  }
})

// A signed-in writer, unless a test makes them a guest
const signedIn = await vi.hoisted(async () => (await import('vue')).ref(true))
vi.mock('@/platform/session', async (importOriginal) => {
  const { computed } = await import('vue')
  const real = await importOriginal<typeof import('@/platform/session')>()
  const asha = { id: 'asha@x.com', fullName: 'Asha Rao', avatar: null }
  const user = computed(() => (signedIn.value ? asha : null))
  return {
    ...real,
    useSession: () => ({ ...real.useSession(), user }),
    isAuthenticated: computed(() => signedIn.value),
  }
})

// Who can't open the spreadsheet, and who of them are blocked from it, as Drive's people lookup says
interface People {
  locked: string[]
  blocked: string[]
  /** What the `@` menu asked the people route. */
  searches: object[]
}
const people = vi.hoisted((): People => ({ locked: [], blocked: [], searches: [] }))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  client: { query: async (_route: unknown, input: PeopleQuery) => askPeople(input) },
}))
interface PeopleQuery {
  users?: string[]
  q?: string
}
function askPeople({ users, ...search }: PeopleQuery) {
  if (users) {
    return users.map((user) => ({
      kind: 'user',
      name: user,
      email: user,
      full_name: NAMES.get(user),
      user_image: null,
      has_access: !people.locked.includes(user),
      is_blocked: people.blocked.includes(user),
    }))
  }

  people.searches.push(search)
  const arjun = {
    kind: 'user',
    name: 'arjun@x.com',
    email: 'arjun@x.com',
    full_name: 'Arjun Mehta',
    user_image: null,
    has_access: false,
  }
  const rows = [arjun].filter((person) => person.full_name.toLowerCase().includes(search.q ?? ''))
  return { rows }
}

const NAMES = new Map([
  ['arjun@x.com', 'Arjun Mehta'],
  ['ben@x.com', 'Ben Roy'],
])

// What the writer was told and asked; `isYes` is their reply to a question
interface Told {
  successes: string[]
  warnings: string[]
  infos: string[]
  asked: string[]
  isYes: boolean
}
const told = vi.hoisted((): Told => ({
  successes: [],
  warnings: [],
  infos: [],
  asked: [],
  isYes: true,
}))
vi.mock('@/platform/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/feedback')>()),
  confirm: async ({ title }: { title: string }) => {
    told.asked.push(title)
    return told.isYes
  },
  toast: {
    success: (message: string) => told.successes.push(message),
    warning: (message: string) => told.warnings.push(message),
    info: (message: string) => told.infos.push(message),
    error: () => {},
  },
}))

// jsdom has no layout; the boxes scroll themselves into view
Element.prototype.scrollIntoView = () => {}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  localStorage.clear()
  sessionStorage.clear()
  people.locked = []
  people.blocked = []
  people.searches = []
  signedIn.value = true
  Object.assign(told, { successes: [], warnings: [], infos: [], asked: [], isYes: true })
})

async function settle() {
  for (let i = 0; i < 4; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function thread(name: string, anchor: string, content: string): DocumentThread {
  return {
    name,
    node: 'node-1',
    anchor,
    resolved: false,
    resolved_by: null,
    resolved_at: null,
    creation: '2026-11-15 10:00:00',
    comments: [
      {
        name: `${name}-c1`,
        thread: name,
        node: 'node-1',
        content,
        author: 'ben@x.com',
        author_name: null,
        mentions: [],
        creation: '2026-11-15 10:00:00',
        modified: null,
      },
    ],
  }
}

/** Drive as the spreadsheet's comments see it, holding `threads`. */
function driveHolding(threads: DocumentThread[], canShare: boolean) {
  // As Drive: a resend under the same client id answers with the first post; no id, no check
  const posted = new Map<string, string>()
  const create = vi.fn(async (anchor: string, text: string, _name?: string, clientId?: string) => {
    const earlier = clientId && posted.get(clientId)
    if (earlier) {
      return { name: earlier }
    }

    const number = threads.length + 1
    const made = thread(`t${number}`, anchor, text)
    threads.push(made)
    if (clientId) {
      posted.set(clientId, made.name)
    }

    return { name: made.name }
  })
  const reply = vi.fn(async () => {})
  const resolve = vi.fn(async (name: string, isResolved: boolean) => {
    const found = threads.find((one) => one.name === name)!
    found.resolved = isResolved
  })
  const session = fromPartial<DocumentSession>({
    nodeId: 'node-1',
    canShare: ref(canShare),
    comments: { list: async () => ({ threads: structuredClone(threads) }), create, reply, resolve },
  })
  return { session, create, reply, resolve }
}

/**
 * The spreadsheet's comment panel over Drive holding `threads`. `goToCell` stands in for the
 * editor: it finds only cells on the sheets listed.
 */
interface MountOptions {
  threads?: DocumentThread[]
  canShare?: boolean
  /** The anchor a draft is already started on, as the editor's Comment does. */
  startOn?: string | null
}
async function mountComments({
  threads = [],
  canShare = false,
  startOn = null,
}: MountOptions = {}) {
  const drive = driveHolding(threads, canShare)
  const sheets = ['Sheet1', 'Sheet2']
  const goToCell = vi.fn((sheet: string) => sheets.includes(sheet))
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(
    defineComponent({
      setup() {
        const comments = useDocumentComments(drive.session, {
          isShown: () => true,
          isOpen: () => true,
          anchors: cellCommentAnchors,
        })
        if (startOn) {
          comments.drafts.start(startOn)
        }

        return () =>
          h(SheetComments, {
            session: drive.session,
            comments,
            sheets,
            canComment: true,
            canEditDocument: true,
            goToCell,
          })
      },
    }),
  )
  app.use(translationPlugin)
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }

  await settle()
  return { root, goToCell, ...drive }
}

function type(root: HTMLElement, label: string, text: string) {
  const box = root.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!
  box.value = text
  box.dispatchEvent(new Event('input'))
}

async function submit(root: HTMLElement, label: string) {
  await nextTick()
  root
    .querySelector(`textarea[aria-label="${label}"]`)!
    .closest('form')!
    .dispatchEvent(new Event('submit', { cancelable: true }))
  await settle()
}

function rowLabels(root: HTMLElement) {
  return [...root.querySelectorAll('li[data-thread]')].map((row) =>
    row.querySelector('.border-l-2')?.textContent?.trim(),
  )
}

function rowButton(root: HTMLElement, text: string) {
  return [...root.querySelectorAll<HTMLElement>('li[data-thread] > button')].find((button) =>
    button.textContent?.includes(text),
  )!
}

const CELL_BOX = 'Add a comment on the cell'
const WHOLE_BOX = 'Add a comment'

describe('commenting on a cell', () => {
  it('puts the cursor in a box for the cell, and posts on that cell', async () => {
    const { root, create } = await mountComments({
      startOn: cellAnchor({ sheet: 'Sheet1', cell: 'B2' }),
    })
    const box = root.querySelector(`textarea[aria-label="${CELL_BOX}"]`)
    expect(document.activeElement).toBe(box)
    expect(box!.closest('form')!.textContent).toContain('Sheet1 · B2')

    type(root, CELL_BOX, 'Check this total')
    await submit(root, CELL_BOX)

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0].slice(0, 2)).toEqual(['sheets:cell:B2!Sheet1', 'Check this total'])
    expect(rowLabels(root)).toEqual(['Sheet1 · B2'])
  })

  it('makes one thread when Comment is pressed twice', async () => {
    const { root, create } = await mountComments({
      startOn: cellAnchor({ sheet: 'Sheet1', cell: 'B2' }),
    })
    type(root, CELL_BOX, 'Check this total')
    await nextTick()
    const form = root.querySelector(`textarea[aria-label="${CELL_BOX}"]`)!.closest('form')!
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle()

    expect(rowLabels(root)).toEqual(['Sheet1 · B2'])
    const clientIds = new Set(create.mock.calls.map((call) => call[3]))
    expect(clientIds.size).toBe(1)
    expect([...clientIds][0]).toMatch(/\S/)
  })

  it('retries a failed post under the same client id', async () => {
    const { root, create } = await mountComments({
      startOn: cellAnchor({ sheet: 'Sheet1', cell: 'B2' }),
    })
    create.mockRejectedValueOnce(new Error('offline'))
    type(root, CELL_BOX, 'Check this total')
    await submit(root, CELL_BOX)
    ;[...root.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Retry')!
      .click()
    await settle()

    expect(create).toHaveBeenCalledTimes(2)
    const [first, second] = create.mock.calls.map((call) => call[3])
    expect(first).toMatch(/\S/)
    expect(second).toBe(first)
    expect(rowLabels(root)).toEqual(['Sheet1 · B2'])
  })

  it('posts on the whole spreadsheet from Add a comment', async () => {
    const { root, create } = await mountComments()
    expect(root.textContent).toContain(
      'No open comments. Select a cell and press Comment, or add one above.',
    )
    ;[...root.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === WHOLE_BOX)!
      .click()
    await nextTick()
    type(root, WHOLE_BOX, 'Looks good overall')
    await submit(root, WHOLE_BOX)

    expect(create.mock.calls[0].slice(0, 2)).toEqual(['document', 'Looks good overall'])
  })
})

describe('the thread list', () => {
  it('shows each thread’s cell, in sheet, then row, then column order', async () => {
    const { root } = await mountComments({
      threads: [
        thread('t1', 'sheets:cell:A1!Sheet2', 'On the second sheet'),
        thread('t2', 'sheets:cell:B10!Sheet1', 'Lower down'),
        thread('t3', 'sheets:cell:C2!Sheet1', 'Further right'),
        thread('t4', 'sheets:cell:A2!Sheet1', 'Further left'),
        thread('t5', 'sheets:workbook', 'About all of it'),
      ],
    })

    expect(rowLabels(root)).toEqual([
      undefined,
      'Sheet1 · A2',
      'Sheet1 · C2',
      'Sheet1 · B10',
      'Sheet2 · A1',
    ])
  })

  it('goes to a thread’s cell when the thread opens, for migrated anchors too', async () => {
    const { root, goToCell } = await mountComments({
      threads: [
        thread('t1', 'sheets:cell:C4!Sheet2', 'Check this'),
        thread('t2', '["Sheet1","B2"]', 'From before the move'),
      ],
    })

    rowButton(root, 'Check this').click()
    await settle()
    rowButton(root, 'From before the move').click()
    await settle()

    expect(goToCell.mock.calls).toEqual([
      ['Sheet2', 'C4'],
      ['Sheet1', 'B2'],
    ])
    expect(told.infos).toEqual([])
  })

  it('says so when a thread’s cell is no longer in the spreadsheet', async () => {
    const { root } = await mountComments({
      threads: [thread('t1', 'sheets:cell:C4!Gone', 'Check this')],
    })

    rowButton(root, 'Check this').click()
    await settle()

    expect(told.infos).toEqual(['Gone · C4 is no longer in this spreadsheet'])
  })

  it('resolves a thread, and replies to one', async () => {
    const { root, resolve, reply } = await mountComments({
      threads: [thread('t1', 'sheets:cell:C4!Sheet1', 'Check this')],
    })

    rowButton(root, 'Check this').click()
    await settle()
    type(root, 'Reply', 'Done')
    await submit(root, 'Reply')
    expect(reply.mock.calls[0].slice(0, 2)).toEqual(['t1', 'Done'])

    root.querySelector<HTMLElement>('button[aria-label="Resolve"]')!.click()
    await settle()
    expect(resolve).toHaveBeenCalledWith('t1', true)
  })
})

// What Drive does for a mention of someone who can't open the file (issue 1154)
describe('mentioning someone who can’t open the spreadsheet', () => {
  async function post(text: string, canShare = false) {
    const mounted = await mountComments({
      canShare,
      startOn: cellAnchor({ sheet: 'Sheet1', cell: 'B2' }),
    })
    type(mounted.root, CELL_BOX, text)
    await submit(mounted.root, CELL_BOX)
    return mounted
  }

  it('tells a manager the person can now comment', async () => {
    people.locked = ['arjun@x.com']
    const { create } = await post('Check @[arjun@x.com] and @[ben@x.com] here', true)

    expect(create).toHaveBeenCalledOnce()
    expect([told.successes, told.warnings]).toEqual([['Arjun Mehta can now comment'], []])
  })

  it('warns someone who can’t manage it that the person still can’t open it', async () => {
    people.locked = ['arjun@x.com']
    const { create } = await post('Check @[arjun@x.com] here')

    expect(create).toHaveBeenCalledOnce()
    expect([told.successes, told.warnings]).toEqual([
      [],
      ['Arjun Mehta can’t open this spreadsheet until someone who manages it shares it'],
    ])
  })

  it('says nothing when everyone named can open it', async () => {
    const { create } = await post('Check @[ben@x.com] here', true)

    expect(create).toHaveBeenCalledOnce()
    expect([told.successes, told.warnings]).toEqual([[], []])
  })

  it('asks before naming a blocked person, and posts nothing when the writer stops', async () => {
    people.locked = ['arjun@x.com']
    people.blocked = ['arjun@x.com']
    told.isYes = false
    const { create } = await post('Check @[arjun@x.com] here', true)

    expect(told.asked).toEqual(['Arjun Mehta has been blocked from this spreadsheet'])
    expect(create).not.toHaveBeenCalled()
  })

  it('posts after the writer chooses to post anyway, with no access message', async () => {
    people.locked = ['arjun@x.com']
    people.blocked = ['arjun@x.com']
    const { create } = await post('Check @[arjun@x.com] here', true)

    expect(told.asked).toHaveLength(1)
    expect(create).toHaveBeenCalledOnce()
    expect([told.successes, told.warnings]).toEqual([[], []])
  })

  it('tells the writer what a reply’s mention did', async () => {
    people.locked = ['arjun@x.com']
    const { root, reply } = await mountComments({
      canShare: true,
      threads: [thread('t1', 'sheets:cell:C4!Sheet1', 'Check this')],
    })
    rowButton(root, 'Check this').click()
    await settle()
    type(root, 'Reply', 'Over to @[arjun@x.com] now')
    await submit(root, 'Reply')

    expect(reply).toHaveBeenCalledOnce()
    expect(told.successes).toEqual(['Arjun Mehta can now comment'])
  })
})

// Guests get no picker, as in Writer (issue 1154)
describe('the @ menu', () => {
  async function typeAt() {
    const { root } = await mountComments({
      startOn: cellAnchor({ sheet: 'Sheet1', cell: 'B2' }),
    })
    type(root, CELL_BOX, 'Over to @arj')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await settle()
    return root
  }

  it('offers a signed-in writer the people for this spreadsheet', async () => {
    const root = await typeAt()

    expect(people.searches).toContainEqual({ q: 'arj', node: 'node-1' })
    expect(root.querySelector('[role="listbox"]')?.textContent).toContain('Arjun Mehta')
  })

  it('offers a guest no one', async () => {
    signedIn.value = false
    const root = await typeAt()

    expect(people.searches).toEqual([])
    expect(root.querySelector('[role="listbox"]')).toBeNull()
  })
})
