import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type HistoryState } from 'vue-router'

import { GUEST_FRAME_KEY } from '@/platform/contracts'
import { installPageMeta, mentionedByState, openingTitleState } from '@/platform/page-meta'
import { translationPlugin } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

import DocumentHost, { selectDocumentSurface } from './DocumentHost.vue'

const testState = vi.hoisted(() => ({
  open: vi.fn(),
  dispose: vi.fn(),
  nodeLocked: vi.fn(),
  forget: vi.fn(),
  surface: { name: 'WriterTestSurface', render: (): unknown => null },
  preview: { name: 'FileTestSurface', props: ['session'], render: (): unknown => null },
}))

vi.mock('@/apps/drive', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  const { driveNodeRoute } = await vi.importActual<typeof import('@/apps/drive')>('@/apps/drive')
  return {
    // Stands in for the password form: a click is a right password.
    DriveUnlockScreen: define({
      emits: ['unlocked'],
      setup:
        (_props, { emit }) =>
        () =>
          render(
            'button',
            { 'data-unlock': '', onClick: () => emit('unlocked') },
            'Password required',
          ),
    }),
    isDriveLocked: (error: { type?: string }) => error?.type === 'DriveLocked',
    isDriveNodeLocked: testState.nodeLocked,
    filePreviewSurface: testState.preview,
    openDocumentSession: testState.open,
    driveNodeRoute,
    DriveDocumentHeaderSkeleton: define({
      props: { title: String },
      setup: (props) => () => render('header', { 'data-skeleton': '' }, props.title),
    }),
  }
})

vi.mock('@/composition/documentRegistry', () => ({
  documentTypes: [
    {
      contentDoctype: 'Writer Document',
      newLabel: () => 'New document',
      icon: {},
      loadSurface: async () => testState.surface,
    },
    {
      contentDoctype: 'Presentation',
      newLabel: () => 'New presentation',
      icon: {},
      loadSurface: async () => testState.surface,
      forgetNode: testState.forget,
    },
  ],
}))

// The surfaces mark themselves, so a test can wait for the document to show.
testState.surface.render = () => h('div', { 'data-surface': '' })
testState.preview.render = function (this: { session: { title: { value: string } } }) {
  return h('div', { 'data-preview': '' }, this.session.title.value)
}

async function mountHost(
  provide?: (app: ReturnType<typeof createApp>) => void,
  state?: HistoryState,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/d/:node/:slug?', name: 'document-host', component: DocumentHost }],
  })
  await router.push({ path: '/d/node-1/quarterly-plan', state })
  await router.isReady()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(defineComponent({ setup: () => () => h(DocumentHost) }))
  provide?.(app)
  app.use(router).use(translationPlugin)
  app.mount(root)
  return { root, app }
}

const refusal = (status: number, type: string) =>
  new TransportError({ status, type, message: type })

function session(contentDoctype = 'Writer Document') {
  return {
    nodeId: 'node-1',
    contentDoctype,
    contentDocname: 'content-1',
    title: ref('Quarterly plan'),
    state: ref('Active'),
    access: ref({ role: 40 }),
    dispose: testState.dispose,
  } as any
}

afterEach(() => {
  testState.open.mockReset()
  testState.dispose.mockReset()
  testState.nodeLocked.mockReset()
  testState.forget.mockReset()
  document.cookie = 'user_id=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.body.innerHTML = ''
})

