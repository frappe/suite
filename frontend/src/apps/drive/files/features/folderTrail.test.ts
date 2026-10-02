import { describe, expect, it } from 'vitest'
import { folderTrail, type KnownTrail } from './folderTrail'

const root = { name: 'root', title: 'My files' }
const talk = { name: 'talk', title: 'Talk' }
const notes = { name: 'notes', title: 'Notes' }

const nothing: KnownTrail = { loaded: null, shown: null, opened: null, title: null }

describe('folder trail while a folder loads', () => {
  it('uses the loaded trail once it arrives', () => {
    const loaded = [root, talk, { name: 'notes', title: 'Notes (renamed)' }]
    expect(folderTrail('notes', { loaded, shown: [root, talk], opened: [root, talk, notes], title: 'Notes' })).toEqual(loaded)
  })

  it('cuts the shown trail when going up', () => {
    expect(folderTrail('talk', { ...nothing, shown: [root, talk, notes] })).toEqual([root, talk])
  })

  it('extends the trail with the opened row when going down', () => {
    expect(folderTrail('notes', { ...nothing, shown: [root, talk], opened: [root, talk, notes] })).toEqual([root, talk, notes])
  })

  it('names the folder alone when only its title is known', () => {
    expect(folderTrail('notes', { ...nothing, shown: [root], title: 'Notes' })).toEqual([notes])
  })

  it('knows nothing about a folder it did not reach from here', () => {
    expect(folderTrail('elsewhere', { ...nothing, shown: [root, talk], opened: [root, talk, notes] })).toBeNull()
  })
})
