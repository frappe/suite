import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'

import type { WriterUser } from '@/apps/writer/drive'

import MentionTextarea from './MentionTextarea.vue'

const people = vi.hoisted(() => ({
  isLoggedIn: true,
  /** While true, searches get no answer until the test gives one. */
  isHeld: false,
  /** Names known now; a lookup learns the rest, once let through. */
  known: {} as Record<string, string>,
  later: {} as Record<string, string>,
  letLookupsThrough: (): void => {},
  searched: [] as string[],
}))

vi.mock('@/boot/session', async () => {
  const { computed: derive } = await import('vue')
  return { useCurrentUser: () => ({ isLoggedIn: derive(() => people.isLoggedIn) }) }
})

vi.mock('@/apps/writer/composables/useUsers', async () => {
  const { shallowRef } = await import('vue')
  const users = shallowRef<WriterUser[]>([])
  const answeredQuery = shallowRef<string | null>('')
  return {
    useUsers: () => ({ users, answeredQuery }),
    searchMentions: (query: string) => {
      people.searched.push(query)
      if (!people.isHeld) {
        answeredQuery.value = query
      }
    },
    fullName: (user: string) => people.known[user] ?? user,
    lookUp: (user: string) =>
      new Promise<void>((resolve) => {
        const before = people.letLookupsThrough
        people.letLookupsThrough = () => {
          before()
          people.known[user] = people.later[user] ?? user
          resolve()
        }
      }),
    offered: users,
    answered: answeredQuery,
  }
})

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  return {
    Avatar: { render: () => null },
    // A text box like frappe-ui's own: it writes on input and exposes its element
    Textarea: define({
      props: { modelValue: String },
      emits: ['update:modelValue'],
      setup(props, { emit, expose }) {
        const field = state<HTMLTextAreaElement | null>(null)
        expose({
          focus: () => field.value?.focus(),
          get inputElement() {
            return field.value
          },
        })
        function write(event: Event) {
          emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
        }

        return () => render('textarea', { ref: field, value: props.modelValue, onInput: write })
      },
    }),
  }
})

const { offered, answered } = (await import('@/apps/writer/composables/useUsers')) as unknown as {
  offered: { value: WriterUser[] }
  answered: { value: string | null }
}

function person(name: string, fullName: string) {
  return { name, email: name, full_name: fullName, user_image: null, value: name, label: fullName }
}

const ANN = person('ann@x.com', 'Ann Lee')
const BEN = person('ben@x.com', 'Ben Roy')
const OTHER_ANN = person('ann2@x.com', 'Ann Lee')

let mounted: App | null = null

// jsdom lays nothing out, so has nothing to scroll
Element.prototype.scrollIntoView = () => {}

beforeEach(() => {
  people.isLoggedIn = true
  people.isHeld = false
  answered.value = ''
  people.known = { 'ann@x.com': 'Ann Lee', 'ben@x.com': 'Ben Roy' }
  people.later = {}
  people.letLookupsThrough = () => {}

  people.searched = []
  offered.value = [ANN, BEN]
})

afterEach(() => {
  mounted?.unmount()
  document.body.replaceChildren()
})

// A box holding `stored`, inside a form that records the keys reaching it
function openBox(stored = '') {
  const text = ref(stored)
  const keys: string[] = []
  const host = document.createElement('div')
  document.body.append(host)
  function keep(value: string) {
    text.value = value
  }

  const app = createApp(() =>
    h('div', { onKeydown: (event: KeyboardEvent) => keys.push(event.key) }, [
      h(MentionTextarea, { modelValue: text.value, 'onUpdate:modelValue': keep }),
    ]),
  )
  app.mount(host)
  mounted = app
  const box = host.querySelector('textarea')!
  box.focus()
  return { text, box, keys }
}

// Types as a browser does: the new value with the caret after what was typed
async function type(box: HTMLTextAreaElement, typed: string, at = box.value.length) {
  box.value = box.value.slice(0, at) + typed + box.value.slice(at)
  box.setSelectionRange(at + typed.length, at + typed.length)
  box.dispatchEvent(new Event('input'))
  await nextTick()
}

