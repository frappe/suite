import { fakeSocket } from '@suite/collab-client/test-support'
import type { AnyExtension, Editor } from '@tiptap/core'
import { reactive, type PropType } from 'vue'
import type { Doc } from 'yjs'

export const rooms = { next: null as object | null }
// The body the server holds for a document edited without collaboration
export const stored = {
  html: '',
  content: '',
  collab: 0,
  // Set while the document waits for, or was refused, conversion to collaboration
  conversion: null as {
    state: 'pending' | 'refused'
    reason?: string
    rooms?: { epoch: number; keys: string[]; epoch_seconds: number; server_time: number }
  } | null,
  reloads: 0,
}
// The realtime socket a waiting document's tab listens on for its conversion
export const realtime = { socket: fakeSocket({ answers: true }) }
// Mounts the real editors, over a stand-in for CoreEditor, in place of the fakes below
export const realEditors = { isOn: false }
// What the document menu's Download took, as the HTML the real menu exports
export const downloaded = { html: null as string | null }

export async function fakeFrappeUi() {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  const emptyComponent = { render: () => null }
  return {
    Avatar: emptyComponent,
    Badge: emptyComponent,
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
}

export async function fakeDrive() {
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
    GUEST_NAME_LIMIT: 140,
    useDriveGuestName: () => ({
      shown: state(false),
      text: state(''),
      atLimit: state(false),
      maxLength: 140,
      take: () => '',
    }),
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
        extensions: { type: Array as PropType<AnyExtension[]>, default: () => [] },
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
      return { name: 'content-1', collab, settings: {}, html, content, conversion }
    }

    const resources = reactive({
      doc: read(),
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
  const fake = define({
    props: { room: Object, editable: Boolean },
    setup(props, { expose, slots }) {
      const room = props.room as { doc: Doc }
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
        editor: Object as PropType<Editor | null>,
      },
      emits: ['saveVersion'],
      setup:
        (props, { emit }) =>
        () => [
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

export function fakeUsers(original: typeof import('@/apps/writer/composables/useUsers')) {
  return {
    ...original,
    fullName: (user: string) => user,
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
