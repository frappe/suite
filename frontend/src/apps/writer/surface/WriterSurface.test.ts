import type { Editor as TiptapEditor } from '@tiptap/core'
import { toast } from 'frappe-ui'
import { fromUint8Array } from 'js-base64'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { DocumentSession, DocumentThread } from '@/apps/drive'
import { encodeAnchor } from '@/apps/writer/collab/anchors'

type Versions = DocumentSession['versions']
type Comments = DocumentSession['comments']

// The editor element's tiptap editor, as tiptap hangs it on the element
type EditorElement = HTMLElement & { editor: TiptapEditor }

vi.hoisted(() => {
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.stubEnv('DEV', false)
})

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  const emptyComponent = { render: () => null }
  return {
    Avatar: emptyComponent,
    Badge: emptyComponent,
    // The real old editor's autosave runs at once
    debounce: (run: () => void) => run,
    Dropdown: define({
      props: { options: Array as () => { label: string; onClick: () => void }[] },
      setup: (props) => () =>
        render(
          'div',
          { 'data-menu': '' },
          props.options?.map((option) =>
            render('button', { onClick: option.onClick }, option.label),
          ),
        ),
    }),
    Button: define({
      props: { label: String },
      emits: ['click'],
      setup:
        (props, { emit }) =>
        () =>
          render('button', { onClick: () => emit('click') }, props.label),
    }),
    Skeleton: emptyComponent,
    Textarea: define({
      setup(_, { expose }) {
        const box = state<HTMLTextAreaElement | null>(null)
        expose({ focus: () => box.value?.focus() })
        return () => render('textarea', { ref: box })
      },
    }),
    TextInput: define({
      props: { modelValue: String },
      emits: ['update:modelValue'],
      setup(props, { emit, expose }) {
        const input = state<HTMLInputElement | null>(null)
        expose({ focus: () => input.value?.focus() })
        function write(event: Event) {
          emit('update:modelValue', (event.target as HTMLInputElement).value)
        }

        return () => render('input', { ref: input, value: props.modelValue, onInput: write })
      },
    }),
    Tooltip: define({
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
    dialog: { confirm: (options: { onConfirm: () => void }) => options.onConfirm() },
    toast: {
      info: () => {},
      success: () => {},
      warning: () => {},
      error: () => {},
    },
  }
})

vi.mock('@/apps/drive', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  return {
    DriveDocumentHeader: define({
      emits: ['update:panel'],
      setup: (_, { emit, slots }) => {
        const openVersions = {
          'data-open-versions': '',
          onClick: () => emit('update:panel', 'versions'),
        }
        const openComments = {
          'data-open-comments': '',
          onClick: () => emit('update:panel', 'comments'),
        }
        return () => [
          render('button', openVersions),
          render('button', openComments),
          slots.actions?.(),
        ]
      },
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
// The body the server holds for a document edited without collaboration
const stored = vi.hoisted(() => ({ html: '', content: '', collab: 0, isRefusingSaves: false }))
// The old editor's hold on its device store, which it gives up once a refused save is kept
const oldEditor = vi.hoisted(() => ({ forgetStoredEdits: vi.fn(async () => {}), isFrozen: false }))
// Mounts the real editors, over a stand-in for CoreEditor, in place of the fakes below
const realEditors = vi.hoisted(() => ({ isOn: false }))

// jsdom lays nothing out, so has nothing to scroll
Element.prototype.scrollIntoView = () => {}

vi.mock('y-webrtc', async () => {
  const { Awareness: MockAwareness } = await import('y-protocols/awareness')
  class WebrtcProvider {
    awareness: InstanceType<typeof MockAwareness>
    room = null
    disconnect = vi.fn()
    destroy = vi.fn()

    constructor(_room: string, doc: Y.Doc) {
      this.awareness = new MockAwareness(doc)
    }
  }

  return { WebrtcProvider }
})
vi.mock('@/apps/writer/components/CoreEditor.vue', async () => {
  const { defineComponent: define, h: render, onBeforeUnmount, shallowRef } = await import('vue')
  const { Editor, EditorContent } = await import('@tiptap/vue-3')
  const { default: Document } = await import('@tiptap/extension-document')
  const { default: Paragraph } = await import('@tiptap/extension-paragraph')
  const { default: Text } = await import('@tiptap/extension-text')
  return {
    default: define({
      props: { extensions: Array },
      setup(props, { expose, slots }) {
        const extensions = [Document, Paragraph, Text, ...(props.extensions as [])]
        const editor = shallowRef(new Editor({ extensions }))
        expose({ editor })
        onBeforeUnmount(() => editor.value.destroy())
        return () => [
          render('div', { 'data-editor': '', id: 'editor-scroll-container' }, [
            render(EditorContent, { editor: editor.value }),
          ]),
          slots.aside?.(),
        ]
      },
    }),
  }
})

vi.mock('@/apps/writer/collab', () => ({
  BODY_FIELD: 'default',
  openWriterRoom: async () => (rooms.next ? { state: 'live', room: rooms.next } : { state: 'off' }),
  writerDeviceStore: async () => null,
}))

vi.mock('@/apps/writer/components/NonCollabEditor.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    default: define({
      props: { editable: Boolean, document: Object },
      setup: (props, { slots }) => {
        // Like the editor, the body is read once when it mounts
        const body = (props.document as { doc: { html: string } }).doc.html
        return () => {
          const toolbar = slots.toolbar?.()
          const editorBox = {
            'data-editor': '',
            'data-editable': props.editable,
            style: slots.cover && { display: 'none' },
          }
          return [toolbar, render('div', editorBox, body), slots.cover?.(), slots.aside?.()]
        }
      },
    }),
  }
})