describe('DocumentHost', () => {
  it('selects the registered product adapter and the Drive file surface', async () => {
    const definitions = [
      {
        contentDoctype: 'Writer Document',
        newLabel: () => 'New document',
        icon: {},
        loadSurface: async () => testState.surface,
      },
    ] as any
    expect(await selectDocumentSurface(session(), definitions)).toBe(testState.surface)
    expect(await selectDocumentSurface(session('File'), definitions)).toBe(testState.preview)
    expect(await selectDocumentSurface(session('Unknown'), definitions)).toBeNull()
  })

  it('replacement-navigates a stale decorative slug', async () => {
    testState.open.mockResolvedValue(session())
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/d/:node/:slug?', name: 'document-host', component: DocumentHost }],
    })
    await router.push('/d/node-1/stale')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router).use(translationPlugin)
    app.mount(root)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/d/node-1/quarterly-plan'))
    expect(router.options.history.state.back).toBeFalsy()
    app.unmount()
    expect(testState.dispose).toHaveBeenCalledOnce()
  })

  it('keeps the document open through its slideshow, and its slug once back', async () => {
    testState.open.mockResolvedValue(session())
    const view = { render: (): unknown => null }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/d/:node',
          component: DocumentHost,
          children: [
            { path: 'present', name: 'slides-slideshow', component: view },
            { path: ':slug?', name: 'document-host', component: view },
          ],
        },
      ],
    })
    await router.push('/d/node-1/present?slide=2')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(defineComponent({ setup: () => () => h(RouterView) }))
    app.use(router).use(translationPlugin)
    app.mount(root)
    await vi.waitFor(() => expect(root.querySelector('[data-surface]')).not.toBeNull())
    expect(router.currentRoute.value.fullPath).toBe('/d/node-1/present?slide=2')

    await router.replace({ name: 'document-host', params: { node: 'node-1' }, query: { slide: 2 } })
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/d/node-1/quarterly-plan?slide=2'),
    )
    expect(testState.open).toHaveBeenCalledOnce()
    expect(testState.dispose).not.toHaveBeenCalled()
    app.unmount()
  })

  it('drops the slug when a rename would turn it into a view', async () => {
    const opened = session()
    testState.open.mockResolvedValue(opened)
    const view = { render: (): unknown => null }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/d/:node',
          component: DocumentHost,
          children: [
            { path: 'present', name: 'slides-slideshow', component: view },
            { path: ':slug?', name: 'document-host', component: view },
          ],
        },
      ],
    })
    await router.push('/d/node-1/quarterly-plan')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(defineComponent({ setup: () => () => h(RouterView) }))
    app.use(router).use(translationPlugin)
    app.mount(root)
    await vi.waitFor(() => expect(root.querySelector('[data-surface]')).not.toBeNull())

    opened.title.value = 'Present'
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/d/node-1'))
    expect(router.currentRoute.value.name).toBe('document-host')
    app.unmount()
  })

  it("names the tab from the first frame: the opener's title, else Opening…, then the document's", async () => {
    let answer!: (value: unknown) => void
    testState.open.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/d/:node/:slug?',
          name: 'document-host',
          component: DocumentHost,
          meta: { title: 'Opening…' },
        },
      ],
    })
    const uninstall = installPageMeta(router)
    await router.push({ path: '/d/node-1/q3', state: openingTitleState('Q3 plan') })
    // Before the host mounts, the route already carries the opener's title.
    expect(document.title).toBe('Q3 plan')
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router).use(translationPlugin)
    app.mount(root)
    expect(root.querySelector('[data-skeleton]')?.textContent).toBe('Q3 plan')

    answer(session())
    await vi.waitFor(() => expect(document.title).toBe('Quarterly plan'))

    testState.open.mockReturnValue(new Promise(() => {}))
    await router.push('/d/node-2')
    await vi.waitFor(() => expect(document.title).toBe('Opening…'))
    app.unmount()
    uninstall()
  })

  it('keeps a file preview on screen while the next file opens, then shows the next one', async () => {
    const first = { ...session('File'), dispose: vi.fn() }
    const second = {
      ...session('File'),
      nodeId: 'node-2',
      title: ref('Budget.pdf'),
      dispose: vi.fn(),
    }
    let answer!: (value: unknown) => void
    testState.open.mockResolvedValueOnce(first).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/d/:node/:slug?', name: 'document-host', component: DocumentHost }],
    })
    await router.push('/d/node-1/quarterly-plan')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router).use(translationPlugin)
    app.mount(root)
    await vi.waitFor(() =>
      expect(root.querySelector('[data-preview]')?.textContent).toBe('Quarterly plan'),
    )

    await router.push('/d/node-2/budget-pdf')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(root.querySelector('[data-skeleton]')).toBeNull()
    expect(root.querySelector('[data-preview]')?.textContent).toBe('Quarterly plan')
    expect(first.dispose).not.toHaveBeenCalled()

    answer(second)
    await vi.waitFor(() =>
      expect(root.querySelector('[data-preview]')?.textContent).toBe('Budget.pdf'),
    )
    expect(first.dispose).toHaveBeenCalledOnce()
    app.unmount()
  })

  it('shows the unlock screen in place for a locked link, and opens the document once unlocked', async () => {
    testState.open.mockRejectedValueOnce(refusal(401, 'DriveLocked')).mockResolvedValue(session())
    const { root, app } = await mountHost()

    await vi.waitFor(() => expect(root.querySelector('[data-unlock]')).not.toBeNull())
    expect(root.textContent).not.toContain('Quarterly plan')
    root.querySelector<HTMLButtonElement>('[data-unlock]')!.click()

    await vi.waitFor(() => expect(root.querySelector('[data-unlock]')).toBeNull())
    expect(testState.open).toHaveBeenCalledTimes(2)
    app.unmount()
  })

  it("asks for the password again when an open document's unlock ticket expires", async () => {
    const open = session()
    testState.open.mockResolvedValue(open)
    testState.nodeLocked.mockResolvedValue(true)
    const { root, app } = await mountHost()
    await vi.waitFor(() => expect(root.querySelector('[data-surface]')).not.toBeNull())

    open.state.value = 'Refused'

    await vi.waitFor(() => expect(root.querySelector('[data-unlock]')).not.toBeNull())
    expect(testState.open).toHaveBeenCalledOnce()
    expect(testState.dispose).toHaveBeenCalledOnce()
    root.querySelector<HTMLButtonElement>('[data-unlock]')!.click()
    await vi.waitFor(() => expect(testState.open).toHaveBeenCalledTimes(2))
    app.unmount()
  })

  it('shows the refusal for any other lapse, and never reopens by itself', async () => {
    const open = session()
    testState.open.mockResolvedValue(open)
    testState.nodeLocked.mockResolvedValue(false)
    const { root, app } = await mountHost()
    await vi.waitFor(() => expect(root.querySelector('[data-surface]')).not.toBeNull())

    open.state.value = 'Refused'
    await vi.waitFor(() =>
      expect(root.textContent).toContain('You don’t have access to this document.'),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(testState.nodeLocked).toHaveBeenCalledOnce()
    expect(testState.open).toHaveBeenCalledOnce()
    expect(root.querySelector('[data-unlock]')).toBeNull()
    app.unmount()
  })

  it('shows a guest the Sign-in screen when a link stops working while the document is open', async () => {
    const open = session()
    testState.open.mockResolvedValue(open)
    testState.nodeLocked.mockResolvedValue(false)
    const requireSignIn = vi.fn()
    const { root, app } = await mountHost((host) =>
      host.provide(GUEST_FRAME_KEY, { requireSignIn }),
    )
    await vi.waitFor(() => expect(root.querySelector('[data-surface]')).not.toBeNull())

    open.state.value = 'Refused'
    await vi.waitFor(() => expect(requireSignIn).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(testState.open).toHaveBeenCalledOnce()
    app.unmount()
  })

  it('asks the guest frame for the Sign-in screen and says nothing about the item', async () => {
    testState.open.mockRejectedValue(refusal(404, 'DriveNotFound'))
    const requireSignIn = vi.fn()
    const { root, app } = await mountHost((host) =>
      host.provide(GUEST_FRAME_KEY, { requireSignIn }),
    )

    await vi.waitFor(() => expect(requireSignIn).toHaveBeenCalledOnce())
    expect(root.textContent).not.toMatch(/not found|could not open/i)
    app.unmount()
  })

  it("says why a document didn't open and opens it on retry", async () => {
    const serverError = new TransportError({
      type: 'ServerError',
      message: 'Internal Server Error',
      status: 500,
    })
    testState.open.mockRejectedValueOnce(serverError).mockResolvedValueOnce(session())
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/d/:node/:slug?', name: 'document-host', component: DocumentHost }],
    })
    await router.push('/d/node-1/quarterly-plan')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router).use(translationPlugin)
    app.mount(root)
    await vi.waitFor(() =>
      expect(root.textContent).toContain(
        'The server had a problem opening this document. Try again in a moment.',
      ),
    )
    root.querySelector<HTMLButtonElement>("button[label='Try again']")!.click()
    await vi.waitFor(() => expect(root.textContent).not.toContain('Could not open this document'))
    expect(testState.open).toHaveBeenCalledTimes(2)
    expect(root.querySelector("[aria-label='Opening document']")).toBeNull()
    app.unmount()
  })

  // a device copy of a document the user lost access to goes (DESIGN-slides-offline §6)
  it.each([403, 404, 410])(
    'forgets the node on every type that keeps copies when the open is a %i',
    async (status) => {
      document.cookie = 'user_id=owner@example.com'
      testState.open.mockRejectedValue(refusal(status, 'Refused'))
      const { root, app } = await mountHost()

      await vi.waitFor(() =>
        expect(root.textContent).toContain('You don’t have access to this document.'),
      )
      expect(testState.forget).toHaveBeenCalledExactlyOnceWith('node-1')
      app.unmount()
    },
  )

  it('keeps the node when a signed-out open is refused', async () => {
    testState.open.mockRejectedValue(refusal(403, 'Refused'))
    const { root, app } = await mountHost()

    await vi.waitFor(() =>
      expect(root.textContent).toContain('You don’t have access to this document.'),
    )
    expect(testState.forget).not.toHaveBeenCalled()
    app.unmount()
  })

  it.each([403, 404, 410])('a %i names no internal id and offers no retry', async (status) => {
    testState.open.mockRejectedValue(refusal(status, 'Drive node node-1 was not found'))
    const { root, app } = await mountHost()

    await vi.waitFor(() =>
      expect(root.textContent).toContain('You don’t have access to this document.'),
    )
    expect(root.textContent).not.toContain('node-1')
    expect(root.textContent).not.toContain('not found')
    expect(root.textContent).not.toContain('Ask')
    expect(root.querySelector('button')).toBeNull()
    app.unmount()
  })

  it('asks the person who mentioned the reader when the bell led here', async () => {
    testState.open.mockRejectedValue(refusal(404, 'Refused'))
    const { root, app } = await mountHost(undefined, mentionedByState('Sam Rao'))

    await vi.waitFor(() => expect(root.textContent).toContain('Ask Sam Rao to share it.'))
    app.unmount()
  })

  it('forgets the node when an open document is refused', async () => {
    const open = session()
    testState.open.mockResolvedValue(open)
    testState.nodeLocked.mockResolvedValue(false)
    const { root, app } = await mountHost()
    await vi.waitFor(() => expect(root.querySelector('[data-surface]')).not.toBeNull())
    expect(testState.forget).not.toHaveBeenCalled()

    open.state.value = 'Refused'

    await vi.waitFor(() => expect(testState.forget).toHaveBeenCalledExactlyOnceWith('node-1'))
    app.unmount()
  })

  it.each([
    [
      'an offline open',
      new TransportError({ type: 'NetworkError', message: 'offline', status: 0 }),
    ],
    ['a server error', new TransportError({ type: 'ServerError', message: 'boom', status: 500 })],
  ])('keeps the node after %s', async (_label, reason) => {
    document.cookie = 'user_id=owner@example.com'
    testState.open.mockRejectedValue(reason)
    const { root, app } = await mountHost()

    await vi.waitFor(() => expect(root.textContent).toContain('Could not open this document'))
    expect(root.querySelector('button')).not.toBeNull()
    expect(testState.forget).not.toHaveBeenCalled()
    app.unmount()
  })

  it('keeps both nodes when moving from one document to the next', async () => {
    testState.open
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce({ ...session(), nodeId: 'node-2', title: ref('Budget') })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/d/:node/:slug?', name: 'document-host', component: DocumentHost }],
    })
    await router.push('/d/node-1/quarterly-plan')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router).use(translationPlugin)
    app.mount(root)
    await vi.waitFor(() => expect(root.querySelector('[data-surface]')).not.toBeNull())

    await router.push('/d/node-2/budget')
    await vi.waitFor(() => expect(testState.open).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(root.querySelector('[data-surface]')).not.toBeNull())

    expect(testState.forget).not.toHaveBeenCalled()
    app.unmount()
  })
})
