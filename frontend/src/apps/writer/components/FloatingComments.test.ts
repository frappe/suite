import { renderToString } from '@vue/server-renderer'
import { createApp, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('frappe-ui', () => {
  const Stub = { template: '<span><slot /></span>' }
  return {
    Avatar: Stub,
    Button: { template: '<button><slot name="prefix" /><slot /></button>' },
    Dropdown: Stub,
    onOutsideClickDirective: {},
  }
})

vi.mock('@/boot/session', () => ({
  useSessionStore: () => ({ user: 'Administrator' }),
}))

vi.mock('@/apps/writer/composables/useUsers', () => ({
  useUsers: () => ({
    getUser: () => ({ full_name: 'Administrator', user_image: null }),
  }),
}))

vi.mock('@/apps/writer/extensions/comments', () => ({
  getEditorPos: () => 0,
  rebuild: vi.fn(),
}))

vi.mock('@/apps/writer/utils/', () => ({
  dynamicList: (items: unknown[]) => items.filter(Boolean),
}))

vi.mock('@vueuse/core', () => ({
  useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn,
  useEventListener: vi.fn(),
}))

vi.mock('./CommentEditor.vue', () => ({
  default: { template: '<span class="comment-editor-stub" />' },
}))

import FloatingComments from './FloatingComments.vue'

const renderComment = async (
  top: number | null | undefined,
  overrides: Record<string, unknown> = {},
) => {
  Object.assign(globalThis, { store: {} })

  const comment = {
    id: 'comment-1',
    top,
    owner: 'Administrator',
    creation: 0,
    text: 'Test comment',
    replies: [],
    resolved: false,
    anchor: {},
    ...overrides,
  }
  const map = new Map([[comment.id, comment]])
  const yComments = {
    _map: map,
    forEach: map.forEach.bind(map),
    observe: vi.fn(),
    unobserve: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }
  const editorDom = new EventTarget()
  const editor = {
    state: { doc: { descendants: vi.fn() } },
    view: { dom: editorDom },
    on: vi.fn(),
  }

  return renderToString(
    h(FloatingComments, {
      editor,
      file: { doc: { write: true } },
      showComments: true,
      showResolved: true,
      showUnanchored: false,
      yComments,
    }),
  )
}

describe('FloatingComments positioning', () => {
  it('renders a zero-positioned card and keeps the sidebar expanded', async () => {
    const html = await renderComment(0)

    expect(html).toContain('w-72 shrink-0 px-5')
    expect(html).toContain('opacity-100 pointer-events-auto')
    expect(html).toContain('style="top:0px;"')
  })

  it.each([
    ['null', null, {}],
    ['undefined', undefined, {}],
    ['detached', null, { detached: 1 }],
    ['remote new', null, { new: true, owner: 'another@example.com' }],
  ])('keeps %s comments hidden', async (_label, top, overrides) => {
    const html = await renderComment(top, overrides)

    expect(html).toContain('w-0')
    expect(html).toContain('opacity-0 pointer-events-none')
    expect(html).not.toContain('style="top:')
  })

  it('stacks from zero while detached and remote-new cards stay hidden', async () => {
    Object.assign(globalThis, { store: {} })
    document.body.innerHTML = `
      <div id="app"></div>
      <span data-comment-name="first"></span>
      <span data-comment-name="second"></span>
    `

    const firstAnchor = document.querySelector('[data-comment-name="first"]')!
    const secondAnchor = document.querySelector('[data-comment-name="second"]')!
    firstAnchor.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    secondAnchor.getBoundingClientRect = () => ({ top: 10 }) as DOMRect

    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight',
    )
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return this.id?.startsWith('comment-') ? 88 : 0
      },
    })

    const comments = [
      {
        id: 'first',
        owner: 'Administrator',
        creation: 0,
        text: 'First',
        replies: [],
        resolved: false,
        anchor: {},
        anchorText: 'First',
      },
      {
        id: 'second',
        owner: 'Administrator',
        creation: 1,
        text: 'Second',
        replies: [],
        resolved: false,
        anchor: {},
        anchorText: 'Second',
      },
      {
        id: 'detached',
        owner: 'Administrator',
        creation: 2,
        text: 'Detached',
        replies: [],
        resolved: false,
        anchor: {},
        anchorText: 'Detached',
      },
      {
        id: 'remote-new',
        owner: 'another@example.com',
        creation: 3,
        text: 'Remote new',
        replies: [],
        resolved: false,
        anchor: {},
        anchorText: 'Remote new',
        new: true,
      },
    ]
    const map = new Map(comments.map((comment) => [comment.id, comment]))
    let updateComments: (() => void) | undefined
    const yComments = {
      _map: map,
      forEach: map.forEach.bind(map),
      observe: vi.fn((callback: () => void) => {
        updateComments = callback
      }),
      unobserve: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    }
    const editor = {
      state: { doc: { descendants: vi.fn() } },
      view: { dom: new EventTarget() },
      on: vi.fn(),
    }
    const app = createApp(FloatingComments, {
      editor,
      file: { doc: { write: true } },
      showComments: true,
      showResolved: true,
      showUnanchored: false,
      yComments,
    })

    try {
      app.mount(document.querySelector('#app')!)
      await nextTick()
      await nextTick()

      expect((document.querySelector('#comment-first') as HTMLElement).style.top).toBe(
        '0px',
      )
      expect((document.querySelector('#comment-second') as HTMLElement).style.top).toBe(
        '100px',
      )
      for (const id of ['detached', 'remote-new']) {
        const card = document.querySelector(`#comment-${id}`) as HTMLElement
        expect(card.style.top).toBe('')
        expect(card.className).toContain('opacity-0 pointer-events-none')
      }
      expect(document.querySelector('#app > div')?.className).toContain('w-72')
    } finally {
      comments[3].new = false
      updateComments?.()
      await nextTick()
      app.unmount()
      if (originalOffsetHeight)
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetHeight',
          originalOffsetHeight,
        )
      else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight
      document.body.innerHTML = ''
    }
  })
})
