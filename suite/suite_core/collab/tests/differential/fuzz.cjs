// Seeded pushes for test_fuzz.py, each with what Yjs, the library the browsers run, reads from it.
// Usage: node fuzz.cjs <seed> <sessions>. Prints one JSON case per line:
// { case, cid, update (base64), yjs: { structs, deletes } | null when Yjs can't read it }.
const path = require('path')
const Y = require(path.resolve(__dirname, '../../../../../node_modules/yjs'))

const seed = Number(process.argv[2])
const sessions = Number(process.argv[3])

const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const random = mulberry32(seed)
const below = (n) => Math.floor(random() * n)
const pick = (list) => list[below(list.length)]
const TEXTS = ['a', 'hello ', 'é', '😀', 'x😀y', '中文', ' ', 'line\n', 'ab😀😀']

const id = (ref) => (ref ? [ref.client, ref.clock] : null)
const read = (update) => {
  let decoded
  try {
    decoded = Y.decodeUpdate(update)
  } catch {
    return null
  }
  const structs = decoded.structs.map((s) => {
    const kind = s instanceof Y.GC ? 0 : s instanceof Y.Skip ? 10 : s.content.getRef()
    const parent = s instanceof Y.Item && s.parent instanceof Y.ID ? id(s.parent) : null
    return [s.id.client, s.id.clock, s.length, kind, id(s.origin), id(s.rightOrigin), parent]
  })
  const deletes = [...decoded.ds.clients].map(([client, ranges]) => [client, ranges.map((r) => [r.clock, r.len])])
  return { structs, deletes }
}

const out = []
const emit = (kind, cid, update) =>
  out.push(JSON.stringify({ case: kind, cid, update: Buffer.from(update).toString('base64'), yjs: read(update) }))

const tab = (cid) => {
  const doc = new Y.Doc({ gc: false })
  doc.clientID = cid
  const own = []
  doc.on('update', (update, origin) => origin !== 'sync' && own.push(update))
  return { doc, own, frag: doc.getXmlFragment('default') }
}

const texts = (frag) => frag.toArray().flatMap((el) => el.toArray().filter((t) => t instanceof Y.XmlText))

// What an editor does to a tab's document, one transaction at a time
const edit = ({ doc, frag }) => {
  const all = texts(frag)
  const text = all.length ? pick(all) : null
  const op = below(8)
  if (!text || op === 0) {
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText(pick(TEXTS))])
    frag.insert(below(frag.length + 1), [paragraph])
  } else if (op <= 2) {
    text.insert(below(text.length + 1), pick(TEXTS), random() < 0.3 ? { bold: true } : undefined)
  } else if (op === 3 && text.length) {
    const at = below(text.length)
    text.delete(at, 1 + below(Math.min(4, text.length - at)))
  } else if (op === 4 && text.length) {
    text.format(below(text.length), 1 + below(3), { italic: random() < 0.5 ? true : null })
  } else if (op === 5 && frag.length > 1) {
    frag.delete(below(frag.length), 1)
  } else if (op === 6) {
    frag.get(below(frag.length)).setAttribute('textAlign', pick(['left', 'center', 'right']))
  } else {
    doc.transact(() => {
      text.insert(0, pick(TEXTS))
      if (random() < 0.5) text.delete(0, 1)
    })
  }
  if (random() < 0.1) doc.getMap('meta').set('firstTabLabel', pick(TEXTS))
}

const mutate = (update) => {
  const bytes = Array.from(update)
  const at = below(bytes.length)
  const op = below(6)
  if (op === 0) bytes[at] ^= 1 << below(8)
  else if (op === 1) bytes.length = at
  else if (op === 2) bytes.splice(at, 0, below(256))
  else if (op === 3) bytes.splice(at, 1)
  else if (op === 4) bytes.splice(at, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f)
  else bytes[at] = below(256)
  return new Uint8Array(bytes)
}

for (let session = 0; session < sessions; session++) {
  const a = tab(1 + below(2 ** 30))
  const b = tab(1 + below(2 ** 30))
  for (let step = 0; step < 12; step++) {
    edit(random() < 0.6 ? a : b)
    if (random() < 0.5) {
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)), 'sync')
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)), 'sync')
    }
  }
  for (const { doc, own } of [a, b]) {
    const cid = doc.clientID
    own.forEach((update) => emit('own', cid, update))
    if (own.length > 1) {
      const from = below(own.length - 1)
      emit('merged', cid, Y.mergeUpdates(own.slice(from, from + 2 + below(own.length - from - 1))))
    }
    if (own.length > 2) {
      // Without structs between the two ends the merge is contiguous, so a tab could send it
      const ends = Y.mergeUpdates([own[0], own[own.length - 1]])
      emit(Y.decodeUpdate(ends).structs.some((s) => s instanceof Y.Skip) ? 'gap' : 'merged', cid, ends)
    }
    own.forEach((update) => random() < 0.5 && emit('mutated', cid, mutate(update)))
  }
  const both = Y.mergeUpdates([...a.own, ...b.own])
  if (new Set(Y.decodeUpdate(both).structs.map((s) => s.id.client)).size > 1) emit('two writers', a.doc.clientID, both)

  const other = tab(a.doc.clientID)
  other.doc.getArray('t').push([new Uint8Array([below(256)])])
  other.doc.getArray('t').push([new Y.Doc({ guid: `sub-${session}` })])
  emit('binary', other.doc.clientID, other.own[0])
  emit('subdocument', other.doc.clientID, other.own[1])
}
process.stdout.write(out.join('\n') + '\n')