async function press(box: HTMLTextAreaElement, key: string, options: KeyboardEventInit = {}) {
  box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }))
  await nextTick()
  await nextTick()
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve))
  await nextTick()
}

function listed() {
  const list = document.querySelector('[role="listbox"]')
  return list && [...list.children].map((option) => option.textContent?.trim())
}

function chosen() {
  return document.querySelector('[aria-selected="true"]')?.textContent?.trim()
}

describe('picking a person with @ in a comment box', () => {
  it('lists people once @ starts a word, and narrows them as the name is typed', async () => {
    const { box } = openBox()

    await type(box, 'mail@x')
    const afterEmail = listed()
    await type(box, ' @')
    const afterAt = listed()
    await type(box, 'be')

    expect([afterEmail, afterAt, listed(), people.searched]).toEqual([
      null,
      ['Ann Lee', 'Ben Roy'],
      ['Ann Lee', 'Ben Roy'],
      ['', 'be'],
    ])
  })

  it('moves with the arrows and picks with Enter, showing the name and storing the mention', async () => {
    const { box, text, keys } = openBox('Hi ')

    await type(box, '@')
    await press(box, 'ArrowDown')
    const moved = chosen()
    await press(box, 'ArrowDown')
    await press(box, 'ArrowUp')
    await press(box, 'Enter')
    const [picked, stored, afterPick] = [box.value, text.value, listed()]
    await type(box, '@')

    expect([moved, picked, stored, afterPick, keys, chosen()]).toEqual([
      'Ben Roy',
      'Hi @Ben Roy ',
      'Hi @[ben@x.com] ',
      null,
      [],
      'Ann Lee',
    ])
  })

  it('picks with Tab or a click, and leaves the caret after the name', async () => {
    const { box, text } = openBox(' later')

    await type(box, '@an', 0)
    await press(box, 'Tab')
    await type(box, '@', 9)
    const [, second] = document.querySelectorAll('[role="option"]')
    second!.dispatchEvent(new MouseEvent('mousedown'))
    await nextTick()
    await nextTick()

    expect([box.value, text.value, box.selectionStart]).toEqual([
      '@Ann Lee @Ben Roy  later',
      '@[ann@x.com] @[ben@x.com]  later',
      18,
    ])
  })

  it('closes the list on Esc, keeping the box; Shift+Enter reaches the box, Enter with no one listed does not', async () => {
    const { box, keys } = openBox()

    await type(box, '@')
    await press(box, 'Escape')
    const afterEsc = listed()
    await type(box, 'b')
    await press(box, 'Enter', { shiftKey: true })
    offered.value = []
    await nextTick()
    const noOne = listed()
    await press(box, 'Enter')

    expect([afterEsc, box.value, keys, noOne]).toEqual([null, '@b', ['Enter'], ['No people found']])
  })

  it('picks no one with Enter while the list still shows an older answer, then picks once it arrives', async () => {
    const { box, text, keys } = openBox()
    await type(box, '@')
    people.isHeld = true

    await type(box, 'be')
    const list = document.querySelector('[role="listbox"]')
    const [busy, isFaded] = [
      list?.getAttribute('aria-busy'),
      list?.innerHTML.includes('opacity-60'),
    ]
    await press(box, 'Enter')
    const [held, heldKeys] = [box.value, [...keys]]
    answered.value = 'be'
    offered.value = [BEN]
    await nextTick()
    await press(box, 'Enter')

    expect([busy, isFaded, held, heldKeys, box.value, text.value, keys]).toEqual([
      'true',
      true,
      '@be',
      [],
      '@Ben Roy ',
      '@[ben@x.com] ',
      [],
    ])
  })

  it('picks the first row with Enter once the list narrows past the row moved to', async () => {
    const { box, text, keys } = openBox()

    await type(box, '@')
    await press(box, 'ArrowDown')
    offered.value = [BEN]
    await nextTick()
    await press(box, 'Enter')

    expect([text.value, keys]).toEqual(['@[ben@x.com] ', []])
  })

  it('offers no one to a guest, whose @ stays text', async () => {
    people.isLoggedIn = false
    const { box, text } = openBox()

    await type(box, '@an')

    expect([listed(), text.value, people.searched]).toEqual([null, '@an', []])
  })
})

