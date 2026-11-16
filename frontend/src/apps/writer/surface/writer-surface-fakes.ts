import { fakeSocket } from '@suite/collab-client/test-support'
import type { AnyExtension, Editor } from '@tiptap/core'
import { fromPartial } from '@total-typescript/shoehorn'
import { reactive, type PropType } from 'vue'
import type { Doc } from 'yjs'

interface SurfaceRooms {
  next: object | null
  held: Promise<void> | null
  openFailure: Error | null
  opens: number
}
export const rooms: SurfaceRooms = {
  next: null,
  held: null,
  openFailure: null,
  opens: 0,
}
// The body the server holds for a document edited without collaboration
interface LegacySurfaceContent {
  html: string
  content: string
  collab: number
  conversion: {
    state: 'pending' | 'refused'
    reason?: string
    rooms?: { epoch: number; keys: string[]; epoch_seconds: number; server_time: number }
  } | null
  reloads: number
}
export const stored: LegacySurfaceContent = {
  html: '',
  content: '',
  collab: 0,
  // Set while the document waits for, or was refused, conversion to collaboration
  conversion: null,
  reloads: 0,
}
// The realtime socket a waiting document's tab listens on for its conversion
export const realtime = { socket: fakeSocket({ answers: true }) }
// Mounts the real editors, over a stand-in for CoreEditor, in place of the fakes below
export const realEditors = { isOn: false }
// What the document menu's Download took, as the HTML the real menu exports
interface DownloadedDocument {
  html: string | null
}
export const downloaded: DownloadedDocument = { html: null }
// Whether a reader is signed in; read when each surface mounts, so a test sets it before opening one
export const signedIn = { isOn: true }

export function fakeSession(original: typeof import('@/platform/session')) {
  return {
    ...original,
    isAuthenticated: {
      get value() {
        return signedIn.isOn
      },
    },
  }
}

