import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'

import type {
  DocumentComments,
  DocumentPanel,
  DocumentSession,
  DocumentVersion,
} from '@/apps/drive'
import { translationPlugin } from '@/platform/translation'

// The test build stubs frappe-ui; the shortcut registry is the real one, and the panel's
// buttons and boxes are real elements that take focus
vi.mock('frappe-ui', async (original) => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  function box(tag: 'input' | 'textarea') {
    return define({
      props: { modelValue: String },
      setup(props, { expose }) {
        const field = state<HTMLElement | null>(null)
        expose({ focus: () => field.value?.focus() })
        return () => render(tag, { ref: field, value: props.modelValue })
      },
    })
  }

  return {
    ...(await original<Record<string, unknown>>()),
    useKeyboardShortcut: (
      await import('../../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')
    ).useKeyboardShortcut,
    Button: define({
      props: { label: String },
      setup:
        (props, { attrs, slots }) =>
        () =>
          render('button', { ...attrs, type: 'button' }, slots.default?.() ?? props.label),
    }),
    Dropdown: define({
      setup:
        (_props, { slots }) =>
        () =>
          render('div', slots.default?.()),
    }),
    Tooltip: define({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
    TextInput: box('input'),
    Textarea: box('textarea'),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  }
})
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => undefined } }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { DriveDocumentSidePanel } = await import('@/apps/drive')
const { useShortcuts } = await import('./useShortcuts')
const { activeElementIds, focusElementId } = await import('@/apps/slides/stores/element')
const { slides, slideIndex } = await import('@/apps/slides/stores/slide')
const { setCommandHistory } = await import('@/apps/slides/stores/historyMeta')
const { useCommandHistory } = await import('./useCommandHistory')

// the real order also navigates, which needs the whole editor
const historyMeta = {
  actions: {},
  actionOrder: {
    execute: { removeElement: ['execute'], editElement: ['execute'], batch: ['execute'] },
    undo: { removeElement: ['undo'], editElement: ['undo'], batch: ['undo'] },
  },
}

const VERSION = fromPartial<DocumentVersion>({ seq: 3, label: 'Draft', creation: '2026-11-01' })

let app: App | null = null
const wentBack: number[] = []

// The canvas's shortcuts beside Drive's real side panel, open on `panel`
async function openBeside(panel: DocumentPanel, previewedVersion: DocumentVersion | null = null) {
  const session = fromPartial<DocumentSession>({
    nodeId: 'presentation-1',
    comments: { list: async () => [] },
    versions: { list: async () => ({ rows: [VERSION], next_cursor: null }) },
  })
  const comments = fromPartial<DocumentComments>({
    threads: ref([]),
    readAt: ref(1),
    refresh: async () => {},
    actions: {},
    drafts: {
      drafts: ref([{ clientId: 'draft-1', anchor: 'document', text: '', isSent: false }]),
      quoteOf: () => '',
      discard: () => {},
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp(
    defineComponent({
      setup() {
        useShortcuts(ref(false), ref(false))
        return () =>
          h(DriveDocumentSidePanel, {
            panel,
            previewedVersion,
            session,
            canComment: true,
            canEditDocument: true,
            canShare: false,
            canRestoreVersion: true,
            canSaveVersion: true,
            isRestoringVersion: false,
            comments,
            places: null,
            noun: 'presentation',
            saveFirst: async () => {},
            onBack: () => wentBack.push(1),
          })
      },
    }),
  )
  app.use(translationPlugin).mount(host)
  await vi.waitFor(() =>
    expect(document.querySelector('[data-document-side-panel]')).not.toBeNull(),
  )
  await nextTick()
}

// One key pressed where focus is, bubbling as a browser sends it
function press(key: string, on: Element = document.activeElement ?? document.body) {
  on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

// The ids of the elements on the one slide
function elementIds() {
  const [slide] = fromAny<{ elements: { id: string }[] }[], unknown>(slides.value)
  return slide.elements.map((element) => element.id)
}

function panelButton() {
  const button = document.querySelector<HTMLButtonElement>('[data-document-side-panel] button')
  button!.focus()
  return button!
}

describe('keys in the side panel beside the canvas', () => {
  beforeEach(() => {
    wentBack.length = 0
    slides.value = fromPartial([
      {
        clientId: 'slide-1',
        background: '#ffffffff',
        elements: [{ id: 'element-1', type: 'text', content: '<p>Hello</p>' }],
      },
    ])
    slideIndex.value = 0
    activeElementIds.value = ['element-1']
    focusElementId.value = null
    setCommandHistory(useCommandHistory(slides, historyMeta))
  })

  afterEach(() => {
    app?.unmount()
    app = null
    document.body.replaceChildren()
  })

  it('deletes the selected element on Delete from the canvas', async () => {
    await openBeside('versions')
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    press('Delete', document.body)

    expect(elementIds()).toEqual([])
  })

  it('keeps the selected element on Delete or Backspace from a Versions button', async () => {
    await openBeside('versions')

    press('Delete', panelButton())
    press('Backspace', panelButton())

    expect(elementIds()).toEqual(['element-1'])
  })

  it('keeps the selection and its text when typing in a comment box', async () => {
    await openBeside('comments')
    const box = document.querySelector<HTMLTextAreaElement>('[data-document-side-panel] textarea')
    box!.focus()

    press('Backspace')
    press('Escape')
    expect(document.activeElement).toBe(box)
    press('h', panelButton())

    expect([elementIds(), activeElementIds.value, focusElementId.value]).toEqual([
      ['element-1'],
      ['element-1'],
      null,
    ])
  })

  it('still goes back from a shown version on Escape from a panel button', async () => {
    await openBeside('versions', VERSION)

    press('Escape', panelButton())

    expect([wentBack.length, activeElementIds.value]).toEqual([1, ['element-1']])
  })
})
