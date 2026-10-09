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
const below = (count) => Math.floor(random() * count)
const pick = (list) => list[below(list.length)]
const TEXTS = ['a', 'hello ', 'é', '😀', 'x😀y', '中文', ' ', 'line\n', 'ab😀😀']

const id = (ref) => (ref ? [ref.client, ref.clock] : null)
// Subclasses before the classes they extend
const SHARED = [Y.XmlText, Y.XmlHook, Y.XmlElement, Y.XmlFragment, Y.Text, Y.Map, Y.Array]
const SHARED_REF = [6, 5, 3, 4, 2, 1, 0]
const sharedType = (type) => SHARED_REF[SHARED.findIndex((shared) => type instanceof shared)]
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const structNames = (struct) => {
  const names = []
  if (typeof struct.parent === 'string') names.push(struct.parent)
  if (struct.parentSub !== null) names.push(struct.parentSub)
  let type = null
  let node = null
  let key = null
  if (struct.content instanceof Y.ContentType) {
    type = sharedType(struct.content.type)
    if (type === 3) node = struct.content.type.nodeName
    if (type === 5) node = struct.content.type.hookName
    if (node !== null) names.push(node)
  } else if (struct.content instanceof Y.ContentFormat) {
    key = struct.content.key
    names.push(key.split('--')[0])
    if (isObject(struct.content.value)) names.push(...Object.keys(struct.content.value))
  }
  return [type, node, key, names]
}
const readWithYjs = (update) => {
  let decoded
  try {
    decoded = Y.decodeUpdate(update)
  } catch {
    return null
  }
  const structs = decoded.structs.map((struct) => {
    const idAndLength = [struct.id.client, struct.id.clock, struct.length]
    if (!(struct instanceof Y.Item)) return [...idAndLength, struct instanceof Y.GC ? 0 : 10, null, null, null, null, null, null, []]
    const parent = struct.parent instanceof Y.ID ? id(struct.parent) : null
    return [...idAndLength, struct.content.getRef(), id(struct.origin), id(struct.rightOrigin), parent, ...structNames(struct)]
  })
  const deletes = [...decoded.ds.clients].map(([client, ranges]) => [client, ranges.map((range) => [range.clock, range.len])])
  return { structs, deletes }
}

const lines = []
const emit = (kind, cid, update) =>
  lines.push(JSON.stringify({ case: kind, cid, update: Buffer.from(update).toString('base64'), yjs: readWithYjs(update) }))

const tab = (cid) => {
  const doc = new Y.Doc({ gc: false })
  doc.clientID = cid
  const ownUpdates = []
  doc.on('update', (update, origin) => origin !== 'sync' && ownUpdates.push(update))
  return { doc, ownUpdates, fragment: doc.getXmlFragment('default') }
}

const texts = (node) =>
  node.toArray().flatMap((child) => (child instanceof Y.XmlText ? [child] : child instanceof Y.XmlElement ? texts(child) : []))
const MARKS = [{ bold: true }, { link: { href: 'https://x.test', target: null } }, { 'comment--a1b2': { id: 'c1' } }]

// What an editor does to a tab's document, one transaction at a time
const edit = ({ doc, fragment }) => {
  const all = texts(fragment)
  const text = all.length ? pick(all) : null
  const operation = below(8)
  if (!text || operation === 0) {
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText(pick(TEXTS))])
    let block = paragraph
    if (random() < 0.3) {
      block = new Y.XmlElement('blockquote')
      block.insert(0, [paragraph])
    }
    fragment.insert(below(fragment.length + 1), [block])
  } else if (operation <= 2) {
    text.insert(below(text.length + 1), pick(TEXTS), random() < 0.3 ? pick(MARKS) : undefined)
  } else if (operation === 3 && text.length) {
    const position = below(text.length)
    text.delete(position, 1 + below(Math.min(4, text.length - position)))
  } else if (operation === 4 && text.length) {
    text.format(below(text.length), 1 + below(3), { italic: random() < 0.5 ? true : null })
  } else if (operation === 5 && fragment.length > 1) {
    fragment.delete(below(fragment.length), 1)
  } else if (operation === 6) {
    const block = fragment.get(below(fragment.length))
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
  const position = below(bytes.length)
  const operation = below(6)
  if (operation === 0) bytes[position] ^= 1 << below(8)
  else if (operation === 1) bytes.length = position
  else if (operation === 2) bytes.splice(position, 0, below(256))
  else if (operation === 3) bytes.splice(position, 1)
  else if (operation === 4) bytes.splice(position, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f)
  else bytes[position] = below(256)
  return new Uint8Array(bytes)
}

for (let session = 0; session < sessions; session++) {
  const firstTab = tab(1 + below(2 ** 30))
  const secondTab = tab(1 + below(2 ** 30))
  for (let step = 0; step < 12; step++) {
    edit(random() < 0.6 ? firstTab : secondTab)
    if (random() < 0.5) {
      Y.applyUpdate(secondTab.doc, Y.encodeStateAsUpdate(firstTab.doc, Y.encodeStateVector(secondTab.doc)), 'sync')
      Y.applyUpdate(firstTab.doc, Y.encodeStateAsUpdate(secondTab.doc, Y.encodeStateVector(firstTab.doc)), 'sync')
    }
  }
  for (const { doc, ownUpdates } of [firstTab, secondTab]) {
    const cid = doc.clientID
    ownUpdates.forEach((update) => emit('own', cid, update))
    if (ownUpdates.length > 1) {
      const from = below(ownUpdates.length - 1)
      emit('merged', cid, Y.mergeUpdates(ownUpdates.slice(from, from + 2 + below(ownUpdates.length - from - 1))))
    }
    if (ownUpdates.length > 2) {
      // Without structs between the two ends the merge is contiguous, so a tab could send it
      const ends = Y.mergeUpdates([ownUpdates[0], ownUpdates[ownUpdates.length - 1]])
      emit(Y.decodeUpdate(ends).structs.some((struct) => struct instanceof Y.Skip) ? 'gap' : 'merged', cid, ends)
    }
    ownUpdates.forEach((update) => random() < 0.5 && emit('mutated', cid, mutate(update)))
  }
  const bothMerged = Y.mergeUpdates([...firstTab.ownUpdates, ...secondTab.ownUpdates])
  if (new Set(Y.decodeUpdate(bothMerged).structs.map((struct) => struct.id.client)).size > 1) emit('two writers', firstTab.doc.clientID, bothMerged)

  const refusedTab = tab(firstTab.doc.clientID)
  refusedTab.doc.getArray('t').push([new Uint8Array([below(256)])])
  refusedTab.doc.getArray('t').push([new Y.Doc({ guid: `sub-${session}` })])
  emit('binary', refusedTab.doc.clientID, refusedTab.ownUpdates[0])
  emit('subdocument', refusedTab.doc.clientID, refusedTab.ownUpdates[1])
}
process.stdout.write(lines.join('\n') + '\n')
