import { toast } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { applyUpdate, Doc, encodeStateAsUpdate, encodeStateVector, XmlElement, XmlText } from 'yjs'

import { client } from '@/api'

import { downloadHTML } from './exports'
import {
  buttonLabelled,
  discardCopies,
  liveRoom,
  oneVersion,
  openedSurface,
  previewAndReturn,
  resetSurface,
  versionRow,
  type EditorElement,
  type Versions,
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
vi.mock('./exports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./exports')>()),
  downloadHTML: vi.fn(),
}))

const { keepPageCopy, listCopies } = await import('@/apps/writer/recovery/copies')

afterEach(resetSurface)

function shownText(root: Element) {
  return root.querySelector('[data-editor] .ProseMirror')!.textContent
}

// A live room that lands any restore, whose saved version 3 reads `text`
async function roomRestoring(text: string) {
  const room = Object.assign(liveRoom(), {
    lineage: 'one',
    isCommitted: () => true,
    restoreVersion: vi.fn(async (_seq: number, edit: () => void) => {
      edit()
      return { outcome: 'landed' }
    }),
  })
  const version = new Doc()
  const paragraph = new XmlElement('paragraph')
  paragraph.insert(0, [new XmlText(text)])
  version.getXmlFragment('default').insert(0, [paragraph])
  const raw = new Response(new Uint8Array(encodeStateAsUpdate(version))).body!
  const zipped = await new Response(raw.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  const state = btoa(String.fromCharCode(...new Uint8Array(zipped)))
  const body = JSON.stringify({ schema: 'writer-document/2', codec: 'yjs1', lineage: 'one', state })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body)),
  )
  return room
}

// Opens version 3 and presses Restore on its bar
async function restoreFromTheBar(versions: Versions) {
  const root = await openedSurface(versions)
  root.querySelector<HTMLElement>('[data-open-versions]')!.click()
  await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
  versionRow(root, 'Before review').click()
  await nextTick()
  const bar = [...root.querySelectorAll('[role="status"]')].find((status) =>
    status.textContent?.includes('Viewing Before review'),
  )!
  buttonLabelled(bar, 'Restore this version')!.click()
  return root
}

