import { describe, expect, it, vi } from 'vitest'

import { resolveDocumentLeave, resolveDocumentUnload, type DocumentSaveState } from './navigation'

describe('document leave decisions', () => {
  it('leaves a clean document without prompting', async () => {
    const confirmLeave = vi.fn(() => false)
    expect(
      await resolveDocumentLeave({
        state: () => 'clean',
        flush: vi.fn(),
        retainRecovery: vi.fn(),
        confirmLeave,
      }),
    ).toBe(true)
    expect(confirmLeave).not.toHaveBeenCalled()
  })

  it('waits for an active save and leaves when the flush becomes clean', async () => {
    let state: DocumentSaveState = 'saving'
    const flush = vi.fn(async () => {
      state = 'clean'
    })
    expect(
      await resolveDocumentLeave({
        state: () => state,
        flush,
        retainRecovery: vi.fn(),
        confirmLeave: vi.fn(() => false),
      }),
    ).toBe(true)
    expect(flush).toHaveBeenCalledOnce()
  })

  it('offers Stay or Leave and retains recovery for unsaved work', async () => {
    const retainRecovery = vi.fn()
    expect(
      await resolveDocumentLeave({
        state: () => 'unsaved',
        flush: vi.fn(),
        retainRecovery,
        confirmLeave: () => false,
      }),
    ).toBe(false)
    expect(retainRecovery).toHaveBeenCalledOnce()
  })
})

describe('closing the tab', () => {
  it('asks the browser to confirm and keeps a recovery copy while work is unsaved', () => {
    for (const state of ['unsaved', 'saving', 'failed'] as const) {
      const retainRecovery = vi.fn()
      const event = new Event('beforeunload', { cancelable: true })
      resolveDocumentUnload({ state: () => state, retainRecovery }, event)
      expect([event.defaultPrevented, retainRecovery.mock.calls.length]).toEqual([true, 1])
    }
  })

  it("still asks when the recovery copy can't be written", () => {
    const event = new Event('beforeunload', { cancelable: true })
    const retainRecovery = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    expect(() => resolveDocumentUnload({ state: () => 'unsaved', retainRecovery }, event)).toThrow()
    expect(event.defaultPrevented).toBe(true)
  })

  it('closes a clean document without asking', () => {
    const retainRecovery = vi.fn()
    const event = new Event('beforeunload', { cancelable: true })
    resolveDocumentUnload({ state: () => 'clean', retainRecovery }, event)
    expect([event.defaultPrevented, retainRecovery.mock.calls.length]).toEqual([false, 0])
  })
})
