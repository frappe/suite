import { beforeEach, describe, expect, it } from 'vitest'

import { downloadRecovery, keepRecovery, readRecovery, recoveryFile } from './recovery'

beforeEach(() => localStorage.clear())

describe('Slides recovery copy', () => {
  it('keeps the latest copy per presentation and reads it back', () => {
    keepRecovery('node-1', [{ clientId: 'a' }], new Date('2026-09-30T10:00:00Z'))
    keepRecovery('node-1', [{ clientId: 'b' }], new Date('2026-09-30T10:05:00Z'))

    expect(readRecovery('node-1')).toEqual({
      savedAt: '2026-09-30T10:05:00.000Z',
      slides: [{ clientId: 'b' }],
    })
    expect(readRecovery('node-2')).toBeNull()
    localStorage.setItem('suite:slides-recovery:node-3', 'not json')
    expect(readRecovery('node-3')).toBeNull()
  })

  it('offers the copy as a JSON file named after the presentation', async () => {
    const file = recoveryFile(
      { savedAt: '2026-09-30T10:05:00.000Z', slides: [{ clientId: 'a', elements: [] }] },
      'Q3 <review>',
    )

    expect(file.name).toBe('Q3 review (recovered).json')
    expect(JSON.parse(await file.text())).toEqual({
      title: 'Q3 <review>',
      recoveredAt: '2026-09-30T10:05:00.000Z',
      slides: [{ clientId: 'a', elements: [] }],
    })
  })

  it('removes the copy once it is downloaded', () => {
    URL.createObjectURL = () => 'blob:recovery'
    URL.revokeObjectURL = () => {}
    keepRecovery('node-1', [{ clientId: 'a' }])

    expect(downloadRecovery('node-1', 'Deck')).toBe(true)
    expect(readRecovery('node-1')).toBeNull()
    expect(downloadRecovery('node-1', 'Deck')).toBe(false)
  })
})
