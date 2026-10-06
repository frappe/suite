import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'

vi.hoisted(() => {
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.stubEnv('DEV', false)
})

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  const blank = { render: () => null }
  return {
    Avatar: blank,
    Badge: blank,
    Button: define({
      props: { label: String },
      emits: ['click'],
      setup:
        (props, { emit }) =>
        () =>
          render('button', { onClick: () => emit('click') }, props.label),
    }),
    Skeleton: blank,
    TextInput: blank,
    toast: { info: () => {}, warning: () => {}, error: () => {} },
  }
})

vi.mock('@/apps/drive', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  return {
    DriveDocumentHeader: define({
      emits: ['update:panel'],
      setup:
        (_, { emit }) =>
        () =>
          render('button', {
            'data-open-versions': '',
            onClick: () => emit('update:panel', 'versions'),
          }),
    }),
    DriveCommentAuthor: define({ setup: () => () => null }),
    formatDriveDateTime: (await import('@/apps/drive/files/internal/format')).formatDate,
    GUEST_NAME_LIMIT: 140,
    useDriveGuestName: () => ({
      shown: state(false),
      text: state(''),
      atLimit: state(false),
      maxLength: 140,
      take: () => '',
    }),
  }
})

const rooms = vi.hoisted(() => ({ next: null as object | null }))

vi.mock('@/apps/writer/collab', () => ({
  FIELD: 'default',
  openWriterRoom: async () => (rooms.next ? { state: 'live', room: rooms.next } : { state: 'off' }),
  withinTenSeconds: (promise: Promise<void>) => promise,
}))

vi.mock('@/apps/writer/components/NonCollabEditor.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    default: define({
      props: { editable: Boolean },
      setup:
        (props, { slots }) =>
        () => [
          slots.toolbar?.(),
          render('div', {
            'data-editor': '',
            'data-editable': props.editable,
            style: slots.cover && { display: 'none' },
          }),
          slots.cover?.(),
          slots.aside?.(),
        ],
    }),
  }
})

vi.mock('./writerDocument', async (importOriginal) => {
  const original = await importOriginal<typeof import('./writerDocument')>()
  const write = () => ({ loading: false, error: null, submit: async () => null })
  return {
    ...original,
    createWriterDocument: () =>
      reactive({
        doc: { name: 'content-1', collab: 0, settings: {} },
        saveDoc: write(),
        saveHtml: write(),
        saveComments: write(),
      }),
  }
})

vi.mock('@/apps/writer/components/CollabTextEditor.vue', async () => {
  const { defineComponent: define, h: render, onBeforeUnmount, shallowRef } = await import('vue')
  const { Editor, EditorContent } = await import('@tiptap/vue-3')
  const { default: Document } = await import('@tiptap/extension-document')
  const { default: Paragraph } = await import('@tiptap/extension-paragraph')
  const { default: Text } = await import('@tiptap/extension-text')
  const { default: Collaboration } = await import('@tiptap/extension-collaboration')
  return {
    default: define({
      props: { room: Object },
      setup(props, { expose, slots }) {
        const editor = shallowRef(
          new Editor({
            extensions: [
              Document,
              Paragraph,
              Text,
              Collaboration.configure({ document: (props.room as { doc: Y.Doc }).doc }),
            ],
          }),
        )
        expose({ editor })
        onBeforeUnmount(() => editor.value.destroy())
        return () => [
          slots.toolbar?.(),
          render('div', { 'data-editor': '', style: slots.cover && { display: 'none' } }, [
            render(EditorContent, { editor: editor.value }),
          ]),
          slots.cover?.(),
          slots.aside?.(),
        ]
      },
    }),
  }
})
vi.mock('@/apps/writer/components/TextEditor.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/writer/components/UsersBar.vue', () => ({ default: { render: () => null } }))
vi.mock('./WriterDocumentMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('./VersionPreview.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    default: define({
      props: { seq: Number },
      setup: (props) => () => render('div', { 'data-preview': props.seq }),
    }),
  }
})

const { default: WriterSurface } = await import('./WriterSurface.vue')
const { watchBuild } = await import('@/platform/build')

async function serverMinBuilds(minBuilds: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('{}', { headers: { 'X-Suite-Min-Builds': JSON.stringify(minBuilds) } }),
    ),
  )
  watchBuild()
  await window.fetch('/api/method/ping')
}

async function openedSurface(versions?: DocumentSession['versions']) {
  const session = {
    nodeId: 'node-1',
    title: ref('Quarterly plan'),
    state: ref('Active'),
    access: ref({ role: 50 }),
    refreshAccess: async () => {},
    versions,
  } as unknown as DocumentSession
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/d/:node', component: { render: () => h(WriterSurface, { session }) } }],
  })
  await router.push('/d/node-1')
  await router.isReady()
  const root = document.createElement('div')
  document.body.append(root)
  createApp(defineComponent({ setup: () => () => h(RouterView) }))
    .use(router)
    .mount(root)
  await vi.waitFor(() => expect(root.querySelector('[data-editor]')).not.toBeNull())
  await nextTick()
  return root
}

async function openedEditor() {
  return (await openedSurface()).querySelector('[data-editor]')!
}

function buttonLabelled(root: Element, label: string) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent === label)
}

afterEach(() => {
  document.body.innerHTML = ''
  rooms.next = null
})

