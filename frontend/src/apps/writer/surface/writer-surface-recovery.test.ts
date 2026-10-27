import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import {
  buttonLabelled,
  discardCopies,
  liveRoom,
  oneVersion,
  openedSurface,
  previewAndReturn,
  resetSurface,
  settled,
  STOPPED,
  stoppedRoom,
  stripTexts,
} from './writer-surface-fixtures'

vi.hoisted(() => {
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.stubEnv('DEV', false)
})

vi.mock('frappe-ui', async () => (await import('./writer-surface-fakes')).fakeFrappeUi())
vi.mock('@/apps/drive', async () => (await import('./writer-surface-fakes')).fakeDrive())
vi.mock('@/apps/writer/components/CoreEditor.vue', async () =>
  (await import('./writer-surface-fakes')).fakeCoreEditor(),
)
vi.mock('@/apps/writer/collab', () => ({
  BODY_FIELD: 'default',
}))
vi.mock('@/platform/collab', async () =>
  (await import('./writer-surface-fakes')).fakeCollabPlatform(),
)
vi.mock('./writerDocument', async (importOriginal) => {
  const { fakeWriterDocument } = await import('./writer-surface-fakes')
  return fakeWriterDocument(await importOriginal<typeof import('./writerDocument')>())
})
vi.mock('@/apps/writer/components/CollabTextEditor.vue', async (importOriginal) => {
  const { fakeCollabTextEditor } = await import('./writer-surface-fakes')
  const real =
    await importOriginal<typeof import('@/apps/writer/components/CollabTextEditor.vue')>()
  return fakeCollabTextEditor(real)
})
vi.mock('@/apps/writer/components/UsersBar.vue', () => ({ default: { render: () => null } }))
vi.mock('./WriterDocumentMenu.vue', async () =>
  (await import('./writer-surface-fakes')).fakeDocumentMenu(),
)
vi.mock('@/apps/writer/composables/useUsers', async (importOriginal) => {
  const { fakeUsers } = await import('./writer-surface-fakes')
  return fakeUsers(await importOriginal<typeof import('@/apps/writer/composables/useUsers')>())
})
vi.mock('./VersionPreview.vue', async () =>
  (await import('./writer-surface-fakes')).fakeVersionPreview(),
)

const { discardCopy, keepPageCopy, listCopies } = await import('@/apps/writer/recovery/copies')

afterEach(resetSurface)

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

describe('Writer surface', () => {
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
      room.status = { ...room.status, saveState: 'failed', unsentCount: 1 }
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
