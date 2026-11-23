import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Realtime } from '@/platform/realtime'
import type { Operation } from '@/platform/transport'

import { subscribeDriveChanges } from './driveChanges'

const reference = (owner: string, id: string) => fromPartial<Operation>({ owner, id })

function subscribed() {
  const subscribe = vi.fn<(event: string, handler: (payload: unknown) => void) => () => void>()
  const invalidate = vi.fn<(matches: (reference: Operation) => boolean) => void>()
  subscribeDriveChanges(fromPartial<Realtime>({ subscribe }), invalidate)
  const send = (name: string) => {
    for (const [event, handler] of subscribe.mock.calls) if (event === name) handler({})
  }
  return { send, invalidate }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('refreshes every Drive read once for a burst of changes within 400 ms', () => {
  const { send, invalidate } = subscribed()

  send('drive:changed')
  vi.advanceTimersByTime(150)
  send('drive:changed')
  send('drive:changed')
  expect(invalidate).not.toHaveBeenCalled()

  vi.advanceTimersByTime(250)
  expect(invalidate).toHaveBeenCalledTimes(1)
  const matches = invalidate.mock.calls[0]![0]
  expect(matches(reference('drive', 'node_children'))).toBe(true)
  expect(matches(reference('drive', 'view_list'))).toBe(true)
  expect(matches(reference('mail', 'list'))).toBe(false)

  vi.advanceTimersByTime(500)
  expect(invalidate).toHaveBeenCalledTimes(1)
})

it('refreshes only the views when a visit is announced', () => {
  const { send, invalidate } = subscribed()

  send('drive:recent')
  vi.advanceTimersByTime(400)

  const matches = invalidate.mock.calls[0]![0]
  expect(matches(reference('drive', 'view_list'))).toBe(true)
  expect(matches(reference('drive', 'node_children'))).toBe(false)
})