vi.mock('./writerDocument', async (importOriginal) => {
  const original = await importOriginal<typeof import('./writerDocument')>()
  const idleWrite = () => ({
    loading: false,
    error: null,
    submit: async () => null,
    run: async () => {
      if (stored.isRefusingSaves) {
        throw Object.assign(new Error('CONFLICT'), { type: 'LoggedDocumentConflict' })
      }

      return null
    },
  })
  const writerDocument = () => {
    function read() {
      const { collab, html, content } = stored
      return { name: 'content-1', collab, settings: {}, html, content }
    }

    const resources = reactive({
      doc: read(),
      saveDoc: idleWrite(),
      saveHtml: idleWrite(),
      saveComments: idleWrite(),
      reload: async () => {
        resources.doc = read()
      },
    })
    return resources
  }

  return {
    ...original,
    createWriterDocument: writerDocument,
  }
})

vi.mock('@/apps/writer/components/CollabTextEditor.vue', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/apps/writer/components/CollabTextEditor.vue')>()
  const {
    defineComponent: define,
    h: render,
    onBeforeUnmount,
    ref: mockRef,
    shallowRef,
  } = await import('vue')
  const { Editor, EditorContent } = await import('@tiptap/vue-3')
  const { default: Document } = await import('@tiptap/extension-document')
  const { default: Paragraph } = await import('@tiptap/extension-paragraph')
  const { default: Text } = await import('@tiptap/extension-text')
  const { default: Collaboration } = await import('@tiptap/extension-collaboration')
  const fake = define({
    props: { room: Object },
    setup(props, { expose, slots }) {
      const room = props.room as { doc: Y.Doc }
      const isFrozen = mockRef(false)
      function onFrozen() {
        isFrozen.value = true
      }

      const ySyncOptions = { onUnplaceable: onFrozen }
      const collaboration = Collaboration.configure({ document: room.doc, ySyncOptions })
      const extensions = [Document, Paragraph, Text, collaboration]
      const editor = shallowRef(new Editor({ extensions }))
      expose({ editor, isFrozen })
      onBeforeUnmount(() => editor.value.destroy())

      return () => {
        const toolbar = slots.toolbar?.()
        const editorBox = {
          'data-editor': '',
          style: slots.cover && { display: 'none' },
        }
        const content = render(EditorContent, { editor: editor.value })
        return [toolbar, render('div', editorBox, [content]), slots.cover?.(), slots.aside?.()]
      }
    },
  })
  // Read where the surface renders it, so each test picks the real editor or the fake
  return {
    get default() {
      if (realEditors.isOn) {
        return real.default
      }

      return fake
    },
  }
})
vi.mock('@/apps/writer/components/TextEditor.vue', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/apps/writer/components/TextEditor.vue')>()
  const { defineComponent: define, h: render, onMounted, ref: mockRef } = await import('vue')
  const fake = define({
    props: { document: Object },
    setup(props, { expose }) {
      const editor = { getHTML: () => '<p>Old editor line</p>', setEditable: () => {} }
      const isFrozen = mockRef(oldEditor.isFrozen)
      expose({ editor, forgetStoredEdits: oldEditor.forgetStoredEdits, isFrozen })
      // Its first autosave, which the server refuses for a logged document
      onMounted(() => {
        const document = props.document as {
          saveDoc: { run: (input: object) => Promise<unknown> }
        }
        void document.saveDoc.run({}).catch(() => {})
      })
      return () => render('div', { 'data-editor': '' })
    },
  })
  return {
    get default() {
      if (realEditors.isOn) {
        return real.default
      }

      return fake
    },
  }
})
vi.mock('@/apps/writer/components/UsersBar.vue', () => ({ default: { render: () => null } }))
vi.mock('./WriterDocumentMenu.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    default: define({
      emits: ['saveVersion'],
      setup:
        (_, { emit }) =>
        () =>
          render('button', { 'data-save-version': '', onClick: () => emit('saveVersion') }),
    }),
  }
})
vi.mock('@/apps/writer/composables/useUsers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/writer/composables/useUsers')>()),
  fullName: (user: string) => user,
}))
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
const { discardCopy, keepPageCopy, listCopies } = await import('@/apps/writer/recovery/copies')

async function serverMinBuilds(minBuilds: Record<string, string>, body = '{}') {
  const headers = { 'X-Suite-Min-Builds': JSON.stringify(minBuilds) }
  async function respond() {
    return new Response(body, { headers })
  }

  vi.stubGlobal('fetch', vi.fn(respond))
  watchBuild()
  await window.fetch('/api/method/ping')
}