describe('Writer surface', () => {
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
    async function list() {
      return {
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
      }
    }

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
    liveRoom()
    const root = await openedSurface(oneVersion)

    root.querySelector<HTMLElement>('[data-save-version]')!.click()
    await vi.waitFor(() =>
      expect(root.querySelector('input[aria-label="Version name"]')).not.toBeNull(),
    )

    expect(document.activeElement).toBe(root.querySelector('input[aria-label="Version name"]'))
    expect(root.querySelector('aside')?.textContent).toContain('Before review')
  })

  it('opens the Versions name box from Save version on Current version, with the cursor in it', async () => {
    liveRoom()
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

  it.each([
    [
      'the document menu',
      (root: Element) => root.querySelector<HTMLElement>('[data-save-version]')!,
    ],
    [
      'the Versions panel',
      (root: Element) => buttonLabelled(root.querySelector('aside')!, 'Save version')!,
    ],
  ])('closes a shown version before naming one from %s', async (_, saveButton) => {
    liveRoom()
    const create = vi.fn(async () => ({}))
    const root = await openedSurface({ ...oneVersion, create } as unknown as Versions)
    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
    versionRow(root, 'Before review').click()
    await nextTick()
    expect(root.querySelector('[data-preview]')).not.toBeNull()

    saveButton(root).click()
    await vi.waitFor(() =>
      expect(root.querySelector('input[aria-label="Version name"]')).not.toBeNull(),
    )
    expect(root.querySelector('[data-preview]')).toBeNull()
    expect(root.querySelector<HTMLElement>('[data-editor]')!.style.display).not.toBe('none')

    const name = root.querySelector<HTMLInputElement>('input[aria-label="Version name"]')!
    name.value = 'After review'
    name.dispatchEvent(new Event('input'))
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith('named', 'After review'))
    expect(root.querySelector('[data-preview]')).toBeNull()
  })

  it.each([
    [
      'the document menu',
      (root: Element) => root.querySelector<HTMLElement>('[data-save-version]')!,
    ],
    [
      'the Versions panel',
      (root: Element) => buttonLabelled(root.querySelector('aside')!, 'Save version')!,
    ],
  ])('closes a shown recovery copy before naming a version from %s', async (_, saveButton) => {
    liveRoom()
    keepPageCopy('node-1', 'Quarterly plan', '<p>Typed while offline</p>')
    const [copy] = await listCopies('node-1')
    const key = encodeURIComponent(copy.key)
    const create = vi.fn(async () => ({}))
    const root = await openedSurface(
      { ...oneVersion, create } as unknown as Versions,
      `/d/node-1?recovery=${key}`,
    )
    await vi.waitFor(() => expect(root.textContent).toContain('Viewing recovery copy from'))
    root.querySelector<HTMLElement>('[data-open-versions]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Before review'))

    saveButton(root).click()
    await vi.waitFor(() =>
      expect(root.querySelector('input[aria-label="Version name"]')).not.toBeNull(),
    )
    expect(root.textContent).not.toContain('Viewing recovery copy from')
    expect(root.querySelector<HTMLElement>('[data-editor]')!.style.display).not.toBe('none')

    const name = root.querySelector<HTMLInputElement>('input[aria-label="Version name"]')!
    name.value = 'After review'
    name.dispatchEvent(new Event('input'))
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith('named', 'After review'))
    expect(root.textContent).not.toContain('Viewing recovery copy from')
    await discardCopies()
  })

  it('shows a version in place of the editor until Current version', async () => {
    const list = vi.fn(async () => ({
      rows: [{ seq: 3, kind: 'named', label: 'Before review' }],
      next_cursor: null,
    }))
    const root = await openedSurface({ list } as unknown as Versions)
    function editorShown() {
      return root.querySelector<HTMLElement>('[data-editor]')!.style.display !== 'none'
    }

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

  it('restores the shown version from the version bar', async () => {
    const room = await roomRestoring('Back then')
    const versions = { ...oneVersion, contentUrl: () => '/version/3' } as unknown as Versions
    const root = await restoreFromTheBar(versions)

    await vi.waitFor(() => expect(shownText(root)).toBe('Back then'))
    expect(room.restoreVersion.mock.calls.map(([seq]) => seq)).toEqual([3])
    expect(root.querySelector('[data-preview]')).toBeNull()
  })

  it('offers the download of an old version the converter refuses, from the error it shows', async () => {
    const room = await roomRestoring('Back then')
    const old = { schema: 'writer-document/1', content: 'AAA=', html: '<p>Back then</p>' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(old))),
    )
    vi.spyOn(client, 'mutation').mockResolvedValue({ reason: 'crashed' })
    const error = vi.spyOn(toast, 'error')
    await restoreFromTheBar({
      ...oneVersion,
      contentUrl: () => '/version/3',
    } as unknown as Versions)

    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
    const [message, options] = error.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ]
    expect([message, options.action.label]).toEqual([
      "This version couldn't be upgraded, so it can't be restored. You can download it. Reason: crashed.",
      'Download',
    ])
    expect(room.restoreVersion).not.toHaveBeenCalled()

    options.action.onClick()
    await vi.waitFor(() => expect(downloadHTML).toHaveBeenCalledOnce())
    const [html, name] = vi.mocked(downloadHTML).mock.calls[0]
    expect([html, name]).toEqual([
      expect.stringContaining('Back then'),
      'Quarterly plan (Before review)',
    ])
  })

  it('says the version was not restored when the restore fails', async () => {
    const room = await roomRestoring('Back then')
    room.restoreVersion.mockRejectedValue(new Error('Socket closed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = vi.spyOn(toast, 'error')
    const success = vi.spyOn(toast, 'success')
    await restoreFromTheBar({
      ...oneVersion,
      contentUrl: () => '/version/3',
    } as unknown as Versions)

    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
    expect([error.mock.calls[0], success.mock.calls]).toEqual([
      ['The version was not restored.'],
      [],
    ])
  })

  it('shows edits made in another tab while a version was previewed', async () => {
    const room = liveRoom()
    const root = await openedSurface(oneVersion)
    const otherTab = new Doc()
    applyUpdate(otherTab, encodeStateAsUpdate(room.doc))

    function typeInOtherTab() {
      const paragraph = new XmlElement('paragraph')
      paragraph.insert(0, [new XmlText('Typed in the other tab')])
      otherTab.getXmlFragment('default').insert(0, [paragraph])
      const roomVector = encodeStateVector(room.doc)
      const missing = encodeStateAsUpdate(otherTab, roomVector)
      applyUpdate(room.doc, missing)
    }

    await previewAndReturn(root, typeInOtherTab)

    expect(shownText(root)).toContain('Typed in the other tab')
    expect(room.close).not.toHaveBeenCalled()
  })

  it('keeps text typed just before a preview, undoable and on its way to other tabs', async () => {
    const room = liveRoom()
    const root = await openedSurface(oneVersion)
    function editor() {
      return root.querySelector<EditorElement>('[data-editor] .ProseMirror')!.editor
    }

    editor().commands.insertContent('Typed here first')
    await previewAndReturn(root)

    expect(shownText(root)).toContain('Typed here first')
    const otherTab = new Doc()
    applyUpdate(otherTab, encodeStateAsUpdate(room.doc))
    expect(otherTab.getXmlFragment('default').toString()).toContain('Typed here first')
    editor().commands.undo()
    expect(shownText(root)).not.toContain('Typed here first')
  })
})