function liveRoom() {
  const room = {
    doc: new Y.Doc(),
    canWrite: true,
    blocked: null,
    paused: null,
    saveState: 'clean',
    unsent: 0,
    onDevice: true,
    onChange: () => () => {},
    flush: async () => {},
    close: vi.fn(async () => {}),
  }
  rooms.next = room
  return room
}

async function previewAndReturn(root: Element, during: () => void | Promise<void> = () => {}) {
  root.querySelector<HTMLElement>('[data-open-versions]')!.click()
  await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
  ;[...root.querySelectorAll<HTMLElement>('aside button')]
    .find((button) => button.textContent?.startsWith('Before review'))!
    .click()
  await nextTick()
  expect(root.querySelector('[data-preview]')).not.toBeNull()
  await during()
  buttonLabelled(root, 'Back to current')!.click()
  await nextTick()
}

const oneVersion = {
  list: async () => ({
    rows: [{ seq: 3, kind: 'named', label: 'Before review' }],
    next_cursor: null,
  }),
} as unknown as DocumentSession['versions']

const shownText = (root: Element) => root.querySelector('[data-editor] .ProseMirror')!.textContent

describe('Writer surface', () => {
  it('edits a document while the tab meets the minimum Writer build', async () => {
    await serverMinBuilds({ writer: '100' })

    expect((await openedEditor()).getAttribute('data-editable')).toBe('true')
  })

  it('opens a document read-only in a tab older than the minimum Writer build', async () => {
    await serverMinBuilds({ writer: '150' })

    expect((await openedEditor()).getAttribute('data-editable')).toBe('false')
  })

  it('shows the next page of versions after Load more', async () => {
    const pages: Record<string, unknown> = {
      first: { rows: [{ seq: 2, kind: 'named', label: 'Draft two' }], next_cursor: 'page-2' },
      'page-2': { rows: [{ seq: 1, kind: 'named', label: 'Draft one' }], next_cursor: null },
    }
    const list = vi.fn(async (cursor?: string) => pages[cursor ?? 'first'])
    const root = await openedSurface({ list } as unknown as DocumentSession['versions'])

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Draft two'))
    expect(root.textContent).not.toContain('Draft one')

    buttonLabelled(root, 'Load more')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Draft one'))
    expect(root.textContent).toContain('Draft two')
    expect(buttonLabelled(root, 'Load more')).toBeUndefined()
  })

  it('shows who took a version and its exact date and time', async () => {
    vi.stubEnv('TZ', 'UTC')
    const list = async () => ({
      rows: [
        {
          seq: 3,
          kind: 'named',
          label: 'Before review',
          actor: 'ana@example.com',
          creation: '2025-03-04T10:41:00Z',
        },
      ],
      next_cursor: null,
    })
    const root = await openedSurface({ list } as unknown as DocumentSession['versions'])

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    const row = [...root.querySelectorAll<HTMLElement>('aside button')].find((button) =>
      button.textContent?.startsWith('Before review'),
    )!
    expect(row.textContent).toMatch(
      /ana@example\.com · (Mar 4, 2025|4 Mar 2025), 10:41(\s(AM|am))?$/,
    )
    expect(row.textContent).not.toContain('2025-03-04T10:41:00Z')
    vi.unstubAllEnvs()
  })

  it('shows a version in place of the editor until Back to current', async () => {
    const list = vi.fn(async () => ({
      rows: [{ seq: 3, kind: 'named', label: 'Before review' }],
      next_cursor: null,
    }))
    const root = await openedSurface({ list } as unknown as DocumentSession['versions'])
    const editorShown = () =>
      root.querySelector<HTMLElement>('[data-editor]')!.style.display !== 'none'

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    ;[...root.querySelectorAll<HTMLElement>('aside button')]
      .find((button) => button.textContent?.startsWith('Before review'))!
      .click()
    await nextTick()

    const preview = root.querySelector<HTMLElement>('[data-preview]')!
    expect(preview.getAttribute('data-preview')).toBe('3')
    expect(editorShown()).toBe(false)

    buttonLabelled(root, 'Back to current')!.click()
    await nextTick()
    expect(root.querySelector('[data-preview]')).toBeNull()
    expect(editorShown()).toBe(true)
    expect(document.activeElement?.textContent).toMatch(/^Before review/)
  })

  it('shows edits made in another tab while a version was previewed', async () => {
    const room = liveRoom()
    const root = await openedSurface(oneVersion)
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(room.doc))

    await previewAndReturn(root, () => {
      const paragraph = new Y.XmlElement('paragraph')
      paragraph.insert(0, [new Y.XmlText('Typed in the other tab')])
      other.getXmlFragment('default').insert(0, [paragraph])
      Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(room.doc)))
    })

    expect(shownText(root)).toContain('Typed in the other tab')
    expect(room.close).not.toHaveBeenCalled()
  })

  it('keeps text typed just before a preview, undoable and on its way to other tabs', async () => {
    const room = liveRoom()
    const root = await openedSurface(oneVersion)
    const editor = () =>
      (
        root.querySelector('[data-editor] .ProseMirror') as HTMLElement & {
          editor: import('@tiptap/core').Editor
        }
      ).editor

    editor().commands.insertContent('Typed here first')
    await previewAndReturn(root)

    expect(shownText(root)).toContain('Typed here first')
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(room.doc))
    expect(other.getXmlFragment('default').toString()).toContain('Typed here first')
    editor().commands.undo()
    expect(shownText(root)).not.toContain('Typed here first')
  })
})