async function openedSurface(
  versions?: Versions,
  path = '/d/node-1',
  comments?: Comments,
  access = ref({ role: 50 }),
  state = ref('Active'),
) {
  const session = {
    nodeId: 'node-1',
    comments,
    title: ref('Quarterly plan'),
    state,
    access,
    refreshAccess: async () => {},
    versions,
    credentials: {
      context: {},
      heldContext: {},
      fetch,
      fetchHeld: fetch,
      group: () => [],
    },
  } as unknown as DocumentSession
  const surface = { render: () => h(WriterSurface, { session }) }
  const routes = [{ path: '/d/:node', component: surface }]
  const history = createMemoryHistory()
  const router = createRouter({ history, routes })
  await router.push(path)
  await router.isReady()

  const root = document.createElement('div')
  document.body.append(root)
  const shell = defineComponent({ setup: () => () => h(RouterView) })
  createApp(shell).use(router).mount(root)
  await vi.waitFor(() => expect(root.querySelector('[data-editor]')).not.toBeNull())
  await nextTick()
  return root
}

async function openedEditor() {
  const root = await openedSurface()
  return root.querySelector('[data-editor]')!
}

function buttonLabelled(root: Element, label: string) {
  return [...root.querySelectorAll('button')].find(
    (button) => button.textContent === label || button.getAttribute('aria-label') === label,
  )
}

// The row in the versions list whose text starts with `label`
function versionRow(root: Element, label: string) {
  const rows = [...root.querySelectorAll<HTMLElement>('aside button')]
  return rows.find((button) => button.textContent?.trim().startsWith(label))!
}

afterEach(() => {
  document.body.innerHTML = ''
  rooms.next = null
  stored.html = ''
  stored.collab = 0
  stored.isRefusingSaves = false
  oldEditor.forgetStoredEdits.mockClear()
  oldEditor.isFrozen = false
  realEditors.isOn = false
  stored.content = ''
  vi.restoreAllMocks()
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
    loseAccess: vi.fn(async () => {}),
    regainAccess: vi.fn(async () => {}),
  }
  rooms.next = room
  return room
}

async function previewAndReturn(root: Element, during: () => void | Promise<void> = () => {}) {
  root.querySelector<HTMLElement>('[data-open-versions]')!.click()
  await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
  versionRow(root, 'Before review').click()
  await nextTick()
  expect(root.querySelector('[data-preview]')).not.toBeNull()
  await during()
  versionRow(root, 'Current version').click()
  await nextTick()
}

const oneVersion = {
  list: async () => ({
    rows: [{ seq: 3, kind: 'named', label: 'Before review' }],
    next_cursor: null,
  }),
} as unknown as Versions

function statusWith(root: Element, text: string) {
  const statuses = [...root.querySelectorAll<HTMLElement>('[role="status"]')]
  return statuses.find((status) => status.textContent?.includes(text))
}

// A strip's classes without its colours
function shapeOf(strip: Element) {
  const colours = /^(bg-surface-|text-ink-|border-outline-)/
  return [...strip.classList].filter((name) => !colours.test(name)).sort()
}

function recoveryBanner(root: Element) {
  const statuses = [...root.querySelectorAll<HTMLElement>('[role="status"]')]
  return statuses.find((status) => status.textContent?.includes('This device has unsaved work'))
}

const STOPPED = 'Saving stopped in this tab. Reload to keep editing.'
const REFUSED =
  'This document now saves as you edit, so saving stopped in this tab. Reload to keep editing.'
const REFUSED_KEPT =
  'This document now saves as you edit, so saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.'

// A live room whose saving failed for good, which the page shows as the stop strip
function stoppedRoom() {
  const room = liveRoom()
  room.saveState = 'failed'
  room.unsent = 1
  return room
}

const FROZEN = "Part of this document can't be shown here, so editing is paused to keep it safe."

// A live room whose body holds text this editor can't show, so the editor freezes on open
function frozenRoom() {
  const room = liveRoom()
  room.doc.getXmlFragment('default').insert(0, [unknownBlock()])
  return room
}

// A block of a kind Writer doesn't have, holding text
function unknownBlock() {
  const block = new Y.XmlElement('mystery')
  block.insert(0, [new Y.XmlText('Kept')])
  return block
}

// Each shown strip's message, without its buttons
function stripTexts(root: Element) {
  const strips = [...root.querySelectorAll('[role="status"]')]
  return strips.map((strip) => strip.querySelector('p')?.textContent?.trim() ?? '')
}

// Lets the recovery strip finish reading the device's copies
async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 50))
  await nextTick()
}

async function discardCopies() {
  for (const copy of await listCopies('node-1')) {
    await discardCopy(copy)
  }
}

// Types a line the room has yet to send, shuts the write gate, and takes the file the toast's Download my changes saves
async function downloadedChanges(afterClose: (root: Element) => unknown = () => {}, role = 30) {
  Object.assign(liveRoom(), { saveState: 'unsaved', unsent: 1 })
  const access = ref({ role: 50 })
  const root = await openedSurface(undefined, '/d/node-1', undefined, access)
  root
    .querySelector<EditorElement>('[data-editor] .ProseMirror')!
    .editor.commands.insertContent('Unsent line')
  const files: Blob[] = []
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      files.push(blob)
      return 'blob:changes'
    },
    revokeObjectURL: () => {},
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const warning = vi.spyOn(toast, 'warning')

  access.value = { role }
  await vi.waitFor(() => expect(warning).toHaveBeenCalled())
  await afterClose(root)
  const [, shown] = warning.mock.lastCall!
  ;(shown?.action as { onClick: () => void }).onClick()
  await vi.waitFor(() => expect(files).toHaveLength(1))
  return files[0] as File
}

