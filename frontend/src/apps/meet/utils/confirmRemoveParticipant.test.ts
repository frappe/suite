import { dialog } from 'frappe-ui'
import { describe, expect, it, vi } from 'vitest'

import { confirmRemoveParticipant } from './confirmRemoveParticipant'

vi.mock('frappe-ui', () => ({ dialog: { confirm: vi.fn(), prompt: vi.fn() } }))
vi.mock('@/platform/translation', () => ({
  translate: (text: string, args: unknown[] = []) =>
    text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)])),
}))

describe('confirmRemoveParticipant', () => {
  it('asks to remove a member by name and removes without a ban', () => {
    const remove = vi.fn()
    confirmRemoveParticipant({ name: 'Leo Park', canBan: false, remove })
    const args = vi.mocked(dialog.confirm).mock.lastCall![0]
    expect(args).toMatchObject({ title: 'Remove Leo Park?', theme: 'red', confirmLabel: 'Remove' })
    void args.onConfirm?.({ close: vi.fn(), setError: vi.fn() })
    expect(remove).toHaveBeenCalledWith(false)
    expect(dialog.prompt).not.toHaveBeenCalled()
  })

  it('offers a guest the Ban checkbox and passes on what was ticked', () => {
    const remove = vi.fn()
    confirmRemoveParticipant({ name: 'Sam', canBan: true, remove })
    const args = vi.mocked(dialog.prompt).mock.lastCall![0]
    expect(args.fields.map((field) => field.label)).toEqual(['Ban from this meeting'])
    void args.onConfirm({ close: vi.fn(), setError: vi.fn(), values: { ban: true } })
    expect(remove).toHaveBeenCalledWith(true)
  })
})
