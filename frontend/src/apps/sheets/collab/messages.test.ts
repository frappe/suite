import { describe, expect, it } from 'vitest'

import type { RoomStatus } from '@/platform/collab'

import { bannerFor, editingStateOf, saveStateOf } from './messages'
import { CLEAN } from './test-room'

const status = (patch: Partial<RoomStatus> = {}): RoomStatus => ({ ...CLEAN, ...patch })

describe('save state', () => {
  it('reads saving, saved and not saved from the room', () => {
    expect(saveStateOf(status())).toBe('clean')
    expect(saveStateOf(status({ saveState: 'saving' }))).toBe('saving')
    expect(saveStateOf(status({ saveState: 'unsaved' }))).toBe('unsaved')
    expect(saveStateOf(status({ saveState: 'failed' }))).toBe('failed')
  })

  it("counts another tab's unsent edits on this device as not saved", () => {
    expect(saveStateOf(status({ othersUnsentCount: 2 }))).toBe('unsaved')
  })
})

describe('editing state', () => {
  it('keeps editing offline while the browser keeps the edits', () => {
    // The client blocks with `offline` only when it has no device store.
    const offlineKept = status({ liveState: 'polling', saveState: 'unsaved', unsentCount: 3 })
    expect(editingStateOf(offlineKept)).toBe('editing')
  })

  it("pauses offline when the browser can't keep edits", () => {
    expect(editingStateOf(status({ blockReason: 'offline', isKeptOnDevice: false }))).toBe('paused')
  })

  it('keeps a full sheet editable for writers, so deletes still save', () => {
    expect(editingStateOf(status({ isAtLimit: true }))).toBe('editing')
    expect(editingStateOf(status({ isAtLimit: true, canWrite: false }))).toBe('closed')
  })

  it('closes on lost edit or read access', () => {
    expect(editingStateOf(status({ blockReason: 'lost_edit', canWrite: false }))).toBe('closed')
    expect(editingStateOf(status({ blockReason: 'lost_read', canWrite: false }))).toBe('closed')
  })

  it('makes a viewer read-only', () => {
    expect(editingStateOf(status({ canWrite: false }))).toBe('closed')
  })

  it('pauses while a version is restored', () => {
    expect(editingStateOf(status({ canWrite: false, isRestoring: true }))).toBe('paused')
  })
})

describe('banner', () => {
  it('says nothing while saving goes on', () => {
    expect(bannerFor(status())).toBeNull()
    expect(bannerFor(status({ saveState: 'saving', unsentCount: 1 }))).toBeNull()
  })

  it('tells a full sheet to delete data', () => {
    expect(bannerFor(status({ isAtLimit: true }))?.text).toBe(
      'This sheet is full: delete some data to keep editing.',
    )
  })

  it('tells someone who lost edit access, and asks to keep the tab open for unkept edits', () => {
    expect(bannerFor(status({ blockReason: 'lost_edit' }))?.text).toBe(
      'You can no longer edit this spreadsheet.',
    )
    const unkept = status({ blockReason: 'lost_edit', unsentCount: 1, isKeptOnDevice: false })
    expect(bannerFor(unkept)?.text).toBe(
      'You can no longer edit this spreadsheet. Keep this tab open.',
    )
  })

  it('offers sign-in when signed out', () => {
    const banner = bannerFor(status({ blockReason: 'signed_out' }))
    expect(banner?.link?.label).toBe('Sign in')
    expect(banner?.after).toBe(' to keep editing.')
  })

  it('offers a reload after a stop a reload can fix', () => {
    const banner = bannerFor(status({ stopReason: 'clock_gap' }))
    expect(banner?.text).toBe(
      'This tab fell out of step with the server, so saving stopped. Reload to keep editing.',
    )
    expect(banner?.canReload).toBe(true)
  })

  it('names a refused change the sheet could not hold', () => {
    expect(bannerFor(status({ stopReason: 'poison' }))?.text).toContain(
      "can't hold a change made in this tab",
    )
  })

  it('ranks a refusal above a full sheet', () => {
    expect(bannerFor(status({ blockReason: 'locked', isAtLimit: true }))?.text).toContain('locked')
  })
})