const shownText = (root: Element) => root.querySelector('[data-editor] .ProseMirror')!.textContent

describe('Writer surface', () => {
  it('edits a document while the tab meets the minimum Writer build', async () => {
    await serverMinBuilds({ writer: '100' })

    const editor = await openedEditor()

    expect(editor.getAttribute('data-editable')).toBe('true')
  })

  it('opens a document read-only in a tab older than the minimum Writer build', async () => {
    await serverMinBuilds({ writer: '150' })

    const editor = await openedEditor()

    expect(editor.getAttribute('data-editable')).toBe('false')
  })

  it('shows the next page of versions after Load more', async () => {
    const pages: Record<string, unknown> = {
      first: {
        rows: [{ seq: 2, kind: 'named', label: 'Draft two' }],
        next_cursor: 'page-2',
      },
      'page-2': {
        rows: [{ seq: 1, kind: 'named', label: 'Draft one' }],
        next_cursor: null,
      },
    }
    const list = vi.fn(async (cursor?: string) => pages[cursor ?? 'first'])
    const root = await openedSurface({ list } as unknown as Versions)

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Draft two'))
    expect(root.textContent).not.toContain('Draft one')

    buttonLabelled(root, 'Load more')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Draft one'))
    expect(root.textContent).toContain('Draft two')
    expect(buttonLabelled(root, 'Load more')).toBeUndefined()
  })

  it('shows who took a version and when, under the day it was taken', async () => {
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
    const root = await openedSurface({ list } as unknown as Versions)

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    const row = versionRow(root, 'Before review')
    const day = row.closest('section')!.querySelector('h3')!
    expect(row.textContent).toMatch(/ana@example\.com · 10:41(\s(AM|am))?$/)
    expect(day.textContent).toMatch(/^(Mar 4, 2025|4 Mar 2025)$/)
    vi.unstubAllEnvs()
  })

  it('opens the Versions panel from Save version in the document menu, with the cursor in the name box', async () => {
    const root = await openedSurface(oneVersion)

    root.querySelector<HTMLElement>('[data-save-version]')!.click()
    await vi.waitFor(() =>
      expect(root.querySelector('input[aria-label="Version name"]')).not.toBeNull(),
    )

    expect(document.activeElement).toBe(root.querySelector('input[aria-label="Version name"]'))
    expect(root.querySelector('aside')?.textContent).toContain('Before review')
  })

  it('opens the Versions name box from Save version on Current version, with the cursor in it', async () => {
    const root = await openedSurface(oneVersion)

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    expect(root.querySelector('input[aria-label="Version name"]')).toBeNull()
    buttonLabelled(root.querySelector('aside')!, 'Save version')!.click()
    await vi.waitFor(() =>
      expect(root.querySelector('input[aria-label="Version name"]')).not.toBeNull(),
    )

    expect(document.activeElement).toBe(root.querySelector('input[aria-label="Version name"]'))
  })

  it('shows a version in place of the editor until Current version', async () => {
    const list = vi.fn(async () => ({
      rows: [{ seq: 3, kind: 'named', label: 'Before review' }],
      next_cursor: null,
    }))
    const root = await openedSurface({ list } as unknown as Versions)
    const editorShown = () =>
      root.querySelector<HTMLElement>('[data-editor]')!.style.display !== 'none'

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    versionRow(root, 'Before review').click()
    await nextTick()

    const preview = root.querySelector<HTMLElement>('[data-preview]')!
    expect(preview.getAttribute('data-preview')).toBe('3')
    expect(editorShown()).toBe(false)

    versionRow(root, 'Current version').click()
    await nextTick()
    expect(root.querySelector('[data-preview]')).toBeNull()
    expect(editorShown()).toBe(true)
  })

  it('restores a version of a document edited without collaboration and shows its text', async () => {
    // An earlier test unstubs every env, and the build floor is read only outside DEV
    vi.stubEnv('DEV', false)
    // Every request answers with the stored version, which shows no images
    await serverMinBuilds({ writer: '100' }, '<p>Back then</p>')
    stored.html = '<p>Today</p>'
    const restore = vi.fn(async () => {
      stored.html = '<p>Back then</p>'
    })
    const root = await openedSurface({
      ...oneVersion,
      contentUrl: () => '/version/3',
      restore,
    } as unknown as Versions)
    function editor() {
      return root.querySelector('[data-editor]')!
    }

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    versionRow(root, 'Before review').click()
    await nextTick()
    buttonLabelled(root.querySelector('aside')!, 'Restore this version')!.click()

    await vi.waitFor(() => expect(editor().textContent).toBe('<p>Back then</p>'))
    expect(restore).toHaveBeenCalledWith('3')
    expect(root.querySelector('[data-preview]')).toBeNull()
  })

  it('restores the shown version from the version bar, the same as from its row', async () => {
    vi.stubEnv('DEV', false)
    await serverMinBuilds({ writer: '100' }, '<p>Back then</p>')
    stored.html = '<p>Today</p>'
    const restore = vi.fn(async () => {
      stored.html = '<p>Back then</p>'
    })
    const root = await openedSurface({
      ...oneVersion,
      contentUrl: () => '/version/3',
      restore,
    } as unknown as Versions)

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    versionRow(root, 'Before review').click()
    await nextTick()
    const bar = [...root.querySelectorAll('[role="status"]')].find((status) =>
      status.textContent?.includes('Viewing Before review'),
    )!
    buttonLabelled(bar, 'Restore this version')!.click()

    await vi.waitFor(() =>
      expect(root.querySelector('[data-editor]')!.textContent).toBe('<p>Back then</p>'),
    )
    expect(restore).toHaveBeenCalledWith('3')
    expect(root.querySelector('[data-preview]')).toBeNull()
  })

  it('offers no Restore on the version bar to someone who can’t restore', async () => {
    const root = await openedSurface(oneVersion, '/d/node-1', undefined, ref({ role: 30 }))

    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    versionRow(root, 'Before review').click()
    await nextTick()
    const bar = [...root.querySelectorAll('[role="status"]')].find((status) =>
      status.textContent?.includes('Viewing Before review'),
    )!
    expect(bar.querySelectorAll('button')).toHaveLength(0)
  })

  it('shows edits made in another tab while a version was previewed', async () => {
    const room = liveRoom()
    const root = await openedSurface(oneVersion)
    const otherTab = new Y.Doc()
    Y.applyUpdate(otherTab, Y.encodeStateAsUpdate(room.doc))

    const typeInOtherTab = () => {
      const paragraph = new Y.XmlElement('paragraph')
      paragraph.insert(0, [new Y.XmlText('Typed in the other tab')])
      otherTab.getXmlFragment('default').insert(0, [paragraph])
      const roomVector = Y.encodeStateVector(room.doc)
      const missing = Y.encodeStateAsUpdate(otherTab, roomVector)
      Y.applyUpdate(room.doc, missing)
    }
    await previewAndReturn(root, typeInOtherTab)

    expect(shownText(root)).toContain('Typed in the other tab')
    expect(room.close).not.toHaveBeenCalled()
  })

  it('keeps text typed just before a preview, undoable and on its way to other tabs', async () => {
    const room = liveRoom()
    const root = await openedSurface(oneVersion)
    const editor = () => root.querySelector<EditorElement>('[data-editor] .ProseMirror')!.editor

    editor().commands.insertContent('Typed here first')
    await previewAndReturn(root)

    expect(shownText(root)).toContain('Typed here first')
    const otherTab = new Y.Doc()
    Y.applyUpdate(otherTab, Y.encodeStateAsUpdate(room.doc))
    expect(otherTab.getXmlFragment('default').toString()).toContain('Typed here first')
    editor().commands.undo()
    expect(shownText(root)).not.toContain('Typed here first')
  })

  it('hides the recovery banner while a copy is shown, and brings it back after', async () => {
    keepPageCopy('node-1', 'Quarterly plan', '<p>Typed while offline</p>')
    const [copy] = await listCopies('node-1')
    const root = await openedSurface()
    await vi.waitFor(() => expect(recoveryBanner(root)).toBeDefined())

    buttonLabelled(recoveryBanner(root)!, 'View')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Viewing recovery copy from'))
    expect(recoveryBanner(root)).toBeUndefined()

    buttonLabelled(root, 'Back to current')!.click()
    await vi.waitFor(() => expect(recoveryBanner(root)).toBeDefined())
    await discardCopy(copy)
  })

  it('keeps Back to current in the recovery bar’s menu, first, and as a button', async () => {
    keepPageCopy('node-1', 'Quarterly plan', '<p>Typed while offline</p>')
    const [copy] = await listCopies('node-1')
    const root = await openedSurface(oneVersion)
    await vi.waitFor(() => expect(recoveryBanner(root)).toBeDefined())

    buttonLabelled(recoveryBanner(root)!, 'View')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Viewing recovery copy from'))
    const bar = [...root.querySelectorAll('[role="status"]')].find((status) =>
      status.textContent?.includes('Viewing recovery copy from'),
    )!
    const menu = [...bar.querySelectorAll('[data-menu] button')].map((item) => item.textContent)
    const buttons = [...bar.querySelectorAll('button')].map((item) => item.textContent)
    expect([menu, buttons]).toEqual([
      ['Back to current', 'Copy', 'Download', 'Discard'],
      ['Back to current', 'Copy', 'Download', 'Discard'],
    ])

    buttonLabelled(bar, 'Back to current')!.click()
    await vi.waitFor(() => expect(root.textContent).not.toContain('Viewing recovery copy from'))
    await previewAndReturn(root)
    await discardCopy(copy)
  })

  it('draws the recovery banner, the recovery bar and the version bar alike but for colour', async () => {
    keepPageCopy('node-1', 'Quarterly plan', '<p>Typed while offline</p>')
    const [copy] = await listCopies('node-1')
    const root = await openedSurface(oneVersion)
    await vi.waitFor(() => expect(recoveryBanner(root)).toBeDefined())
    const banner = recoveryBanner(root)!
    buttonLabelled(banner, 'View')!.click()
    await vi.waitFor(() => expect(statusWith(root, 'Viewing recovery copy from')).toBeDefined())
    const copyBar = statusWith(root, 'Viewing recovery copy from')!
    const copyShape = shapeOf(copyBar)
    buttonLabelled(copyBar, 'Back to current')!.click()
    await nextTick()

    let versionShape: string[] = []
    await previewAndReturn(root, () => {
      versionShape = shapeOf(statusWith(root, 'Viewing Before review')!)
    })

    expect([shapeOf(banner), copyShape]).toEqual([versionShape, versionShape])
    expect(banner.querySelector('[class*="lucide-"]')).toBeNull()
    await discardCopy(copy)
  })

  it('shows the stop strip alone when this device also holds a recovery copy', async () => {
    stoppedRoom()
    keepPageCopy('node-1', 'Quarterly plan', '<p>Typed while offline</p>')
    const root = await openedSurface()

    await vi.waitFor(() => expect(statusWith(root, STOPPED)).toBeDefined())
    await settled()
    expect(stripTexts(root)).toEqual([STOPPED])
    await discardCopies()
  })

  it('shows only the version bar while a version is previewed over a stop and a recovery copy', async () => {
    stoppedRoom()
    keepPageCopy('node-1', 'Quarterly plan', '<p>Typed while offline</p>')
    const root = await openedSurface(oneVersion)
    await vi.waitFor(() => expect(statusWith(root, STOPPED)).toBeDefined())

    let during: string[] = []
    await previewAndReturn(root, () => {
      during = stripTexts(root)
    })

    expect([during, stripTexts(root)]).toEqual([['Viewing Before review'], [STOPPED]])
    await discardCopies()
  })

  it('shows the stop strip on Back to current when the stop came during a preview', async () => {
    const room = liveRoom()
    const changes: (() => void)[] = []
    function onChange(listener: () => void) {
      changes.push(listener)
      return () => {}
    }

    Object.assign(room, { onChange })

    const root = await openedSurface(oneVersion)

    let during: string[] = []
    await previewAndReturn(root, async () => {
      Object.assign(room, { saveState: 'failed', unsent: 1 })
      for (const change of changes) {
        change()
      }

      await nextTick()
      during = stripTexts(root)
    })

    expect([during, stripTexts(root)]).toEqual([['Viewing Before review'], [STOPPED]])
  })

  it('shows only the recovery bar while a copy is viewed over a stop', async () => {
    stoppedRoom()
    keepPageCopy('node-1', 'Quarterly plan', '<p>Typed while offline</p>')
    const [copy] = await listCopies('node-1')
    const key = encodeURIComponent(copy.key)
    const root = await openedSurface(undefined, `/d/node-1?recovery=${key}`)

    await vi.waitFor(() => expect(statusWith(root, 'Viewing recovery copy from')).toBeDefined())
    await settled()
    expect(stripTexts(root)).toHaveLength(1)
    await discardCopies()
  })

  it("clears the old editor's store once its refused save is kept as a recovery copy", async () => {
    Object.assign(stored, { collab: 1, isRefusingSaves: true })
    const root = await openedSurface()

    await vi.waitFor(() => expect(oldEditor.forgetStoredEdits).toHaveBeenCalledOnce())
    expect((await listCopies('node-1')).map((copy) => copy.html)).toEqual([
      '<p>Old editor line</p>',
    ])
    expect(stripTexts(root)).toEqual([REFUSED_KEPT])
    await discardCopies()
  })

  it("keeps the old editor's store when the recovery copy can't be kept", async () => {
    Object.assign(stored, { collab: 1, isRefusingSaves: true })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([REFUSED]))
    await settled()
    expect(oldEditor.forgetStoredEdits).not.toHaveBeenCalled()
  })

  it('asks to keep the tab open, with no Reload, and warns on leaving, when typing after a lost right is kept nowhere', async () => {
    Object.assign(stoppedRoom(), { blocked: 'lost_read', stopped: 'lost_access', copyFailed: true })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    const root = await openedSurface()
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)

    expect(stripTexts(root)).toEqual([
      "You can no longer open this document. Unsent changes couldn't be kept on this device, so keep this tab open.",
    ])
    expect([buttonLabelled(root, 'Reload'), leaving.defaultPrevented]).toEqual([undefined, true])
  })

  it('keeps a page copy of typing after a lost right that the device could not keep', async () => {
    const listeners: (() => void)[] = []
    const room = Object.assign(liveRoom(), {
      blocked: 'lost_read',
      stopped: 'lost_access',
      onChange(listener: () => void) {
        listeners.push(listener)
        return () => {}
      },
    })
    const root = await openedSurface()
    Object.assign(room, { saveState: 'failed', unsent: 1, copyFailed: true })
    for (const listener of listeners) {
      listener()
    }

    await nextTick()

    expect(stripTexts(root)).toEqual([
      'You can no longer open this document. Unsent changes were kept as a recovery copy.',
    ])
    expect(await listCopies('node-1')).toHaveLength(1)
    await discardCopies()
  })

  it('downloads the line typed but not yet sent from the lost-access toast, before the device keeps a copy', async () => {
    const file = await downloadedChanges()

    expect(file.name).toBe('Quarterly plan (recovered).html')
    expect(await file.text()).toContain('<p>Unsent line</p>')
  })

  it('downloads the line typed but not yet sent from the lost-access toast, not an older copy on the device', async () => {
    keepPageCopy('node-1', 'Quarterly plan', '<p>Older copy</p>', new Date('2026-01-01'))
    const file = await downloadedChanges()

    expect(await file.text()).toContain('<p>Unsent line</p>')
    await discardCopies()
  })

  it('downloads the work held when editing access was lost, not what the editor shows after a rebuild', async () => {
    const file = await downloadedChanges((root) =>
      root
        .querySelector<EditorElement>('[data-editor] .ProseMirror')!
        .editor.commands.setContent('<p>Server text</p>'),
    )

    expect(await file.text()).toContain('<p>Unsent line</p>')
    expect(await file.text()).not.toContain('Server text')
  })

  it('downloads the work held when the document became unreadable, not an older copy on the device', async () => {
    keepPageCopy('node-1', 'Quarterly plan', '<p>Older copy</p>', new Date('2026-01-01'))
    const file = await downloadedChanges(
      (root) => vi.waitFor(() => expect(root.querySelector('[data-editor]')).toBeNull()),
      0,
    )

    expect(await file.text()).toContain('<p>Unsent line</p>')
    await discardCopies()
  })

  it('tells the room that editing access was lost when the role drops below edit', async () => {
    const room = liveRoom()
    const access = ref({ role: 50 })
    await openedSurface(undefined, '/d/node-1', undefined, access)

    access.value = { role: 30 }

    expect(room.loseAccess).toHaveBeenCalledWith('lost_edit')
  })

  it('tells the room that reading access was lost when the document is refused, before its role drops', async () => {
    const room = liveRoom()
    const state = ref('Active')
    await openedSurface(undefined, '/d/node-1', undefined, undefined, state)

    state.value = 'Refused'

    expect(room.loseAccess).toHaveBeenCalledWith('lost_read')
  })

  it("shows the read-only notice, with no download, when the only unsent work is another tab's", async () => {
    Object.assign(liveRoom(), { saveState: 'unsaved', othersUnsent: 3 })
    const access = ref({ role: 50 })
    await openedSurface(undefined, '/d/node-1', undefined, access)
    const warning = vi.spyOn(toast, 'warning')

    access.value = { role: 30 }

    await vi.waitFor(() => expect(warning).toHaveBeenCalled())
    expect(warning.mock.calls).toEqual([
      ['Editing access changed. This document is now read-only.'],
    ])
  })

  it('still shows the read-only notice when the room fails to settle the lost access', async () => {
    const room = liveRoom()
    room.loseAccess.mockRejectedValue(new Error('Copy not kept'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const access = ref({ role: 50 })
    await openedSurface(undefined, '/d/node-1', undefined, access)
    const warning = vi.spyOn(toast, 'warning')

    access.value = { role: 30 }

    await vi.waitFor(() => expect(warning).toHaveBeenCalled())
    expect(warning.mock.calls).toEqual([
      ['Editing access changed. This document is now read-only.'],
    ])
  })

  it('gives the room editing back and shows no notice when access returns before the room settles', async () => {
    const room = liveRoom()
    const losing = Promise.withResolvers<void>()
    room.loseAccess.mockReturnValue(losing.promise)
    const access = ref({ role: 50 })
    await openedSurface(undefined, '/d/node-1', undefined, access)
    const warning = vi.spyOn(toast, 'warning')

    access.value = { role: 30 }
    access.value = { role: 50 }
    losing.resolve()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(room.regainAccess).toHaveBeenCalledTimes(1)
    expect(warning).not.toHaveBeenCalled()
  })

  it("shows the freeze strip with Reload when the document holds text the editor can't show", async () => {
    frozenRoom()
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
    const [page, reload] = [location, vi.fn()]
    vi.stubGlobal('location', { ...page, reload })
    buttonLabelled(root, 'Reload')!.click()
    vi.stubGlobal('location', page)

    expect(reload).toHaveBeenCalledOnce()
  })

  it('shows the stop strip, naming the freeze, when saving also stopped', async () => {
    Object.assign(frozenRoom(), { saveState: 'failed', unsent: 1 })
    const root = await openedSurface()

    await vi.waitFor(() =>
      expect(stripTexts(root)).toEqual([
        "Saving stopped in this tab. Part of this document can't be shown here, so editing stays paused. Reload to try saving again.",
      ]),
    )
    expect(buttonLabelled(root, 'Reload')).toBeDefined()
  })

  it("freezes the real collab editor over text it can't show", async () => {
    realEditors.isOn = true
    const room = frozenRoom()
    const presence = { awareness: new Awareness(room.doc), peers: [], onChange: () => () => {} }
    Object.assign(room, { presence, restoreRev: 0 })
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
  })

  it("freezes the real old editor over text it can't show", async () => {
    realEditors.isOn = true
    stored.collab = 1
    const body = new Y.Doc()
    body.getXmlFragment('default').insert(0, [unknownBlock()])
    stored.content = fromUint8Array(Y.encodeStateAsUpdate(body))
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
  })

  it('shows the freeze strip over the polling notice', async () => {
    Object.assign(frozenRoom(), { live: 'polling' })
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
  })

  it('shows only the version bar while a version is previewed over a freeze', async () => {
    frozenRoom()
    const root = await openedSurface(oneVersion)
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))

    let during: string[] = []
    await previewAndReturn(root, () => {
      during = stripTexts(root)
    })

    expect([during, stripTexts(root)]).toEqual([['Viewing Before review'], [FROZEN]])
  })

  it('neither reports a frozen tab nor stops its room', async () => {
    const room = Object.assign(frozenRoom(), {
      stopForGood: vi.fn(async () => {}),
      suspect: { mark: vi.fn(), isJudging: false },
    })
    const root = await openedSurface()
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
    await settled()

    expect([room.stopForGood.mock.calls, room.suspect.mark.mock.calls]).toEqual([[], []])
  })

  it('shows the freeze strip over the old editor, and its refused save over the freeze', async () => {
    oldEditor.isFrozen = true
    stored.collab = 1
    const frozen = await openedSurface()
    await vi.waitFor(() => expect(stripTexts(frozen)).toEqual([FROZEN]))
    document.body.innerHTML = ''

    stored.isRefusingSaves = true
    const refused = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(refused)).toEqual([REFUSED_KEPT]))
    await discardCopies()
  })

  it('opens the recovery copy a link names, in place of the editor', async () => {
    keepPageCopy('node-1', 'Quarterly plan', '<p>Typed while offline</p>')
    const [copy] = await listCopies('node-1')
    const key = encodeURIComponent(copy.key)
    const root = await openedSurface(undefined, `/d/node-1?recovery=${key}`)

    await vi.waitFor(() => expect(root.textContent).toContain('Viewing recovery copy from'))
    expect(root.querySelector('[aria-label="Recovery copy"]')!.textContent).toBe(
      'Typed while offline',
    )
    await discardCopy(copy)
  })
})

