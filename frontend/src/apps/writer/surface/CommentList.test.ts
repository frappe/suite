import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import * as Y from 'yjs'

import type { DocumentThread } from '@/apps/drive'
import { encodeAnchor } from '@/apps/writer/collab/anchors'
import type { ThreadPlace } from '@/apps/writer/collab/places'

import CommentList from './CommentList.vue'
import type { ShownDraft, useCommentDrafts } from './useCommentDrafts'
import type { ThreadActions } from './useDocumentPanel'

const confirmed = vi.hoisted(() => ({ asked: [] as string[], answer: true }))

interface ShownToast {
  message: string
  duration: number
  action: { label: string; onClick: () => void }
}

const toasts = vi.hoisted(() => [] as ShownToast[])
const warnings = vi.hoisted(() => [] as string[])
const errors = vi.hoisted(() => [] as string[])
const me = vi.hoisted(() => ({ id: 'Asha Rao' }))

vi.mock('@/boot/session', async () => {
  const { computed: derive } = await import('vue')
  return {
    useCurrentUser: () => ({ user: derive(() => me.id), isLoggedIn: derive(() => true) }),
  }
})

vi.mock('@/apps/writer/composables/useUsers', async () => {
  const { shallowRef } = await import('vue')
  const names: Record<string, string> = { 'ben@x.com': 'Ben Roy' }
  return {
    useUsers: () => ({ users: shallowRef([]), answeredQuery: shallowRef('') }),
    searchMentions: () => {},
    fullName: (user: string) => names[user] ?? user,
    lookUp: async () => {},
  }
})

vi.mock('@/platform/feedback', () => ({
  confirm: async ({ title }: { title: string }) => {
    confirmed.asked.push(title)
    return confirmed.answer
  },
  toast: {
    success: (message: string, options: Omit<ShownToast, 'message'>) =>
      toasts.push({ message, ...options }),
    warning: (message: string) => warnings.push(message),
    error: (message: string) => errors.push(message),
  },
}))

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  // A text box whose parent can focus it, like frappe-ui's own
  function box(tag: 'input' | 'textarea') {
    return define({
      props: { modelValue: String },
      emits: ['update:modelValue'],
      setup(props, { emit, expose }) {
        const field = state<HTMLInputElement | null>(null)
        expose({ focus: () => field.value?.focus() })
        function write(event: Event) {
          emit('update:modelValue', (event.target as HTMLInputElement).value)
        }

        return () => render(tag, { ref: field, value: props.modelValue, onInput: write })
      },
    })
  }

  return {
    Avatar: { render: () => null },
    Button: define({
      props: { label: String, type: String },
      emits: ['click'],
      setup:
        (props, { emit }) =>
        () =>
          render(
            'button',
            { type: props.type ?? 'button', onClick: () => emit('click') },
            props.label,
          ),
    }),
    // Shows the menu's items beside its button, as if it were open; a pick reports closing a tick later
    Dropdown: define({
      props: { options: Array as () => { label: string; onClick: () => void }[] },
      emits: ['update:open'],
      setup:
        (props, { emit, slots }) =>
        () =>
          render('div', [
            render('div', { onClick: () => emit('update:open', true) }, slots.default?.()),
            props.options?.map((option) =>
              render(
                'button',
                {
                  role: 'menuitem',
                  onClick: async () => {
                    option.onClick()
                    await nextTick()
                    emit('update:open', false)
                  },
                },
                option.label,
              ),
            ),
          ]),
    }),
    Textarea: box('textarea'),
    TextInput: box('input'),
  }
})

vi.mock('@/apps/drive', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  return {
    DriveCommentAuthor: define({
      setup:
        (_props, { slots }) =>
        () =>
          render('span', slots.default?.()),
    }),
    GUEST_NAME_LIMIT: 140,
    useDriveGuestName: () => ({
      shown: state(false),
      text: state(''),
      atLimit: state(false),
      maxLength: 140,
      take: () => undefined,
    }),
  }
})

const TODAY = new Date().toISOString()

function comment(name: string, author: string, content: string) {
  return {
    name,
    author,
    author_name: null,
    person: { full_name: author },
    content,
    creation: TODAY,
  }
}

const ON_TEXT = {
  name: 'on-text',
  resolved: false,
  comments: [
    comment('c1', 'Asha Rao', 'Is this right?'),
    comment('c2', 'Ben Ito', 'Yes'),
    comment('c3', 'Asha Rao', 'Thanks'),
  ],
} as unknown as DocumentThread

const WHOLE = {
  name: 'whole',
  resolved: false,
  comments: [comment('c4', 'Ben Ito', 'Looks good overall')],
} as unknown as DocumentThread

const DONE = {
  name: 'done',
  resolved: true,
  comments: [comment('c5', 'Asha Rao', 'Fixed the title'), comment('c6', 'Ben Ito', 'Thanks')],
} as unknown as DocumentThread

const PLACES = new Map<string, ThreadPlace>([
  ['on-text', { kind: 'text', from: 5, to: 9, quote: 'the words' }],
  ['whole', { kind: 'document' }],
  ['done', { kind: 'deleted', quote: 'gone' }],
])

let mounted: App | null = null

// jsdom lays nothing out, so has nothing to scroll
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  mounted?.unmount()
  document.body.replaceChildren()
  localStorage.clear()
  sessionStorage.clear()
  confirmed.asked = []
  confirmed.answer = true
  toasts.length = 0
  warnings.length = 0
  errors.length = 0
  me.id = 'Asha Rao'
})

// Drafts as useCommentDrafts shows them, each post answered in turn by the thread Drive made or null
function fakeDrafts(shown: Partial<ShownDraft>[] = [], answers: (string | null)[] = []) {
  function made(index: number, draft: Partial<ShownDraft>): ShownDraft {
    return {
      clientId: `draft-${index}`,
      anchor: 'on-some-text',
      text: '',
      isSent: false,
      isPosting: false,
      ...draft,
    }
  }

  const drafts = ref<ShownDraft[]>(shown.map((draft, index) => made(index, draft)))
  const posted: string[] = []
  const list = {
    drafts,
    start: (anchor: string) => {
      drafts.value = [...drafts.value, made(drafts.value.length, { anchor })]
    },
    write: (draft: ShownDraft, text: string) => {
      draft.text = text
    },
    discard: (draft: ShownDraft) => {
      drafts.value = drafts.value.filter((kept) => kept.clientId !== draft.clientId)
    },
    post: async (draft: ShownDraft) => {
      posted.push(draft.clientId)
      return answers.shift() ?? null
    },
  }
  return { posted, list: list as unknown as ReturnType<typeof useCommentDrafts> }
}

