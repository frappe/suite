import { describe, expect, it, vi } from 'vitest'

import type { DocumentSession } from '@/apps/drive'

import { useWriterCollab } from './useWriterCollab'

const fake = vi.hoisted(() => ({
  room: {
    canWrite: true,
    blocked: null as string | null,
    paused: null,
    saveState: 'clean',
    unsent: 0,
    onDevice: true,
    listeners: [] as (() => void)[],
    onChange(listener: () => void) {
      this.listeners.push(listener)
      return () => {}
    },
    close: async () => {},
  },
}))

vi.mock('@/apps/writer/collab', () => ({
  openWriterRoom: async () => ({ state: 'live', room: fake.room }),
}))

async function opened() {
  const collab = useWriterCollab({ nodeId: 'node-1' } as DocumentSession, () => false)
  await collab.open()
  return collab
}

function becomes(change: Partial<typeof fake.room>) {
  Object.assign(fake.room, change)
  for (const listener of fake.room.listeners) listener()
}

describe('writer collab editing state', () => {
  it('pauses editing, not access, while the room is stopped for a reason that clears', async () => {
    const collab = await opened()
    expect(collab.editingPaused.value).toBe(false)

    for (const blocked of ['signed_out', 'locked', 'offline', 'stale_session', 'other_user']) {
      becomes({
        blocked,
        saveState: 'failed',
        unsent: 9,
        canWrite: blocked === 'signed_out' || blocked === 'locked' || blocked === 'offline',
      })
      expect(collab.allowsEditing.value).toBe(false)
      expect(collab.editingPaused.value).toBe(true)
    }

    becomes({ blocked: null, saveState: 'failed', canWrite: true })
    expect(collab.editingPaused.value).toBe(true)
  })

  it('leaves a lost right or a read-only room as view only', async () => {
    const collab = await opened()
    for (const blocked of ['lost_edit', 'lost_read']) {
      becomes({ blocked, saveState: 'failed', canWrite: false })
      expect(collab.editingPaused.value).toBe(false)
    }
    becomes({ blocked: null, saveState: 'clean', canWrite: false })
    expect(collab.allowsEditing.value).toBe(false)
    expect(collab.editingPaused.value).toBe(false)
  })
})
