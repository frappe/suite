import { describe, expect, it } from 'vitest'
import * as yjs from 'yjs'

import { encodePush } from './frames'
import { fakeServer } from './test-support'

// A writer the fake server has claimed. Each push is one seq, and a refused one keeps it for the next try
async function writer(server: ReturnType<typeof fakeServer>, cid: number) {
  const doc = new yjs.Doc()
  doc.clientID = cid
  const sid = `s${cid}`
  await server.endpoints().session(sid, { cid, lineage: 'L' })
  let seq = 0
  return {
    doc,
    text: doc.getText('t'),
    async push(update: Uint8Array) {
      const next = seq + 1
      const header = {
        proto: 1,
        lineage: 'L',
        expected_user: '',
        schema: 1,
        sid,
        from: next,
        to: next,
        cid,
        seen_rev: server.rows.length,
        shas: [`${sid}:${next}`],
        final: false,
      }
      const answer = await server.endpoints().push(encodePush(header, update))
      seq += answer.status === 200 ? 1 : 0
      return { status: answer.status, ...JSON.parse(new TextDecoder().decode(answer.bytes)) }
    },
  }
}

// What `act` adds to the doc, as one update
function change(doc: yjs.Doc, act: () => void) {
  const before = yjs.encodeStateVector(doc)
  act()
  return yjs.encodeStateAsUpdate(doc, before)
}

function hear(to: yjs.Doc, from: yjs.Doc) {
  yjs.applyUpdate(to, yjs.encodeStateAsUpdate(from))
}

function serverText(server: ReturnType<typeof fakeServer>) {
  const doc = new yjs.Doc()
  for (const row of server.rows) {
    yjs.applyUpdate(doc, row.bytes)
  }

  return doc.getText('t').toString()
}

describe('the fake server, as the real one checks each row', () => {
  it("refuses a writer's row that skips its unsent clocks, and stores nothing", async () => {
    const server = fakeServer()
    const alice = await writer(server, 1)
    change(alice.doc, () => alice.text.insert(0, 'ab'))
    const skipping = change(alice.doc, () => alice.text.insert(2, 'c'))

    expect(await alice.push(skipping)).toMatchObject({ status: 409, collab: 'clock_gap', clock: 0 })
    expect(server.rows).toHaveLength(0)
  })

  it("refuses a row that follows another writer's unsent text, and takes it once that is sent", async () => {
    const server = fakeServer()
    const [alice, bob] = [await writer(server, 1), await writer(server, 2)]
    const first = change(alice.doc, () => alice.text.insert(0, 'one'))
    hear(bob.doc, alice.doc)
    const after = change(bob.doc, () => bob.text.insert(3, ' two'))

    expect(await bob.push(after)).toMatchObject({ status: 409, collab: 'missing_dep', client: 1 })
    expect((await alice.push(first)).status).toBe(200)
    expect((await bob.push(after)).status).toBe(200)
    expect(serverText(server)).toBe('one two')
  })

  it("refuses a delete of another writer's unsent text, and takes one of sent text", async () => {
    const server = fakeServer()
    const [alice, bob] = [await writer(server, 1), await writer(server, 2)]
    const sent = change(alice.doc, () => alice.text.insert(0, 'kept'))
    expect((await alice.push(sent)).status).toBe(200)
    change(alice.doc, () => alice.text.insert(4, ' unsent'))
    hear(bob.doc, alice.doc)

    const deleteUnsent = change(bob.doc, () => bob.text.delete(4, 7))
    expect(await bob.push(deleteUnsent)).toMatchObject({
      status: 409,
      collab: 'missing_dep',
      client: 1,
      clock: 4,
    })

    const carol = await writer(server, 3)
    hear(carol.doc, alice.doc)
    const deleteSent = change(carol.doc, () => carol.text.delete(0, 4))
    expect((await carol.push(deleteSent)).status).toBe(200)
  })

  it('refuses a delete that reaches one clock past what is sent', async () => {
    const server = fakeServer()
    const [alice, bob] = [await writer(server, 1), await writer(server, 2)]
    expect((await alice.push(change(alice.doc, () => alice.text.insert(0, 'ab')))).status).toBe(200)
    change(alice.doc, () => alice.text.insert(2, 'c'))
    hear(bob.doc, alice.doc)

    const reaching = change(bob.doc, () => bob.text.delete(0, 3))
    expect(await bob.push(reaching)).toMatchObject({ status: 409, collab: 'missing_dep', clock: 2 })
  })

  it('takes a row whose text follows its own earlier text in the same row', async () => {
    const server = fakeServer()
    const alice = await writer(server, 1)
    const row = change(alice.doc, () => {
      alice.text.insert(0, 'one')
      alice.text.insert(3, ' two')
      alice.text.insert(0, '> ')
    })

    expect((await alice.push(row)).status).toBe(200)
    expect(serverText(server)).toBe('> one two')
  })
})
