import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { SessionState } from '@/apps/drive'

import { createSheetAccess } from './access'

function fakeSession(role: number, state: SessionState = 'Active') {
  return {
    state: ref<SessionState>(state),
    access: ref<{ role?: number }>({ role }),
  }
}

describe('Sheets access', () => {
  it('follows the role Drive grants', async () => {
    const session = fakeSession(40)
    const access = createSheetAccess(session, {})
    expect([access.readable.value, access.canComment.value, access.writable.value]).toEqual([
      true,
      true,
      true,
    ])

    session.access.value = { role: 20 }
    expect([access.readable.value, access.canComment.value, access.writable.value]).toEqual([
      true,
      true,
      false,
    ])

    session.access.value = { role: 10 }
    expect([access.readable.value, access.canComment.value, access.writable.value]).toEqual([
      true,
      false,
      false,
    ])

    session.state.value = 'Refused'
    session.access.value = {}
    expect(access.readable.value).toBe(false)
  })

  it('keeps a trashed spreadsheet read-only whatever the role', () => {
    const access = createSheetAccess(fakeSession(50, 'Trashed'), {})
    expect(access.readable.value).toBe(true)
    expect(access.writable.value).toBe(false)
    expect(access.canComment.value).toBe(false)
  })

  it('runs the narrowing once per loss of edit access', () => {
    const session = fakeSession(40)
    const onNarrow = vi.fn()
    createSheetAccess(session, { narrowed: onNarrow })

    session.access.value = { role: 20 }
    session.access.value = { role: 10 }
    expect(onNarrow).toHaveBeenCalledTimes(1)

    session.access.value = { role: 40 }
    session.state.value = 'Trashed'
    expect(onNarrow).toHaveBeenCalledTimes(2)
  })

  it('does not run the narrowing for a reader who never could edit', () => {
    const session = fakeSession(10)
    const onNarrow = vi.fn()
    createSheetAccess(session, { narrowed: onNarrow })
    session.access.value = {}
    expect(onNarrow).not.toHaveBeenCalled()
  })

  it('reports edit access coming back once, and never on first open', () => {
    const session = fakeSession(40)
    const widened = vi.fn()
    createSheetAccess(session, { widened })
    expect(widened).not.toHaveBeenCalled()

    session.state.value = 'Trashed'
    session.state.value = 'Active'
    session.access.value = { role: 50 }
    expect(widened).toHaveBeenCalledTimes(1)
  })
})