describe('the names in a comment box', () => {
  it('tells apart two picked people with one name, both stored as mentions', async () => {
    offered.value = [ANN, OTHER_ANN]
    const { box, text } = openBox()

    await type(box, '@')
    await press(box, 'Enter')
    await type(box, '@')
    await press(box, 'ArrowDown')
    await press(box, 'Enter')

    expect([box.value, text.value]).toEqual([
      '@Ann Lee @ann2@x.com ',
      '@[ann@x.com] @[ann2@x.com] ',
    ])
  })

  it('mentions a picked person again when their name is typed back, and no one never picked', async () => {
    const { box, text } = openBox()

    await type(box, '@')
    await press(box, 'Enter')
    box.value = '@Ann L'
    await type(box, '')
    const cut = text.value
    await type(box, 'ee and @Ben Roy')

    expect([cut, text.value]).toEqual(['@Ann L', '@[ann@x.com] and @Ben Roy'])
  })

  it('shows a stored text by name, and edits around its mentions', async () => {
    const { box, text } = openBox('@[ann@x.com] and @[ben@x.com]')
    const shown = box.value

    await type(box, ' hi', 8)

    expect([shown, box.value, text.value]).toEqual([
      '@Ann Lee and @Ben Roy',
      '@Ann Lee hi and @Ben Roy',
      '@[ann@x.com] hi and @[ben@x.com]',
    ])
  })

  it('shows someone not known yet by user id, never the stored form, then by name once known', async () => {
    people.later = { 'cy@x.com': 'Cy Ng' }
    const { box, text } = openBox('Ask @[cy@x.com]')
    const loading = box.value

    people.letLookupsThrough()
    await settled()

    expect([loading, box.value, text.value]).toEqual([
      'Ask @cy@x.com',
      'Ask @Cy Ng',
      'Ask @[cy@x.com]',
    ])
  })

  it('keeps the user id and the mention when typing starts before the name is known', async () => {
    people.later = { 'cy@x.com': 'Cy Ng' }
    const { box, text } = openBox('Ask @[cy@x.com]')

    await type(box, ' now')
    people.letLookupsThrough()
    await settled()

    expect([box.value, text.value]).toEqual(['Ask @cy@x.com now', 'Ask @[cy@x.com] now'])
  })
})

describe('the caret while the stored text changes under the box', () => {
  it('stays where the person types: after a mention, between two, and before one', async () => {
    const { box } = openBox('@[ann@x.com]@[ben@x.com]')
    const carets: number[] = []

    for (const [typed, at] of [
      [' ', 8],
      ['x', 9],
      ['Hi ', 0],
    ] as const) {
      await type(box, typed, at)
      await nextTick()
      carets.push(box.selectionStart)
    }

    expect([box.value, carets]).toEqual(['Hi @Ann Lee x@Ben Roy', [9, 10, 3]])
  })

  it('keeps a composition next to a mention whole, and Enter that ends it picks no one', async () => {
    const { box, text } = openBox('@[ann@x.com] ')
    await type(box, '@')

    box.dispatchEvent(new CompositionEvent('compositionstart'))
    for (const step of ['n', 'に', 'にほ', '日本']) {
      box.value = `@Ann Lee @${step}`
      const end = box.value.length
      box.setSelectionRange(end, end)
      box.dispatchEvent(new InputEvent('input', { isComposing: true }))
      await nextTick()
    }

    await press(box, 'Enter', { isComposing: true })
    box.dispatchEvent(new CompositionEvent('compositionend', { data: '日本' }))

    expect([box.value, box.selectionStart, text.value]).toEqual([
      '@Ann Lee @日本',
      12,
      '@[ann@x.com] @日本',
    ])
  })

  it('picks no one with an Enter sent as the composition key code', async () => {
    const { box, text } = openBox()
    await type(box, '@')

    await press(box, 'Enter', { keyCode: 229 })

    expect([box.value, text.value, listed()]).toEqual(['@', '@', ['Ann Lee', 'Ben Roy']])
  })
})