describe('commenting from the editor', () => {
  // Drafts are kept in the tab and on the device between opens
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  // The real collab editor over "hello world", with Drive holding `threads`
  async function openedOnText(threads: (doc: Y.Doc) => DocumentThread[] = () => []) {
    realEditors.isOn = true
    const room = liveRoom()
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText('hello world')])
    room.doc.getXmlFragment('default').insert(0, [paragraph])
    const presence = { awareness: new Awareness(room.doc), peers: [], onChange: () => () => {} }
    Object.assign(room, { presence, restoreRev: 0 })
    const comments = { list: async () => ({ threads: threads(room.doc) }) } as unknown as Comments
    const root = await openedSurface(undefined, '/d/node-1', comments)
    const element = root.querySelector<EditorElement>('[data-editor] .ProseMirror')!
    return { root, editor: element.editor }
  }

  function pressCommentKeys(editor: TiptapEditor) {
    const keys = { key: 'm', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', keys))
  }

  function draftCount(root: Element) {
    return root.querySelectorAll('textarea[aria-label="Add a comment on the text"]').length
  }

  it('starts exactly one comment on the selected text on Ctrl+Alt+M', async () => {
    const { root, editor } = await openedOnText()

    editor.commands.setTextSelection({ from: 1, to: 6 })
    pressCommentKeys(editor)
    await settled()

    expect([draftCount(root), root.querySelector('aside')?.getAttribute('aria-label')]).toEqual([
      1,
      'Comments',
    ])
  })

  it('opens the whole-document box, ready to type in, on Ctrl+Alt+M with nothing selected', async () => {
    const { root, editor } = await openedOnText()

    editor.commands.setTextSelection(3)
    pressCommentKeys(editor)
    await settled()

    const box = root.querySelector('aside textarea[aria-label="Add a comment"]')
    expect([box !== null, document.activeElement === box, draftCount(root)]).toEqual([
      true,
      true,
      0,
    ])
  })

  it('lights the text of a pointed-at row, then shows it darker and in view once opened', async () => {
    const { root, editor } = await openedOnText((doc) => [threadOnWorld(doc)])
    root.querySelector<HTMLElement>('[data-open-comments]')!.click()
    await vi.waitFor(() => expect(root.querySelector('aside li')).not.toBeNull())
    const row = root.querySelector('aside li')!
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    function textClass() {
      return editor.view.dom.querySelector('[data-thread]')?.className
    }

    row.dispatchEvent(new MouseEvent('mouseenter'))
    await nextTick()
    const pointed = textClass()
    row.querySelector('button')!.click()
    await nextTick()
    const textScrolls = scrolled.mock.contexts.filter(
      (element) => element instanceof HTMLSpanElement,
    )

    expect([pointed, textClass(), textScrolls.length]).toEqual(['is-lit', 'is-open', 1])
  })

  it('opens the comments panel on the thread whose highlighted text is clicked', async () => {
    const { root, editor } = await openedOnText((doc) => [threadOnWorld(doc)])
    await vi.waitFor(() => expect(editor.view.dom.querySelector('[data-thread]')).not.toBeNull())

    const world = editor.view.dom.querySelector('[data-thread]')!
    editor.view.someProp('handleClick', (click) =>
      click(editor.view, 8, { target: world } as never),
    )
    await settled()

    const expanded = root.querySelector('aside li > button[aria-expanded="true"]')
    expect(expanded?.closest('li')?.textContent).toContain('About the world')
  })
})

// A thread on "world" in a document reading "hello world"
function threadOnWorld(doc: Y.Doc) {
  const text = (doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
  const from = Y.createRelativePositionFromTypeIndex(text, 6, 0)
  const to = Y.createRelativePositionFromTypeIndex(text, 11, -1)
  const comment = {
    name: 'c1',
    author: 'ann@example.com',
    author_name: null,
    person: { full_name: 'Ann' },
    content: 'About the world',
    creation: new Date().toISOString(),
  }
  const anchor = encodeAnchor(from, to, 'world')
  return {
    name: 'world',
    anchor,
    resolved: false,
    comments: [comment],
  } as unknown as DocumentThread
}
