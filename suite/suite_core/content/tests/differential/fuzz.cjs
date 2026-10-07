// Seeded pushes for test_fuzz.py, each with what Yjs, the library the browsers run, reads from it.
// Usage: node fuzz.cjs <seed> <sessions>. Prints one JSON case per line:
// { case, cid, update (base64), yjs: { structs, deletes } | null when Yjs can't read it }.
// Each struct is [client, clock, length, content ref, origin, right origin, parent id, shared type,
// element name, format key, names], where names are the root, parent key, element name, format key
// before `--` and the format value's keys that Yjs reads.
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
// Subclasses before the classes they extend
const SHARED = [Y.XmlText, Y.XmlHook, Y.XmlElement, Y.XmlFragment, Y.Text, Y.Map, Y.Array]
const SHARED_REF = [6, 5, 3, 4, 2, 1, 0]
const sharedType = (type) => SHARED_REF[SHARED.findIndex((shared) => type instanceof shared)]
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const naming = (s) => {
  const names = []
  if (typeof s.parent === 'string') names.push(s.parent)
  if (s.parentSub !== null) names.push(s.parentSub)
  let type = null
  let node = null
  let key = null
  if (s.content instanceof Y.ContentType) {
    type = sharedType(s.content.type)
    if (type === 3) node = s.content.type.nodeName
    if (type === 5) node = s.content.type.hookName
    if (node !== null) names.push(node)
  } else if (s.content instanceof Y.ContentFormat) {
    key = s.content.key
    names.push(key.split('--')[0])
    if (isObject(s.content.value)) names.push(...Object.keys(s.content.value))
  }
  return [type, node, key, names]
}
const read = (update) => {
  let decoded
  try {
    decoded = Y.decodeUpdate(update)
  } catch {
    return null
  }
  const structs = decoded.structs.map((s) => {
    const at = [s.id.client, s.id.clock, s.length]
    if (!(s instanceof Y.Item)) return [...at, s instanceof Y.GC ? 0 : 10, null, null, null, null, null, null, []]
    const parent = s.parent instanceof Y.ID ? id(s.parent) : null
    return [...at, s.content.getRef(), id(s.origin), id(s.rightOrigin), parent, ...naming(s)]
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

const texts = (node) =>
  node.toArray().flatMap((child) => (child instanceof Y.XmlText ? [child] : child instanceof Y.XmlElement ? texts(child) : []))
const MARKS = [{ bold: true }, { link: { href: 'https://x.test', target: null } }, { 'comment--a1b2': { id: 'c1' } }]

// What an editor does to a tab's document, one transaction at a time
const edit = ({ doc, frag }) => {
  const all = texts(frag)
  const text = all.length ? pick(all) : null
  const op = below(8)
  if (!text || op === 0) {
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText(pick(TEXTS))])
    let block = paragraph
    if (random() < 0.3) {
      block = new Y.XmlElement('blockquote')
      block.insert(0, [paragraph])
    }
    frag.insert(below(frag.length + 1), [block])
  } else if (op <= 2) {
    text.insert(below(text.length + 1), pick(TEXTS), random() < 0.3 ? pick(MARKS) : undefined)
  } else if (op === 3 && text.length) {
    const at = below(text.length)
    text.delete(at, 1 + below(Math.min(4, text.length - at)))
  } else if (op === 4 && text.length) {
    text.format(below(text.length), 1 + below(3), { italic: random() < 0.5 ? true : null })
  } else if (op === 5 && frag.length > 1) {
    frag.delete(below(frag.length), 1)
  } else if (op === 6) {
    const block = frag.get(below(frag.length))
    block.setAttribute('textAlign', pick(['left', 'center', 'right']))
    if (random() < 0.5) block.setAttribute('indent', below(4))
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