// The list over the three threads, recording each change it asks for and each thread it opens or lights
function showList({
  canComment = true,
  threads = [ON_TEXT, WHOLE, DONE],
  openThread = null as string | null,
  isRefusingResolve = false,
  isRefusingEdit = false,
  refusedReplies = 0,
  heldReplies = Promise.resolve(),
  canEditDocument = false,
  drafts = fakeDrafts().list,
} = {}) {
  const asked: string[] = []
  const replyIds: string[] = []
  let refusalsLeft = refusedReplies
  const opened: (string | null)[] = []
  const lit: (string | null)[] = []
  const shown = ref(openThread)
  const listed = ref(threads)
  function open(name: string | null) {
    opened.push(name)
    shown.value = name
  }

  function record(change: string) {
    asked.push(change)
    return Promise.resolve(true)
  }

  const actions: ThreadActions = {
    reply: async (thread, text, _authorName, clientId) => {
      replyIds.push(clientId)
      await record(`reply ${thread} "${text}"`)
      await heldReplies
      refusalsLeft -= 1
      return refusalsLeft < 0
    },
    resolve: async (thread, isResolved) => {
      await record(`resolve ${thread} ${isResolved}`)
      if (isRefusingResolve) {
        return false
      }

      // Read again before answering, as the panel's resolve does
      const changed = [...listed.value]
      const index = changed.findIndex((listedThread) => listedThread.name === thread)
      changed[index] = { ...changed[index], resolved: isResolved }
      listed.value = changed
      return true
    },
    editComment: async (name, text) => (await record(`edit ${name} "${text}"`)) && !isRefusingEdit,
    removeComment: (name) => record(`remove ${name}`),
  }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(() =>
    h(CommentList, {
      threads: listed.value,
      readAt: 1,
      node: 'doc-1',
      places: PLACES,
      canComment,
      canEditDocument,
      actions,
      drafts,
      openThread: shown.value,
      'onUpdate:openThread': open,
      'onUpdate:litThread': (name: string | null) => lit.push(name),
    }),
  )
  app.mount(host)
  mounted = app
  return { host, asked, opened, lit, listed, replyIds }
}

// Each row's words, one piece of text after another
function rows(host: Element) {
  return [...host.querySelectorAll('li:not([role="none"])')].map((row) => {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    const pieces: string[] = []
    while (walker.nextNode()) {
      pieces.push(walker.currentNode.textContent?.trim() ?? '')
    }

    return pieces.filter(Boolean).join(' ')
  })
}

function buttonNamed(host: Element, name: string) {
  return [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)
}

function labelled(host: Element, label: string) {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined
}

// The toggle of the row holding the text, open or closed
function rowButton(host: Element, text: string) {
  const row = [...host.querySelectorAll('li')].find((item) => item.textContent?.includes(text))
  return row!.querySelector<HTMLButtonElement>(':scope > button')!
}

async function click(button: HTMLElement | undefined) {
  button!.click()
  await nextTick()
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve))
  await nextTick()
}

function openRows(host: Element) {
  return [...host.querySelectorAll('li:not([role="none"]) > button[aria-expanded="true"]')].map(
    (button) => button.closest('li')!.dataset.thread ?? '',
  )
}

// "é" is two bytes, so these sit either side of Drive's 65,535-byte limit on a comment
const LONGEST = 'é'.repeat(32_767) + 'x'
const TOO_LONG = 'é'.repeat(32_768)
const TOO_LONG_MESSAGE = 'This comment is too long. Shorten it and try again.'

