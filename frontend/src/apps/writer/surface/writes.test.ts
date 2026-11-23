import { describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

import type { SessionState } from '@/apps/drive'

import { createWriteGate, type DocumentWrite } from './writes'

function fakeSession(role: number, state: SessionState = 'Active') {
  const session = {
    state: ref<SessionState>(state),
    access: ref<{ role?: number }>({ role }),
    refreshAccess: vi.fn(async () => {}),
  }
  return session
}

function fakeDocument(answer: () => Promise<unknown> = async () => ({ ok: true })) {
  const sent: object[] = []
  const write = (): DocumentWrite => ({
    isPending: false,
    error: null,
    run: async (params) => {
      sent.push(params ?? {})
      return answer()
    },
  })
  const document = reactive({
    doc: { name: 'writer-doc' },
    saveDoc: write(),
    newVersion: write(),
  })
  return { document, sent }
}

describe('Writer write gate', () => {
  it('sends writes while the editor holds EDIT on an active document', async () => {
    const gate = createWriteGate(
      fakeSession(40),
      () => {},
      () => {},
    )
    const { document, sent } = fakeDocument()
    const guarded = gate.guard(document, ['saveDoc', 'newVersion'])

    await expect(guarded.saveDoc.run({ data: 'body' })).resolves.toEqual({ ok: true })
    expect(sent).toEqual([{ data: 'body' }])
    expect(guarded.doc.name).toBe('writer-doc')
  })

  it('cancels pending writes and runs the freeze once when access narrows', async () => {
    const session = fakeSession(50)
    const onClose = vi.fn()
    const gate = createWriteGate(session, onClose, () => {})
    const { document, sent } = fakeDocument()
    const guarded = gate.guard(document, ['saveDoc', 'newVersion'])

    session.access.value = { role: 20 }

    expect(onClose).toHaveBeenCalledTimes(1)
    await expect(guarded.saveDoc.run({ data: 'late autosave' })).rejects.toMatchObject({
      name: 'AbortError',
    })
    await expect(guarded.newVersion.run({ data: 'late version' })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(sent).toEqual([])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('logs a failing close rather than leaving its rejection unhandled', async () => {
    const session = fakeSession(40)
    const failure = new Error('Copy not kept')
    const onClose = vi.fn(async () => Promise.reject(failure))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    createWriteGate(session, onClose, () => {})

    session.access.value = { role: 30 }

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(failure))
    vi.restoreAllMocks()
  })

  it('runs the reopen once each time the gate opens again, not while it stays open', () => {
    const session = fakeSession(40)
    const onOpen = vi.fn()
    createWriteGate(session, () => {}, onOpen)

    session.access.value = { role: 50 }
    expect(onOpen).not.toHaveBeenCalled()

    session.access.value = { role: 20 }
    session.access.value = { role: 40 }
    session.access.value = { role: 50 }

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('stops writes to a trashed document even when the role still allows EDIT', async () => {
    const session = fakeSession(50)
    const onClose = vi.fn()
    const gate = createWriteGate(session, onClose, () => {})
    const { document, sent } = fakeDocument()

    session.state.value = 'Trashed'

    expect(onClose).toHaveBeenCalledTimes(1)
    await expect(
      gate.guard(document, ['saveDoc']).saveDoc.run({ data: 'x' }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(sent).toEqual([])
  })

  it('takes a refused write as the verdict, even before the session refresh agrees', async () => {
    const session = fakeSession(40)
    const onClose = vi.fn()
    const gate = createWriteGate(session, onClose, () => {})
    const refusal = Object.assign(new Error('No access'), { type: 'DriveForbidden' })
    let answer: () => Promise<unknown> = async () => {
      throw refusal
    }
    const { document, sent } = fakeDocument(() => answer())
    const guarded = gate.guard(document, ['saveDoc'])

    await expect(guarded.saveDoc.run({ data: 'one' })).rejects.toBe(refusal)

    expect(session.refreshAccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(gate.role.value).toBeLessThan(40)
    expect(gate.writable.value).toBe(false)

    // The refresh still reports EDIT. The refusal holds anyway.
    answer = async () => ({ ok: true })
    session.access.value = { role: 40 }
    await expect(guarded.saveDoc.run({ data: 'two' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(sent).toEqual([{ data: 'one' }])
  })

  it('keeps the gate open after a failure that is not about access', async () => {
    const session = fakeSession(40)
    const gate = createWriteGate(
      session,
      () => {},
      () => {},
    )
    const failure = Object.assign(new Error('Deadlock'), { type: 'QueryDeadlockError' })
    const { document } = fakeDocument(async () => {
      throw failure
    })

    await expect(gate.guard(document, ['saveDoc']).saveDoc.run({})).rejects.toBe(failure)

    expect(gate.writable.value).toBe(true)
    expect(session.refreshAccess).not.toHaveBeenCalled()
  })

  it('keeps writing after any other conflict', async () => {
    const gate = createWriteGate(fakeSession(40), vi.fn(), () => {})
    const conflict = Object.assign(new Error('No bytes to version'), { type: 'DriveConflict' })
    const { document, sent } = fakeDocument(async () => Promise.reject(conflict))
    const guarded = gate.guard(document, ['saveDoc', 'newVersion'])

    await expect(guarded.newVersion.run({})).rejects.toBe(conflict)
    await expect(guarded.saveDoc.run({ data: 'body' })).rejects.toBe(conflict)

    expect([gate.writable.value, sent.length]).toEqual([true, 2])
  })
})
