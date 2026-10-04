import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import type { DocumentSession } from '@/apps/drive'

vi.hoisted(() => {
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.stubEnv('DEV', false)
})

vi.mock('frappe-ui', () => {
  const blank = { render: () => null }
  return {
    Avatar: blank,
    Badge: blank,
    Button: blank,
    Skeleton: blank,
    TextInput: blank,
    toast: { info: () => {}, warning: () => {}, error: () => {} },
  }
})

vi.mock('@/apps/drive', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  return {
    DriveDocumentHeader: define({ setup: () => () => render('header') }),
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
})

vi.mock('@/apps/writer/collab', () => ({
  openWriterRoom: async () => ({ state: 'off' }),
  withinTenSeconds: (promise: Promise<void>) => promise,
}))

vi.mock('@/apps/writer/components/NonCollabEditor.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    default: define({
      props: { editable: Boolean },
      setup: (props) => () => render('div', { 'data-editor': '', 'data-editable': props.editable }),
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

vi.mock('@/apps/writer/components/CollabTextEditor.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/writer/components/TextEditor.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/writer/components/UsersBar.vue', () => ({ default: { render: () => null } }))
vi.mock('./WriterDocumentMenu.vue', () => ({ default: { render: () => null } }))

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

async function openedEditor() {
  const session = {
    nodeId: 'node-1',
    title: ref('Quarterly plan'),
    state: ref('Active'),
    access: ref({ role: 50 }),
    refreshAccess: async () => {},
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
  return root.querySelector('[data-editor]')!
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Writer surface', () => {
  it('edits a document while the tab meets the minimum Writer build', async () => {
    await serverMinBuilds({ writer: '100' })

    expect((await openedEditor()).getAttribute('data-editable')).toBe('true')
  })

  it('opens a document read-only in a tab older than the minimum Writer build', async () => {
    await serverMinBuilds({ writer: '150' })

    expect((await openedEditor()).getAttribute('data-editable')).toBe('false')
  })
})