describe('the comments list', () => {
  it('shows each open thread on one row: who, where, when, the first comment and the replies', () => {
    const { host } = showList()

    expect(rows(host)).toEqual([
      expect.stringMatching(/^Ben Ito \S.* Looks good overall$/),
      expect.stringMatching(/^Asha Rao \S.* Is this right\? · 2 replies$/),
    ])
  })

  it('shows open threads, then resolved ones folded under Resolved · n', async () => {
    const { host } = showList()
    const atFirst = [
      rows(host).length,
      buttonNamed(host, 'Resolved · 1')?.getAttribute('aria-expanded'),
    ]

    await click(buttonNamed(host, 'Resolved · 1'))

    expect([
      atFirst,
      buttonNamed(host, 'Resolved · 1')?.getAttribute('aria-expanded'),
      rows(host),
    ]).toEqual([
      [2, 'false'],
      'true',
      [
        expect.stringMatching(/^Ben Ito \S.* Looks good overall$/),
        expect.stringMatching(/^Asha Rao \S.* Is this right\? · 2 replies$/),
        expect.stringMatching(/^Asha Rao Text deleted \S.* Fixed the title · 1 reply$/),
      ],
    ])
  })

  it('shows no Resolved line when nothing is resolved', () => {
    const { host } = showList({ threads: [ON_TEXT, WHOLE] })

    expect(host.textContent).not.toContain('Resolved')
  })

  it('keeps one thread open at a time, and closes it on a second click or Esc', async () => {
    const { host } = showList()
    const seen: string[][] = []

    await click(rowButton(host, 'Looks good overall'))
    seen.push(openRows(host))
    await click(rowButton(host, 'Is this right?'))
    seen.push(openRows(host))
    await click(rowButton(host, 'Is this right?'))
    seen.push(openRows(host))
    await click(rowButton(host, 'Looks good overall'))
    host.firstElementChild!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    seen.push(openRows(host))

    expect(seen).toEqual([['whole'], ['on-text'], [], []])
  })

  it('closes the open thread once another tab deletes it', async () => {
    const { host, opened, listed } = showList()

    await click(rowButton(host, 'Is this right?'))
    listed.value = [WHOLE, DONE]
    await nextTick()

    expect(opened).toEqual(['on-text', null])
  })

  it('closes the open thread once another tab resolves it', async () => {
    const { host, opened, listed } = showList()

    await click(rowButton(host, 'Is this right?'))
    listed.value = [{ ...ON_TEXT, resolved: true }, WHOLE, DONE]
    await nextTick()

    expect([opened, buttonNamed(host, 'Resolved · 2')?.getAttribute('aria-expanded')]).toEqual([
      ['on-text', null],
      'false',
    ])
  })

  it('keeps focus on the Resolved line while another tab changes the resolved threads', async () => {
    const { host, listed } = showList()
    const focused: (string | undefined)[] = []

    buttonNamed(host, 'Resolved · 1')!.focus()
    for (const threads of [
      [ON_TEXT, { ...WHOLE, resolved: true }, DONE],
      [ON_TEXT, WHOLE, DONE],
      [{ ...ON_TEXT, resolved: true }, WHOLE, DONE],
    ]) {
      listed.value = threads
      await nextTick()
      focused.push(document.activeElement?.textContent?.trim())
    }

    expect(focused).toEqual(['Resolved · 2', 'Resolved · 1', 'Resolved · 2'])
  })

  it('closes the open thread when it is resolved with Resolved unfolded', async () => {
    const { host, opened } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Is this right?'))
    await click(labelled(rowButton(host, 'Is this right?').parentElement!, 'Resolve'))
    await settled()

    expect(opened).toEqual(['on-text', null])
  })

  it('closes an open resolved thread when Resolved is folded', async () => {
    const { host, opened } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Fixed the title'))
    await click(buttonNamed(host, 'Resolved · 1'))

    expect(opened).toEqual(['done', null])
  })

  it('keeps open a thread the list has not caught up with yet', async () => {
    const { opened, listed } = showList({ openThread: 'just-posted' })

    listed.value = [ON_TEXT, WHOLE]
    await nextTick()

    expect(opened).toEqual([])
  })

  it('shows an open thread’s quote and every reply', async () => {
    const { host } = showList()

    await click(rowButton(host, 'Is this right?'))
    const text = host.querySelector('li')!.parentElement!.textContent

    expect([text, text?.includes('2 replies')]).toEqual([
      expect.stringMatching(/the words.*Is this right\?.*Ben Ito.*Yes.*Asha Rao.*Thanks/s),
      false,
    ])
  })
})

describe('resolving and reopening a thread', () => {
  it('keeps the open thread open while another is resolved from its row', async () => {
    const { host, asked } = showList()

    await click(rowButton(host, 'Is this right?'))
    await click(
      host.querySelector<HTMLButtonElement>(
        'li[data-thread="whole"] button[aria-label="Resolve"]',
      ) ?? undefined,
    )
    await settled()

    expect([asked, openRows(host)]).toEqual([['resolve whole true'], ['on-text']])
  })

  it('resolves the open thread from its ✓, closes it, and offers Undo for 5 seconds', async () => {
    const { host, asked } = showList()

    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()

    const shown = toasts.map(({ message, duration, action }) => [message, duration, action.label])
    expect([asked, openRows(host), shown]).toEqual([
      ['resolve whole true'],
      [],
      [['Comment resolved', 5000, 'Undo']],
    ])
  })

  it('reopens that thread once on Undo', async () => {
    const { host, asked } = showList()

    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()
    toasts[0].action.onClick()
    await settled()

    expect(asked).toEqual(['resolve whole true', 'resolve whole false'])
  })

  it('closes the open thread when it is reopened from Resolved', async () => {
    const { host, asked, opened } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Fixed the title'))
    await click(labelled(host, 'Reopen'))
    await settled()

    expect([asked, opened]).toEqual([['resolve done false'], ['done', null]])
  })

  it('leaves the thread closed when Undo puts it back under Open', async () => {
    const { host, opened } = showList()

    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()
    toasts[0].action.onClick()
    await settled()

    const isBack = rows(host).some((row) => row.includes('Looks good overall'))
    expect([opened, openRows(host), isBack]).toEqual([['whole', null], [], true])
  })

  it('offers no Undo when the thread could not be resolved', async () => {
    const { host, asked } = showList({ isRefusingResolve: true })

    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()

    expect([asked, toasts]).toEqual([['resolve whole true'], []])
  })

  it('sends one resolve for two quick clicks on the same ✓', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Looks good overall'))
    const resolveButton = labelled(host, 'Resolve')!

    resolveButton.click()
    resolveButton.click()
    await settled()

    expect(asked).toEqual(['resolve whole true'])
  })

  it('lets a thread be resolved again once a refused resolve comes back', async () => {
    const { host, asked } = showList({ isRefusingResolve: true })
    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()

    await click(labelled(host, 'Resolve'))
    await settled()

    expect(asked).toEqual(['resolve whole true', 'resolve whole true'])
  })

  it('reopens a resolved thread from ↺ in the same spot, with no message', async () => {
    const { host, asked } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    const hasResolve = !!labelled(rowButton(host, 'Fixed the title').parentElement!, 'Resolve')
    await click(labelled(host, 'Reopen'))
    await settled()

    expect([hasResolve, asked, toasts]).toEqual([false, ['resolve done false'], []])
  })
})

