import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { openDeviceStore, type DeviceStore } from './store'

const stores: DeviceStore[] = []
afterEach(() => stores.splice(0).forEach((store) => store.close()))

let opened = 0
async function fresh() {
  const store = (await openDeviceStore(`store-test-${opened++}`))!
  stores.push(store)
  return store
}

function typed(text: string, at = 0, base?: Y.Doc) {
  const doc = base ?? new Y.Doc()
  let update: Uint8Array = new Uint8Array()
  doc.on('update', (bytes: Uint8Array) => (update = bytes))
  doc.getText('t').insert(at, text)
  return { doc, update }
}

function read(bytes: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  return doc.getText('t').toString()
}

const session = (sid: string) => ({
  doc: 'D',
  sid,
  lineage: 'L',
  cid: 5,
  bound: true,
})
const entry = (sid: string, seq: number, bytes: Uint8Array) => ({
  doc: 'D',
  sid,
  seq,
  bytes,
  sha: String(seq),
})

describe('device store', () => {
  it('a quarantine replaces the copy, and a copy from before it is not written over the new one', async () => {
    const store = await fresh()
    const copy = (rev: number, epoch: number) => ({
      lineage: 'L',
      rev,
      canWrite: true,
      epoch,
    })
    await store.commit('D', copy(2, 0), typed('quarantined').update)
    await store.commit('D', copy(1, 1), typed('rebuilt').update)
    await store.commit('D', copy(3, 0), typed('late').update)

    const kept = (await store.copy('D'))!
    expect([read(kept.bytes), kept.rev, kept.epoch]).toEqual(['rebuilt', 1, 1])
  })

  it('a save acknowledged to a tab from before a quarantine is not added to the copy rebuilt after it', async () => {
    const store = await fresh()
    const late = typed('late')
    await store.capture(session('s'), [entry('s', 1, late.update)])
    const rebuilt = {
      lineage: 'L',
      rev: 1,
      canWrite: true,
      epoch: 1,
    }
    await store.commit('D', rebuilt, typed('rebuilt').update)

    await store.ack('D', 's', 1, late.update, 'L', 0)

    expect(read((await store.copy('D'))!.bytes)).toBe('rebuilt')
    expect(await store.entries('D', 's')).toEqual([])
  })

  it('releases a session only once it holds no entries', async () => {
    const store = await fresh()
    const one = typed('one')
    await store.capture(session('s'), [entry('s', 1, one.update)])
    expect(await store.release('D', 's')).toBe(false)
    expect(await store.sessions('D')).toHaveLength(1)

    await store.ack('D', 's', 1, one.update, 'L', 0)
    expect(await store.release('D', 's')).toBe(true)
    expect(await store.sessions('D')).toHaveLength(0)
  })

  it('keeps captured entries until acknowledged, then keeps their text in the device copy', async () => {
    const store = await fresh()
    const one = typed('one ')
    const two = typed('two', 4, one.doc)
    await store.commit('D', { lineage: 'L', rev: 0, canWrite: true }, null)
    await store.capture(session('s'), [entry('s', 1, one.update), entry('s', 2, two.update)])

    await store.ack('D', 's', 1, one.update, 'L', 0)

    expect((await store.entries('D', 's')).map((stored) => stored.seq)).toEqual([2])
    expect(read((await store.copy('D'))!.bytes)).toBe('one ')
  })

  it('replaces the device copy when the document starts a new lineage', async () => {
    const store = await fresh()
    await store.commit('D', { lineage: 'L', rev: 1, canWrite: true }, typed('old').update)

    await store.commit('D', { lineage: 'M', rev: 1, canWrite: false }, typed('new').update)

    const copy = (await store.copy('D'))!
    expect([copy.lineage, copy.canWrite, read(copy.bytes)]).toEqual(['M', false, 'new'])
  })

  it('work acknowledged under a replaced lineage stays out of the newer device copy', async () => {
    const store = await fresh()
    await store.commit('D', { lineage: 'M', rev: 1, canWrite: true }, typed('new').update)
    await store.capture(session('s'), [entry('s', 1, typed('old').update)])

    await store.ack('D', 's', 1, typed('old').update, 'L', 0)

    expect([read((await store.copy('D'))!.bytes), await store.entries('D', 's')]).toEqual([
      'new',
      [],
    ])
  })

  it('a long-lived device copy is merged into fewer pieces without losing text', async () => {
    const store = await fresh()
    const doc = new Y.Doc()
    for (let at = 0; at < 100; at++) {
      const copy = {
        lineage: 'L',
        rev: at + 1,
        canWrite: true,
      }
      await store.commit('D', copy, typed('x', at, doc).update)
    }

    expect(read((await store.copy('D'))!.bytes)).toBe('x'.repeat(100))
  })

  it('moves a session’s unsent work to a recovery record and forgets the session', async () => {
    const store = await fresh()
    await store.saveSession({ doc: 'D', sid: 's', lineage: 'L', cid: 5, bound: true })
    await store.capture(session('s'), [entry('s', 1, typed('a').update)])

    await store.recover('D', 's', 'id_clash', [entry('s', 2, typed('b').update)])

    const [record] = await store.recovery('D')
    expect([record.reason, record.entries.map((stored) => stored.seq)]).toEqual([
      'id_clash',
      [1, 2],
    ])
    expect([await store.entries('D', 's'), await store.sessions('D')]).toEqual([[], []])
  })

  it('refuses a second session of the document with the same client id', async () => {
    const store = await fresh()
    await store.saveSession({ doc: 'D', sid: 's', lineage: 'L', cid: 5, bound: true })

    await expect(
      store.saveSession({ doc: 'D', sid: 't', lineage: 'L', cid: 5, bound: false }),
    ).rejects.toBeTruthy()
    await store.saveSession({ doc: 'E', sid: 't', lineage: 'L', cid: 5, bound: false })
  })
})
