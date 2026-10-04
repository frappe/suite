import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { GUEST_FRAME_KEY } from '@/platform/contracts'
import { installPageMeta, openingTitleState } from '@/platform/page-meta'
import { TransportError } from '@/platform/transport'

import DocumentHost, { selectDocumentSurface } from './DocumentHost.vue'

const testState = vi.hoisted(() => ({
  open: vi.fn(),
  dispose: vi.fn(),
  nodeLocked: vi.fn(),
  surface: { name: 'WriterTestSurface', render: (): unknown => null },
  preview: { name: 'FileTestSurface', props: ['session'], render: (): unknown => null },
}))

vi.mock('@/apps/drive', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  const { openingTitleState } = await import('@/platform/page-meta')
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
    driveNodeRoute: (node: string, title: string) => ({
      path: `/d/${node}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      state: openingTitleState(title),
    }),
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
  ],
}))

// The surfaces mark themselves, so a test can wait for the document to show.
testState.surface.render = () => h('div', { 'data-surface': '' })
testState.preview.render = function (this: { session: { title: { value: string } } }) {
  return h('div', { 'data-preview': '' }, this.session.title.value)
}

async function mountHost(provide?: (app: ReturnType<typeof createApp>) => void) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/d/:node/:slug?', component: DocumentHost }],
  })
  await router.push('/d/node-1/quarterly-plan')
  await router.isReady()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(defineComponent({ setup: () => () => h(DocumentHost) }))
  provide?.(app)
  app.use(router)
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
      routes: [{ path: '/d/:node/:slug?', component: DocumentHost }],
    })
    await router.push('/d/node-1/stale')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router)
    app.mount(root)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/d/node-1/quarterly-plan'))
    expect(router.options.history.state.back).toBeFalsy()
    app.unmount()
    expect(testState.dispose).toHaveBeenCalledOnce()
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
      routes: [{ path: '/d/:node/:slug?', component: DocumentHost, meta: { title: 'Opening…' } }],
    })
    const uninstall = installPageMeta(router)
    await router.push({ path: '/d/node-1/q3', state: openingTitleState('Q3 plan') })
    // Before the host mounts, the route already carries the opener's title.
    expect(document.title).toBe('Q3 plan')
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router)
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
      routes: [{ path: '/d/:node/:slug?', component: DocumentHost }],
    })
    await router.push('/d/node-1/quarterly-plan')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router)
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
    await vi.waitFor(() => expect(root.textContent).toContain('You do not have access'))
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
    testState.open
      .mockRejectedValueOnce(
        new TransportError({ type: 'ServerError', message: 'Internal Server Error', status: 500 }),
      )
      .mockResolvedValueOnce(session())
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/d/:node/:slug?', component: DocumentHost }],
    })
    await router.push('/d/node-1/quarterly-plan')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(DocumentHost)
    app.use(router)
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
})