describe('replying in an open thread', () => {
  function replyBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')
  }

  async function type(text: string) {
    replyBox()!.value = text
    replyBox()!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  async function press(options: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...options })
    replyBox()!.dispatchEvent(event)
    await settled()
    return event.defaultPrevented
  }

  it('puts the cursor in the reply box of a thread opened from the list', async () => {
    const { host } = showList()

    await click(rowButton(host, 'Is this right?'))
    await nextTick()

    expect([replyBox(), document.activeElement === replyBox()]).toEqual([expect.anything(), true])
  })

  it('leaves the cursor where it was when the thread is opened from its text', async () => {
    showList({ openThread: 'on-text' })
    await settled()

    expect([replyBox(), document.activeElement === replyBox()]).toEqual([expect.anything(), false])
  })

  it('sends the reply on Enter and empties the box', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await type('  Agreed ')
    const isKeptOutOfBox = await press({})

    expect([asked, replyBox()?.value, isKeptOutOfBox]).toEqual([
      ['reply on-text "Agreed"'],
      '',
      true,
    ])
  })

  // Replies that wait until released, as on a slow network
  function holdReplies() {
    const held = { release() {} }
    const heldReplies = new Promise<void>((resolve) => {
      held.release = resolve
    })
    function release() {
      held.release()
    }

    return { heldReplies, release }
  }

  it('keeps the words typed while a reply sends, and empties only what was sent', async () => {
    const { heldReplies, release } = holdReplies()
    const { host, asked } = showList({ heldReplies })
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')

    await press({})
    await type('Agreed. One more thing')
    release()
    await settled()

    expect([asked, replyBox()?.value]).toEqual([['reply on-text "Agreed"'], '. One more thing'])
  })

  it('keeps the whole box when the words being sent are changed while they send', async () => {
    const { heldReplies, release } = holdReplies()
    const { host } = showList({ heldReplies })
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')

    await press({})
    await type('Agree, mostly')
    release()
    await settled()

    expect(replyBox()?.value).toBe('Agree, mostly')
  })

  it('sends nothing on Shift+Enter or while a word is being composed', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await type('Agreed')
    const pressed = [
      await press({ shiftKey: true }),
      await press({ isComposing: true }),
      await press({ keyCode: 229 }),
    ]

    expect([asked, pressed]).toEqual([[], [false, false, false]])
  })

  it('sends nothing on Enter while the people list is open', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await type('Ask @z')
    const isKeptOutOfBox = await press({})

    expect([asked, replyBox()?.value, isKeptOutOfBox]).toEqual([[], 'Ask @z', true])
  })

  it('sends one reply for two quick presses of Enter', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')

    const enter = { key: 'Enter', cancelable: true }
    replyBox()!.dispatchEvent(new KeyboardEvent('keydown', enter))
    replyBox()!.dispatchEvent(new KeyboardEvent('keydown', enter))
    await settled()

    expect(asked).toEqual(['reply on-text "Agreed"'])
  })

  it('sends the same words again under the same client id after a refusal, so Drive posts them once', async () => {
    const { host, asked, replyIds } = showList({ refusedReplies: 1 })
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')

    await press({})
    const kept = replyBox()?.value
    await press({})

    const [first, second] = replyIds
    expect([asked, kept, replyIds.length, first === second]).toEqual([
      ['reply on-text "Agreed"', 'reply on-text "Agreed"'],
      'Agreed',
      2,
      true,
    ])
  })

  it('sends changed words after a refusal under a new client id', async () => {
    const { host, replyIds } = showList({ refusedReplies: 1 })
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')
    await press({})

    await type('Agreed, mostly')
    await press({})

    const [first, second] = replyIds
    expect([replyIds.length, first === second]).toEqual([2, false])
  })

  it('sends earlier refused words again under their first client id, after other words in between', async () => {
    const { host, replyIds } = showList({ refusedReplies: 2 })
    await click(rowButton(host, 'Is this right?'))

    for (const words of ['Agreed', 'Not sure', 'Agreed']) {
      await type(words)
      await press({})
    }

    const [first, second, third] = replyIds
    expect([replyIds.length, first === third, first === second]).toEqual([3, true, false])
  })

  it('gives a new reply of the same words its own client id once the last one is posted', async () => {
    const { host, replyIds } = showList()
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')
    await press({})

    await type('Agreed')
    await press({})

    const [first, second] = replyIds
    expect([replyIds.length, first === second]).toEqual([2, false])
  })

  it('sends no reply over the limit, keeping its words and saying why, but sends one at it', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await type(TOO_LONG)
    await press({})
    const isKept = replyBox()?.value === TOO_LONG
    await type(LONGEST)
    await press({})

    expect([isKept, errors, asked.length, asked[0] === `reply on-text "${LONGEST}"`]).toEqual([
      true,
      [TOO_LONG_MESSAGE],
      1,
      true,
    ])
  })

  it('shows the send arrow only once there is text, and sends from it', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    const isShownEmpty = !!labelled(host, 'Send reply')
    await type('Agreed')
    await click(labelled(host, 'Send reply'))
    await settled()

    expect([isShownEmpty, asked]).toEqual([false, ['reply on-text "Agreed"']])
  })

  it('shows the keys to use only while the box is empty and has the cursor', async () => {
    const { host } = showList()
    const hint = 'Enter to send · Shift+Enter for a new line'
    await click(rowButton(host, 'Is this right?'))
    await nextTick()

    const seen = [host.textContent?.includes(hint)]
    await type('A')
    seen.push(host.textContent?.includes(hint))
    await type('')
    replyBox()!.blur()
    await nextTick()
    seen.push(host.textContent?.includes(hint))

    expect(seen).toEqual([true, false, false])
  })

  it('keeps the thread open with its words when Drive refuses to resolve it', async () => {
    const { host } = showList({ isRefusingResolve: true })
    await click(rowButton(host, 'Looks good overall'))
    await type('Half a reply')

    await click(
      host.querySelector<HTMLButtonElement>(
        'li[data-thread="whole"] button[aria-label="Resolve"]',
      ) ?? undefined,
    )
    await settled()

    expect([openRows(host), replyBox()?.value]).toEqual([['whole'], 'Half a reply'])
  })

  it('keeps a half-typed reply when another thread is opened and back', async () => {
    const { host } = showList()
    await click(rowButton(host, 'Is this right?'))
    await type('Half a reply')

    await click(rowButton(host, 'Looks good overall'))
    const otherBox = replyBox()?.value
    await click(rowButton(host, 'Is this right?'))

    expect([otherBox, replyBox()?.value]).toEqual(['', 'Half a reply'])
  })

  it('offers no reply box in a resolved thread', async () => {
    const { host } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Fixed the title'))

    expect(replyBox()).toBeNull()
  })
})