export async function fakeFrappeUi() {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  const emptyComponent = { render: () => null }
  return {
    Avatar: emptyComponent,
    Badge: emptyComponent,
    Dropdown: define<{ options?: { label: string; onClick: () => void }[] }>({
      props: ['options'],
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
          emit(
            'update:modelValue',
            event.target instanceof HTMLInputElement ? event.target.value : '',
          )
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
}

export async function fakeDrive(original: typeof import('@/apps/drive')) {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    ...original,
    DriveDocumentHeader: define({
      props: {
        saveState: { type: String, default: null },
        saveNote: { type: String, default: '' },
        viewOnly: { type: Boolean, default: false },
      },
      setup:
        (props, { slots }) =>
        () => [
          render('output', { 'data-save-state': '' }, props.saveState ?? ''),
          props.viewOnly && render('output', { 'data-view-only': '' }),
          render('output', props.saveNote),
          slots.actions?.(),
          slots.menu?.(),
        ],
    }),
    DRIVE_ROLES: { read: 10, comment: 20, upload: 30, edit: 40, manage: 50 },
  }
}

export async function fakeCoreEditor() {
  const {
    defineComponent: define,
    h: render,
    onBeforeUnmount,
    shallowRef,
    watchEffect,
  } = await import('vue')
  const { Editor, EditorContent } = await import('@tiptap/vue-3')
  const { default: Document } = await import('@tiptap/extension-document')
  const { default: Paragraph } = await import('@tiptap/extension-paragraph')
  const { default: Text } = await import('@tiptap/extension-text')
  return {
    default: define({
      props: {
        extensions: { type: fromPartial<PropType<AnyExtension[]>>(Array), default: () => [] },
        rawContent: String,
        editable: Boolean,
      },
      setup(props, { expose, slots }) {
        const extensions = [Document, Paragraph, Text, ...props.extensions]
        const editor = shallowRef(new Editor({ extensions, content: props.rawContent }))
        watchEffect(() => editor.value.setEditable(props.editable))
        expose({ editor })
        onBeforeUnmount(() => editor.value.destroy())
        return () => {
          const editorBox = {
            'data-editor': '',
            id: 'editor-scroll-container',
            style: slots.cover && { display: 'none' },
          }
          const content = render(EditorContent, { editor: editor.value })
          return [
            slots.toolbar?.(),
            render('div', editorBox, [content]),
            slots.cover?.(),
            slots.aside?.(),
          ]
        }
      },
    }),
  }
}

export async function fakeCollabPlatform() {
  const client = await import('@suite/collab-client')
  return {
    ...client,
    openCollabRoom: async () => {
      await rooms.held
      rooms.opens++
      if (rooms.openFailure) {
        throw rooms.openFailure
      }

      if (rooms.next) {
        return { state: 'live', room: rooms.next }
      }

      if (stored.conversion) {
        return { state: 'unconverted' }
      }

      return { state: 'disabled' }
    },
    openSignedInDeviceStore: async () => null,
    watchConversion: (keys: string[], onTold: (message: unknown) => void) =>
      client.watchRooms(realtime.socket, keys, 'suite_collab_converted', onTold),
  }
}

export function fakeWriterDocument(original: typeof import('./writerDocument')) {
  function writerDocument() {
    function read() {
      const { collab, html, content, conversion } = stored
      return {
        name: 'content-1',
        collab,
        settings: {},
        html,
        content,
        conversion,
      }
    }

    const resources = reactive({
      doc: read(),
      readFailure: null,
      reload: async () => {
        stored.reloads++
        resources.doc = read()
      },
    })
    return resources
  }

  return {
    ...original,
    createWriterDocument: writerDocument,
  }
}

export async function fakeCollabTextEditor(
  real: typeof import('@/apps/writer/components/CollabTextEditor.vue'),
) {
  const {
    defineComponent: define,
    h: render,
    onBeforeUnmount,
    ref: mockRef,
    shallowRef,
    watchEffect,
  } = await import('vue')
  const { Editor, EditorContent } = await import('@tiptap/vue-3')
  const { default: Document } = await import('@tiptap/extension-document')
  const { default: Paragraph } = await import('@tiptap/extension-paragraph')
  const { default: Text } = await import('@tiptap/extension-text')
  const { default: Collaboration } = await import('@tiptap/extension-collaboration')
  const fake = define<{ room: { doc: Doc }; editable: boolean }>({
    props: ['room', 'editable'],
    setup(props, { expose, slots }) {
      const room = props.room
      const isFrozen = mockRef(false)
      function onFrozen() {
        isFrozen.value = true
      }

      const ySyncOptions = { onUnplaceable: onFrozen }
      const collaboration = Collaboration.configure({ document: room.doc, ySyncOptions })
      const extensions = [Document, Paragraph, Text, collaboration]
      const editor = shallowRef(new Editor({ extensions }))
      watchEffect(() => editor.value.setEditable(props.editable))
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
}

export async function fakeDocumentMenu() {
  const { defineComponent: define, h: render } = await import('vue')
  const { exportHTML } = await import('./exports')
  return {
    default: define({
      props: {
        canSaveVersion: Boolean,
        editable: Boolean,
        editor: fromPartial<PropType<Editor | null>>(Object),
        panels: { type: fromPartial<PropType<string[]>>(Array), default: () => [] },
      },
      emits: ['saveVersion', 'togglePanel'],
      setup:
        (props, { emit }) =>
        () => [
          ...props.panels.map((panel) =>
            render('button', {
              [`data-open-${panel}`]: '',
              onClick: () => emit('togglePanel', panel),
            }),
          ),
          render('button', {
            'data-save-version': '',
            hidden: !props.canSaveVersion,
            onClick: () => emit('saveVersion'),
          }),
          render('button', { 'data-import-docx': '', hidden: !props.editable }),
          render('button', {
            'data-download': '',
            onClick: () => {
              if (props.editor) {
                downloaded.html = exportHTML(props.editor, 'document')
              }
            },
          }),
        ],
    }),
  }
}

export function fakeNames(original: typeof import('@/platform/collab/names')) {
  function fullName(user: string) {
    return user
  }

  return {
    ...original,
    fullName,
    people: { ...original.people, fullName },
  }
}

export async function fakeVersionPreview() {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    default: define({
      props: { seq: Number },
      setup: (props) => () => render('div', { 'data-preview': props.seq }),
    }),
  }
}
