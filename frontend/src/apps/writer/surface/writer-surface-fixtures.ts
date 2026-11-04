import { fakeSocket } from '@suite/collab-client/test-support'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { expect, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { Doc } from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { translationPlugin } from '@/platform/translation'

import { downloaded, realEditors, realtime, rooms, stored } from './writer-surface-fakes'

export type Versions = DocumentSession['versions']
export type Comments = DocumentSession['comments']

// The editor element's tiptap editor, as tiptap hangs it on the element
export type EditorElement = HTMLElement & { editor: TiptapEditor }

// jsdom lays nothing out, so has nothing to scroll
Element.prototype.scrollIntoView = () => {}

const { default: WriterSurface } = await import('./WriterSurface.vue')
const { discardCopy, listCopies } = await import('@/apps/writer/recovery/copies')

export async function openedSurface(
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
  createApp(shell).use(router).use(translationPlugin).mount(root)
  await vi.waitFor(() => expect(root.querySelector('[data-editor]')).not.toBeNull())
  await nextTick()
  return root
}

export function buttonLabelled(root: Element, label: string) {
  return [...root.querySelectorAll('button')].find(
    (button) => button.textContent === label || button.getAttribute('aria-label') === label,
  )
}

// The row in the versions list whose text starts with `label`
export function versionRow(root: Element, label: string) {
  const rows = [...root.querySelectorAll<HTMLElement>('aside button')]
  return rows.find((button) => button.textContent?.trim().startsWith(label))!
}

export function resetSurface() {
  document.body.innerHTML = ''
  rooms.next = null
  stored.html = ''
  stored.collab = 0
  realEditors.isOn = false
  stored.content = ''
  stored.conversion = null
  stored.reloads = 0
  realtime.socket = fakeSocket({ answers: true })
  downloaded.html = null
  vi.restoreAllMocks()
}

export function liveRoom() {
  const room = {
    doc: new Doc(),
    status: {
      canWrite: true,
      blockReason: null,
      pauseReason: null,
      saveState: 'clean',
      unsentCount: 0,
      isKeptOnDevice: true,
    } as Record<string, unknown>,
    onChange: () => () => {},
    flush: async () => {},
    close: vi.fn(async () => {}),
    loseAccess: vi.fn(async () => {}),
    regainAccess: vi.fn(async () => {}),
  }
  rooms.next = room
  return room
}

export async function previewAndReturn(
  root: Element,
  during: () => void | Promise<void> = () => {},
) {
  root.querySelector<HTMLElement>('[data-open-versions]')!.click()
  await vi.waitFor(() => expect(root.textContent).toContain('Before review'))
  versionRow(root, 'Before review').click()
  await nextTick()
  expect(root.querySelector('[data-preview]')).not.toBeNull()
  await during()
  versionRow(root, 'Current version').click()
  await nextTick()
}

export const oneVersion = {
  list: async () => ({
    rows: [{ seq: 3, kind: 'named', label: 'Before review' }],
    next_cursor: null,
  }),
} as unknown as Versions

export const STOPPED = 'Saving stopped in this tab. Reload to keep editing.'

// A live room whose saving failed for good, which the page shows as the stop strip
export function stoppedRoom() {
  const room = liveRoom()
  room.status = { ...room.status, saveState: 'failed', unsentCount: 1 }
  return room
}

// Each shown strip's message, without its buttons
export function stripTexts(root: Element) {
  const strips = [...root.querySelectorAll('[role="status"]')]
  return strips.map((strip) => strip.querySelector('p')?.textContent?.trim() ?? '')
}

const RECOVERY_READ_MS = 50

// Lets the recovery strip finish reading the device's copies
export async function settled() {
  await new Promise((resolve) => setTimeout(resolve, RECOVERY_READ_MS))
  await nextTick()
}

export async function discardCopies() {
  for (const copy of await listCopies('node-1')) {
    await discardCopy(copy)
  }
}