describe('commenting on the whole document', () => {
  function documentBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Add a comment"]')
  }

  async function type(text: string) {
    documentBox()!.value = text
    documentBox()!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  // The list with a handle to start a whole-document comment, as Ctrl+Alt+M does
  function showStartableList(drafts = fakeDrafts().list) {
    const host = document.createElement('div')
    document.body.append(host)
    const list = ref<{ startDocumentComment(): Promise<void> } | null>(null)
    const props = {
      ref: list,
      threads: [DONE],
      readAt: 1,
      node: 'doc-1',
      places: PLACES,
      canComment: true,
      canEditDocument: false,
      actions: {} as ThreadActions,
      drafts,
    }
    mounted = createApp(() => h(CommentList, props))
    mounted.mount(host)
    return { host, start: () => list.value!.startDocumentComment() }
  }

  it('turns the line into a focused box in its place, and posts what is typed', async () => {
    const { list, posted } = fakeDrafts()
    const { host } = showList({ drafts: list })

    await click(buttonNamed(host, 'Add a comment…'))
    await nextTick()
    const isFocused = document.activeElement === documentBox()
    const hasLine = !!buttonNamed(host, 'Add a comment…')
    await type('Ship it')
    documentBox()!.closest('form')!.requestSubmit()
    await settled()
    const kept = list.drafts.value.map(({ anchor, text }) => `${anchor} "${text}"`)

    expect([isFocused, hasLine, posted, kept]).toEqual([
      true,
      false,
      ['draft-0'],
      ['document "Ship it"'],
    ])
  })

  it('posts no comment over the limit, keeping its box and words and saying why, but posts one at it', async () => {
    const { list, posted } = fakeDrafts()
    const { host } = showList({ drafts: list })
    await click(buttonNamed(host, 'Add a comment…'))
    await nextTick()

    await type(TOO_LONG)
    documentBox()!.closest('form')!.requestSubmit()
    await settled()
    const isKept = documentBox()?.value === TOO_LONG
    const postedOverLimit = [...posted]
    await type(LONGEST)
    documentBox()!.closest('form')!.requestSubmit()
    await settled()

    expect([isKept, postedOverLimit, errors, posted]).toEqual([
      true,
      [],
      [TOO_LONG_MESSAGE],
      ['draft-0'],
    ])
  })

  it('opens the box at the top when asked from elsewhere, with Resolved unfolded', async () => {
    const { host, start } = showStartableList()
    await click(buttonNamed(host, 'Resolved · 1'))

    await start()

    expect(document.activeElement === documentBox()).toBe(true)
  })

  it('keeps one box, putting the cursor back in it with its words when asked again', async () => {
    const { list } = fakeDrafts()
    const { host, start } = showStartableList(list)
    await start()
    await type('Half a thought')
    documentBox()!.blur()

    await start()

    const boxes = host.querySelectorAll('textarea[aria-label="Add a comment"]').length
    const isFocused = document.activeElement === documentBox()
    expect([boxes, list.drafts.value.length, isFocused, documentBox()?.value]).toEqual([
      1,
      1,
      true,
      'Half a thought',
    ])
  })

  it('keeps a comment on text in its own box beside the whole-document one', () => {
    const { list } = fakeDrafts([{ anchor: 'document' }, { text: 'On the text' }])
    const { host } = showList({ drafts: list })

    const boxes = [...host.querySelectorAll('textarea')].map((box) => [
      box.getAttribute('aria-label'),
      box.placeholder,
    ])
    expect(boxes).toEqual([
      ['Add a comment', 'Add a comment'],
      ['Add a comment on the text', 'Add a comment'],
    ])
  })

  it('closes an empty box without asking, and asks before dropping typed words, on Cancel or Esc', async () => {
    const { host } = showList()

    await click(buttonNamed(host, 'Add a comment…'))
    await click(buttonNamed(host, 'Cancel'))
    await settled()
    const afterEmpty = [documentBox(), confirmed.asked.length]
    await click(buttonNamed(host, 'Add a comment…'))
    await type('Half a thought')
    confirmed.answer = false
    await click(buttonNamed(host, 'Cancel'))
    await settled()
    documentBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settled()
    const afterNo = documentBox()?.value
    confirmed.answer = true
    documentBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settled()

    expect([afterEmpty, afterNo, confirmed.asked, documentBox()]).toEqual([
      [null, 0],
      'Half a thought',
      ['Discard comment?', 'Discard comment?', 'Discard comment?'],
      null,
    ])
  })

  it('shows no place word on a comment to the whole document that is posting', () => {
    const { list } = fakeDrafts([
      { anchor: 'document', text: 'Ship it', isSent: true, isPosting: true },
    ])
    const { host } = showList({ threads: [], drafts: list })

    expect(rows(host)).toEqual(['You Posting… Ship it'])
  })
})

describe('an empty list and a reader who can’t comment', () => {
  it('says how to start a comment when nothing is open', () => {
    const { host } = showList({ threads: [DONE] })

    expect(host.textContent).toContain(
      'No open comments. Select text and press Comment, or add one above.',
    )
  })

  it('offers a reader no top line, reply, resolve or delete, open or resolved', async () => {
    const { host } = showList({ canComment: false, threads: [ON_TEXT, DONE] })
    function extras() {
      const labels = [...host.querySelectorAll('button:not([aria-expanded])')].map(
        (button) => button.textContent?.trim() || button.getAttribute('aria-label'),
      )
      return [host.querySelector('textarea'), labels]
    }

    await click(rowButton(host, 'Is this right?'))
    const inOpen = extras()
    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Fixed the title'))

    expect([inOpen, extras()]).toEqual([
      [null, []],
      [null, []],
    ])
  })

  it('shows No open comments, then Resolved · n, when every thread is resolved', () => {
    const { host } = showList({ threads: [DONE] })

    expect(host.textContent).toMatch(/No open comments\..*Resolved · 1/)
  })

  it('tells a reader only that nothing is open', () => {
    const { host } = showList({ canComment: false, threads: [] })

    expect(host.querySelector('p')?.textContent).toBe('No open comments.')
  })
})

