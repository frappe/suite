import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, shallowRef, type App } from 'vue'
import { Awareness } from 'y-protocols/awareness'
import { Doc } from 'yjs'

import type { Peer, RoomPresence } from '@/platform/collab'

vi.mock('@/platform/session', () => ({ useSession: () => ({ user: ref({ id: 'me' }) }) }))
vi.mock('@/platform/collab/names', () => ({
  fullName: (user: string) => ({ asha: 'Asha Rao', ben: 'Ben Roy' })[user] ?? user,
  lookUp: async () => {},
}))
const currentSlide = ref({ elements: [{ id: 'one' }, { id: 'two' }] })
vi.mock('@/apps/slides/stores/slide', () => ({ currentSlide }))

const { default: PeerOutlines } = await import('./PeerOutlines.vue')
const { registerElementDiv } = await import('@/apps/slides/stores/elementRegistry')

function elementAt(id: string, left: string, top: string) {
  const div = document.createElement('div')
  div.style.left = left
  div.style.top = top
  // its size on the slide
  Object.defineProperty(div, 'offsetWidth', { value: 400 })
  Object.defineProperty(div, 'offsetHeight', { value: 100 })
  registerElementDiv(id, div)
}

function room(peers: Peer[]) {
  const awareness = new Awareness(new Doc())
  const presence: RoomPresence = {
    awareness,
    peers,
    ownPid: 1,
    ownArrival: 0,
    onChange: () => () => {},
  }
  function select(pid: number, elements: string[]) {
    awareness.states.set(pid, { cursor: { elements, count: elements.length } })
    awareness.emit('change', [{ added: [], updated: [pid], removed: [] }, 'test'])
  }

  return { presence, select }
}

function tab(pid: number, user: string, idleSince: number | null = null): Peer {
  return { pid, user, arrival: pid, idleSince }
}

let app: App | undefined

async function outlines(presence: RoomPresence, scale = 1) {
  const host = document.createElement('div')
  app = createApp({ render: () => h(PeerOutlines, { scale }) })
  app.provide('livePresence', shallowRef(presence))
  app.mount(host)
  await nextTick()
  return host
}

function outlineIn(host: HTMLElement) {
  return host.querySelector<HTMLElement>('[data-peer-outline]')
}

function nameIn(host: HTMLElement) {
  return host.querySelector('[data-peer-name]:not([data-shrunk])')
}

function scaleOf(element: HTMLElement) {
  return Number(/scale\((.+)\)/.exec(element.style.transform)![1])
}

describe('PeerOutlines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    elementAt('one', '40px', '60px')
    elementAt('two', '90px', '10px')
  })
  afterEach(() => {
    app?.unmount()
    vi.useRealTimers()
  })

  it('shows the name again when they type with the caret where it was', async () => {
    const { presence, select } = room([tab(5, 'asha')])
    const host = await outlines(presence)
    select(5, ['one'])
    await nextTick()
    await nextTick()
    vi.advanceTimersByTime(3001)
    await nextTick()
    expect(nameIn(host)).toBeNull()

    presence.awareness.states.set(5, { cursor: { elements: ['one'], count: 1 }, typed: 1 })
    presence.awareness.emit('change', [{ added: [], updated: [5], removed: [] }, 'test'])
    await nextTick()
    await nextTick()

    expect(nameIn(host)).not.toBeNull()
  })

  it('outlines what a co-editor selects, at that element, under their first name', async () => {
    const { presence, select } = room([tab(5, 'asha')])
    const host = await outlines(presence)

    select(5, ['one'])
    await nextTick()
    await nextTick()

    const outline = outlineIn(host)
    expect(outline?.style.left).toBe('40px')
    expect(outline?.style.top).toBe('60px')
    expect(outline?.textContent?.trim()).toBe('Asha')
  })

  it("draws the outline with the name tab's 1.5px line, whatever the zoom", async () => {
    const { presence, select } = room([tab(5, 'asha')])
    const host = await outlines(presence, 0.5)

    select(5, ['one'])
    await nextTick()
    await nextTick()

    const layer = host.querySelector<HTMLElement>('[data-peer-layer]')!
    const line = host.querySelector('[data-peer-line]')!
    const tabLine = nameIn(host)!.querySelector('path[stroke]')!
    // the slide's zoom times the layer's
    const onScreen = 0.5 * scaleOf(layer)
    expect(Number(line.getAttribute('stroke-width')) * onScreen).toBe(1.5)
    expect(Number(tabLine.getAttribute('stroke-width')) * onScreen).toBe(1.5)
    expect(Number(line.getAttribute('width')) * scaleOf(layer)).toBe(400)
    expect(Number(line.getAttribute('height')) * scaleOf(layer)).toBe(100)
  })

  it('shows nothing while a co-editor has nothing selected', async () => {
    const { presence, select } = room([tab(5, 'asha')])
    const host = await outlines(presence)

    select(5, ['one'])
    select(5, [])
    await nextTick()
    await nextTick()

    expect(outlineIn(host)).toBeNull()
  })

  it('shrinks the name to a dot three seconds after they acted, and hover brings it back', async () => {
    const { presence, select } = room([tab(5, 'asha')])
    const host = await outlines(presence)
    select(5, ['one'])
    await nextTick()
    await nextTick()

    vi.advanceTimersByTime(2999)
    await nextTick()
    expect(nameIn(host)).not.toBeNull()

    vi.advanceTimersByTime(2)
    await nextTick()
    expect(nameIn(host)).toBeNull()
    // still there, so it can shrink into the dot rather than vanish
    expect(host.querySelector('[data-peer-name][data-shrunk]')).not.toBeNull()

    host
      .querySelector('[data-peer-dot]')
      ?.parentElement?.dispatchEvent(new MouseEvent('mouseenter'))
    await nextTick()
    expect(nameIn(host)).not.toBeNull()
  })

  it('brings the name back when they act again', async () => {
    const { presence, select } = room([tab(5, 'asha')])
    const host = await outlines(presence)
    select(5, ['one'])
    await nextTick()
    vi.advanceTimersByTime(4000)
    await nextTick()

    select(5, ['two'])
    await nextTick()
    await nextTick()

    expect(nameIn(host)).not.toBeNull()
  })

  it('dims the outline of someone idle', async () => {
    const { presence, select } = room([tab(5, 'asha', 1000)])
    const host = await outlines(presence)

    select(5, ['one'])
    await nextTick()
    await nextTick()

    expect(outlineIn(host)?.classList).toContain('opacity-50')
  })

  it("follows the most recent of one person's tabs", async () => {
    const { presence, select } = room([tab(5, 'asha'), tab(6, 'asha')])
    const host = await outlines(presence)

    select(5, ['one'])
    vi.advanceTimersByTime(10)
    select(6, ['two'])
    await nextTick()
    await nextTick()

    const shown = host.querySelectorAll<HTMLElement>('[data-peer-outline]')
    expect(shown).toHaveLength(1)
    expect(shown[0].style.left).toBe('90px')
  })
})