describe('the list and the editor', () => {
  function point(host: Element, text: string, event: 'mouseenter' | 'mouseleave') {
    rowButton(host, text).parentElement!.dispatchEvent(new MouseEvent(event))
  }

  it('lights a thread’s text while its row is pointed at, and clears it after', () => {
    const { host, lit } = showList()

    point(host, 'Is this right?', 'mouseenter')
    point(host, 'Is this right?', 'mouseleave')

    expect(lit).toEqual(['on-text', null])
  })

  it('unfolds Resolved for a resolved thread opened from its text', async () => {
    const { host } = showList({ openThread: 'done' })
    await settled()

    const isOpen = rowButton(host, 'Fixed the title').getAttribute('aria-expanded')
    expect([buttonNamed(host, 'Resolved · 1')?.getAttribute('aria-expanded'), isOpen]).toEqual([
      'true',
      'true',
    ])
  })

  it('leaves no text lit once the panel closes', () => {
    const { host, opened, lit } = showList({ openThread: 'on-text' })
    point(host, 'Looks good overall', 'mouseenter')

    mounted!.unmount()
    mounted = null

    expect([opened, lit]).toEqual([[null], ['whole', null]])
  })
})

describe('editing and deleting a comment', () => {
  function menus(host: Element) {
    return host.querySelectorAll('button[aria-label="More comment actions"]').length
  }

  // The ⋯ buttons shown without being pointed at
  function alwaysShown(host: Element) {
    return [...host.querySelectorAll('button[aria-label="More comment actions"]')].filter(
      (button) => !button.closest('.invisible'),
    ).length
  }

  function editBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit comment"]')
  }

  async function type(text: string) {
    editBox()!.value = text
    editBox()!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  // Opens the ⋯ menu of the comment with the text and picks an item from it
  async function pick(host: Element, text: string, item: string) {
    const block = [...host.querySelectorAll('li div')].find(
      (element) => element.querySelector(':scope > p:not(.flex)')?.textContent?.trim() === text,
    )
    await click(labelled(block!, 'More comment actions'))
    const option = [...block!.querySelectorAll('[role="menuitem"]')].find(
      (element) => element.textContent === item,
    )
    await click(option as HTMLElement)
    await nextTick()
  }

  async function save() {
    editBox()!.closest('form')!.requestSubmit()
    await settled()
  }

  it('offers ⋯ on an open thread’s own comments to its author, and on all of them to an editor', async () => {
    const seen: number[] = []
    for (const options of [{}, { canEditDocument: true }, { canComment: false }]) {
      const { host } = showList({ threads: [ON_TEXT], ...options })
      seen.push(menus(host))
      await click(rowButton(host, 'Is this right?'))
      seen.push(menus(host))
      mounted?.unmount()
      document.body.replaceChildren()
    }

    expect(seen).toEqual([0, 2, 0, 3, 0, 0])
  })

  it('names the author above each reply, but not again above the first comment', async () => {
    const { host } = showList({ threads: [ON_TEXT] })

    await click(rowButton(host, 'Is this right?'))
    const authorLines = [...host.querySelectorAll('div[class~="group/comment"] > p.flex')]

    expect(authorLines.map((line) => line.textContent?.trim())).toEqual([
      expect.stringMatching(/^Ben Ito/),
      expect.stringMatching(/^Asha Rao/),
    ])
  })

  it('offers a guest no ⋯, even on comments made as a guest', async () => {
    me.id = 'Guest'
    const byGuest = {
      ...WHOLE,
      comments: [comment('c9', 'Guest', 'From a guest')],
    } as unknown as DocumentThread
    const { host } = showList({ threads: [byGuest] })

    await click(rowButton(host, 'From a guest'))

    expect(menus(host)).toBe(0)
  })

  it('edits a comment in place, with the cursor in it, and saves the new words', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await pick(host, 'Is this right?', 'Edit')
    const opened = [editBox()?.value, document.activeElement === editBox()]
    await type(' Is this still right? ')
    await save()

    expect([opened, asked, editBox()]).toEqual([
      ['Is this right?', true],
      ['edit c1 "Is this still right?"'],
      null,
    ])
  })

  it('cancels an edit on Esc, sending nothing and keeping the thread open', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Thanks', 'Edit')
    await type('Changed my mind')

    editBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect([asked, editBox(), openRows(host), host.textContent]).toEqual([
      [],
      null,
      ['on-text'],
      expect.stringContaining('Thanks'),
    ])
  })

  it('hides ⋯ on the comment being edited, and Cancel closes the box sending nothing', async () => {
    const { host, asked } = showList({ threads: [ON_TEXT] })
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Thanks', 'Edit')
    await type('Changed my mind')

    const whileEditing = menus(host)
    await click(buttonNamed(host, 'Cancel')!)

    expect([whileEditing, asked, editBox(), menus(host)]).toEqual([1, [], null, 2])
  })

  it('hides ⋯ again until pointed at once an edit picked from it is saved or cancelled', async () => {
    const { host } = showList({ threads: [ON_TEXT] })
    await click(rowButton(host, 'Is this right?'))

    await pick(host, 'Thanks', 'Edit')
    await type('Thanks again')
    await save()
    const afterSave = alwaysShown(host)
    await pick(host, 'Is this right?', 'Edit')
    await click(buttonNamed(host, 'Cancel'))

    expect([afterSave, alwaysShown(host)]).toEqual([0, 0])
  })

  it('sends nothing for an unchanged comment, and can’t save an empty one', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Is this right?', 'Edit')

    await type('')
    const isSaveOff = buttonNamed(host, 'Save')!.disabled
    await type('Is this right?')
    await save()

    expect([isSaveOff, asked, editBox()]).toEqual([true, [], null])
  })

  it('shows the people a comment mentions by name to edit, and saves them as mentions', async () => {
    const asking = {
      ...WHOLE,
      comments: [
        { ...comment('c8', 'Asha Rao', 'Ask @[ben@x.com] or @[ghost]'), mentions: ['ben@x.com'] },
      ],
    } as unknown as DocumentThread
    const { host, asked } = showList({ threads: [asking] })
    await click(rowButton(host, 'Ask'))

    await pick(host, 'Ask @Ben Roy or @[ghost]', 'Edit')
    const opened = editBox()?.value
    await type(`${opened} now`)
    await save()

    expect([opened, asked]).toEqual([
      'Ask @Ben Roy or @ghost',
      ['edit c8 "Ask @[ben@x.com] or @[ghost] now"'],
    ])
  })

  it('keeps the box and the words when the edit is refused', async () => {
    const { host, asked } = showList({ isRefusingEdit: true })
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Is this right?', 'Edit')

    await type('Reworded')
    await save()

    expect([asked, editBox()?.value]).toEqual([['edit c1 "Reworded"'], 'Reworded'])
  })

  it('saves no edit over the limit, keeping the box and words and saying why, but saves one at it', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Is this right?', 'Edit')

    await type(TOO_LONG)
    await save()
    const isKept = editBox()?.value === TOO_LONG
    await type(LONGEST)
    await save()

    expect([isKept, errors, asked.length, asked[0] === `edit c1 "${LONGEST}"`]).toEqual([
      true,
      [TOO_LONG_MESSAGE],
      1,
      true,
    ])
  })

  it('asks before deleting a comment, and deletes only once confirmed', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    confirmed.answer = false
    await pick(host, 'Thanks', 'Delete')
    await settled()
    confirmed.answer = true
    await pick(host, 'Thanks', 'Delete')
    await settled()

    expect([confirmed.asked, asked]).toEqual([
      ['Delete this comment?', 'Delete this comment?'],
      ['remove c3'],
    ])
  })

  it('leads the row with the first reply once the first comment is deleted', async () => {
    const { host, listed } = showList()

    listed.value = [{ ...ON_TEXT, comments: ON_TEXT.comments.slice(1) }, WHOLE]
    await nextTick()

    const [, reply] = rows(host)
    expect(reply).toMatch(/^Ben Ito \S.* Yes · 1 reply$/)
  })
})

describe('an edit while someone else changes the comment', () => {
  function editBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit comment"]')
  }

  async function startEditing(options = {}) {
    const list = showList(options)
    await click(rowButton(list.host, 'Is this right?'))
    const menu = list.host.querySelector('li [role="menuitem"]') as HTMLElement
    await click(menu)
    editBox()!.value = 'Mine'
    editBox()!.dispatchEvent(new Event('input'))
    await nextTick()
    return list
  }

  it('keeps my words when another tab edits it, and my save wins', async () => {
    const { asked, listed } = await startEditing()
    const theirs = { ...ON_TEXT.comments[0], content: 'Theirs' }

    listed.value = [{ ...ON_TEXT, comments: [theirs, ...ON_TEXT.comments.slice(1)] }, WHOLE]
    await nextTick()
    const kept = editBox()?.value
    editBox()!.closest('form')!.requestSubmit()
    await settled()

    expect([kept, asked]).toEqual(['Mine', ['edit c1 "Mine"']])
  })

  it('keeps the box when the save is refused because it was deleted before the list knew', async () => {
    const { asked } = await startEditing({ isRefusingEdit: true })

    editBox()!.closest('form')!.requestSubmit()
    await settled()

    expect([asked, editBox()?.value, warnings]).toEqual([['edit c1 "Mine"'], 'Mine', []])
  })

  it('closes the box and says once that the edit wasn’t saved when the list shows it deleted', async () => {
    const { listed } = await startEditing()

    listed.value = [{ ...ON_TEXT, comments: ON_TEXT.comments.slice(1) }, WHOLE]
    await nextTick()
    listed.value = [{ ...ON_TEXT, comments: ON_TEXT.comments.slice(2) }]
    await nextTick()

    expect([editBox(), warnings]).toEqual([
      null,
      ["This comment was deleted, so your edit wasn't saved."],
    ])
  })

  it('says nothing when the list changes but the comment being edited is still there', async () => {
    const { listed } = await startEditing()

    listed.value = [ON_TEXT]
    await nextTick()

    expect([editBox()?.value, warnings]).toEqual(['Mine', []])
  })
})

describe('comments not yet posted', () => {
  function menus(host: Element) {
    return host.querySelectorAll('button[aria-label="More comment actions"]').length
  }

  it('shows a comment being written above the list, and sent ones as the first rows', () => {
    const { list } = fakeDrafts([
      { text: 'Still writing' },
      { text: 'On its way', isSent: true, isPosting: true },
      { text: 'Refused', isSent: true },
    ])
    const { host } = showList({ threads: [WHOLE], drafts: list })
    const box = host.querySelector('textarea[aria-label="Add a comment on the text"]')!
    const isBoxFirst = !!(
      box.compareDocumentPosition(host.querySelector('ul')!) & Node.DOCUMENT_POSITION_FOLLOWING
    )
    const faded = [...host.querySelectorAll('li')].map((row) =>
      row.classList.contains('opacity-60'),
    )
    const boxes = host.querySelectorAll('textarea').length

    const isFocused = document.activeElement === box

    expect([
      (box as HTMLTextAreaElement).value,
      boxes,
      isFocused,
      isBoxFirst,
      rows(host),
      faded,
    ]).toEqual([
      'Still writing',
      1,
      true,
      true,
      [
        'You Posting… On its way',
        'You Not posted · Retry Refused',
        expect.stringMatching(/^Ben Ito .* Looks good overall$/),
      ],
      [true, false, false],
    ])
  })

  it('posts from the box and retries from Retry, opening the thread once Drive takes it', async () => {
    const { list, posted } = fakeDrafts(
      [{ text: 'New words' }, { text: 'Refused', isSent: true }],
      [null, 'thread-9'],
    )
    const { host, opened } = showList({ drafts: list, openThread: 'whole' })

    host.querySelector('form')!.requestSubmit()
    await settled()
    await click(buttonNamed(host, 'Retry'))
    await settled()

    expect([posted, opened]).toEqual([['draft-0', 'draft-1'], ['thread-9']])
  })

  it('discards a refused comment from its ⋯ only once confirmed, and offers no ⋯ while posting', async () => {
    const { list } = fakeDrafts([
      { text: 'On its way', isSent: true, isPosting: true },
      { text: 'Refused', isSent: true },
    ])
    const { host } = showList({ threads: [], drafts: list })
    function discard() {
      return host.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    }

    for (const toggle of host.querySelectorAll<HTMLButtonElement>('li button[aria-expanded]')) {
      await click(toggle)
    }

    const shownMenus = menus(host)
    confirmed.answer = false
    await click(discard())
    await settled()
    const afterNo = rows(host).length
    confirmed.answer = true
    await click(discard())
    await settled()

    expect([shownMenus, confirmed.asked, afterNo, rows(host)]).toEqual([
      1,
      ['Discard this comment?', 'Discard this comment?'],
      2,
      ['You Posting… On its way'],
    ])
  })

  it('opens a refused comment to its words on a click, and closes it on another', async () => {
    const content = new Y.XmlText()
    new Y.Doc().getXmlFragment('default').insert(0, [content])
    content.insert(0, 'the quoted words')
    const anchor = encodeAnchor(
      Y.createRelativePositionFromTypeIndex(content, 0, 0),
      Y.createRelativePositionFromTypeIndex(content, content.length, -1),
      'the quoted words',
    )
    const { list } = fakeDrafts([{ anchor, text: 'Refused', isSent: true }])
    const { host } = showList({ threads: [], drafts: list })

    await click(buttonNamed(host, 'You'))
    const [openRow] = rows(host)
    await click(buttonNamed(host, 'You'))
    const [closedRow] = rows(host)

    expect([openRow, closedRow]).toEqual([
      'You Not posted · Retry the quoted words Refused Discard',
      'You Not posted · Retry the quoted words Refused',
    ])
  })

  it('keeps unposted comments at the top, above Resolved', async () => {
    const { list } = fakeDrafts([{ text: 'Still writing' }, { text: 'Refused', isSent: true }])
    const { host } = showList({ drafts: list })

    await click(buttonNamed(host, 'Resolved · 1'))

    expect([!!host.querySelector('textarea'), rows(host)]).toEqual([
      true,
      [
        'You Not posted · Retry Refused',
        expect.stringMatching(/^Ben Ito \S.* Looks good overall$/),
        expect.stringMatching(/^Asha Rao \S.* Is this right\? · 2 replies$/),
        expect.stringMatching(/^Asha Rao Text deleted .* Fixed the title · 1 reply$/),
      ],
    ])
  })
})

describe('threads changed since last opened', () => {
  function unreadRows(host: Element) {
    return rows(host).filter((row) => row.includes('Unread'))
  }

  function withReply(thread: DocumentThread) {
    const reply = { ...comment('c9', 'Ben Ito', 'One more'), modified: '2026-10-02 09:00:00' }
    return { ...thread, comments: [...thread.comments, reply] } as DocumentThread
  }

  it('dots a row changed since, open or resolved, and clears it once opened, never dotting drafts', async () => {
    const { list } = fakeDrafts([{ text: 'Refused', isSent: true }])
    const { host, listed } = showList({ drafts: list })
    const atFirst = unreadRows(host)

    listed.value = [ON_TEXT, withReply(WHOLE), withReply(DONE)]
    await nextTick()
    const changed = unreadRows(host)
    await click(rowButton(host, 'Looks good overall'))
    const opened = unreadRows(host)
    await click(buttonNamed(host, 'Resolved · 1'))
    const resolved = unreadRows(host)

    expect([atFirst, changed, opened, resolved]).toEqual([
      [],
      [expect.stringMatching(/^Ben Ito Unread \S.* Looks good overall · 1 reply$/)],
      [],
      [expect.stringMatching(/^Asha Rao Text deleted Unread \S.* Fixed the title · 2 replies$/)],
    ])
  })

  it('leaves a thread one resolves or reopens oneself unmarked', async () => {
    const { host } = showList()
    await click(rowButton(host, 'Looks good overall'))

    await click(labelled(host, 'Resolve'))
    await settled()
    await click(buttonNamed(host, 'Resolved · 2'))
    const afterResolve = [rows(host).length, unreadRows(host)]
    toasts[0].action.onClick()
    await settled()

    expect([afterResolve, rows(host).length, unreadRows(host)]).toEqual([[3, []], 3, []])
  })
})

describe('people a comment mentions', () => {
  const ASKING = {
    ...WHOLE,
    comments: [
      { ...comment('c8', 'Asha Rao', 'Ask @[ben@x.com] or @[ghost]'), mentions: ['ben@x.com'] },
    ],
  } as unknown as DocumentThread

  function tinted(host: Element) {
    return [...host.querySelectorAll('.text-ink-blue-6')].map((name) => name.textContent)
  }

  it('names the people Drive found mentioned, in the row and the open thread, and leaves the rest as written', async () => {
    const { host } = showList({ threads: [ASKING] })
    const closed = [rows(host), tinted(host)]

    await click(rowButton(host, 'Ask'))

    expect([closed, rows(host), tinted(host)]).toEqual([
      [[expect.stringMatching(/Ask @Ben Roy or @\[ghost\]$/)], ['@Ben Roy']],
      [expect.stringMatching(/Ask @Ben Roy or @\[ghost\]/)],
      ['@Ben Roy'],
    ])
  })

  it('names them the same in comments posting and not posted, closed and open', async () => {
    const { list } = fakeDrafts([
      { text: 'Ask @[ben@x.com]', isSent: true, isPosting: true },
      { text: 'Ask @[ben@x.com]', isSent: true },
    ])
    const { host } = showList({ threads: [], drafts: list })
    const closed = [rows(host), tinted(host)]

    const [, notPosted] = [...host.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === 'You',
    )
    await click(notPosted)

    expect([closed, rows(host), tinted(host)]).toEqual([
      [
        ['You Posting… Ask @Ben Roy', 'You Not posted · Retry Ask @Ben Roy'],
        ['@Ben Roy', '@Ben Roy'],
      ],
      ['You Posting… Ask @Ben Roy', 'You Not posted · Retry Ask @Ben Roy Discard'],
      ['@Ben Roy', '@Ben Roy'],
    ])
  })
})
