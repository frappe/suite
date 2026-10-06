// Media remap differential: Yjs must read a remapped compaction exactly as the source with the map applied.
// Usage: node remap.cjs generate <seed> <trials> <out.json>, then python remap.py <in.json> <out.json>,
// then node remap.cjs judge <remapped.json>. Exits 1 on any disagreement.
const path = require('path')
const fs = require('fs')
const Y = require(path.resolve(__dirname, '../../../../../node_modules/yjs'))

const OLD = ['pic0', 'pic1', 'pic2', 'pic3']
const MAP = Object.fromEntries(OLD.map((id, i) => [id, `new${i}x`]))
const URL = /writer\.api\.embed\.get\?id=([A-Za-z0-9_-]{1,140})/g
const embed = (id) => `/api/method/suite.writer.api.embed.get?id=${id}`
// The rule Writer applies, written again here so the judge does not share code with the server
const rule = (value) => (value in MAP ? MAP[value] : value.replace(URL, (all, id) => (id in MAP ? all.replace(id, MAP[id]) : all)))

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generate(seed, trials) {
  const random = rng(seed)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const out = []
  for (let trial = 0; trial < trials; trial++) {
    const rows = []
    const docs = [1, 2, 3].map((n) => {
      const doc = new Y.Doc()
      doc.clientID = trial * 10 + n
      doc.on('update', (update) => rows.push(Buffer.from(update).toString('base64')))
      return doc
    })
    const sync = () => {
      for (const a of docs) for (const b of docs) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
    }
    const images = (doc) => {
      const found = []
      const walk = (node) => node.toArray().forEach((child) => {
        if (child instanceof Y.XmlElement) {
          if (child.nodeName === 'image') found.push(child)
          walk(child)
        }
      })
      walk(doc.getXmlFragment('default'))
      return found
    }
    const texts = (doc) => {
      const found = []
      const walk = (node) => node.toArray().forEach((child) => {
        if (child instanceof Y.XmlText) found.push(child)
        else if (child instanceof Y.XmlElement) walk(child)
      })
      walk(doc.getXmlFragment('default'))
      return found
    }
    for (let step = 0; step < 12; step++) {
      const doc = pick(docs)
      const body = doc.getXmlFragment('default')
      const op = random()
      if (op < 0.2) {
        const image = new Y.XmlElement('image')
        image.setAttribute('src', embed(pick(OLD)))
        if (random() < 0.3) image.setAttribute('data-node', pick(OLD))
        if (random() < 0.5) {
          const figure = new Y.XmlElement('figure')
          figure.insert(0, [image])
          body.insert(Math.floor(random() * (body.length + 1)), [figure])
        } else body.insert(Math.floor(random() * (body.length + 1)), [image])
      } else if (op < 0.4) {
        const paragraph = new Y.XmlElement('paragraph')
        const text = new Y.XmlText()
        paragraph.insert(0, [text])
        body.insert(Math.floor(random() * (body.length + 1)), [paragraph])
        text.insert(0, `about ${pick(OLD)} and ${embed(pick(OLD))} `)
      } else if (op < 0.6) {
        const image = images(doc).length ? pick(images(doc)) : null
        if (image) image.setAttribute('src', random() < 0.7 ? embed(pick(OLD)) : 'https://elsewhere.test/a.png')
      } else if (op < 0.7) {
        const text = texts(doc).length ? pick(texts(doc)) : null
        if (text && text.length > 2) text.format(0, 2, { link: { href: embed(pick(OLD)), target: null } })
      } else if (op < 0.75) {
        const text = texts(doc).length ? pick(texts(doc)) : null
        if (text) text.insertEmbed(text.length, { src: embed(pick(OLD)), node: pick(OLD) })
      } else if (op < 0.85) {
        doc.getMap('meta').set('poster', { src: pick(OLD), nested: { list: [embed(pick(OLD)), 3] } })
        doc.getMap('meta').set('title', `notes on ${pick(OLD)}`)
      } else if (body.length) {
        body.delete(Math.floor(random() * body.length), 1)
      }
      if (random() < 0.3) sync()
    }
    sync()
    out.push({ trial, rows })
  }
  return out
}

const bytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
const load = (parts) => {
  const doc = new Y.Doc()
  Y.transact(doc, () => parts.forEach((part) => Y.applyUpdate(doc, part)))
  return doc
}
const deep = (value, change) => {
  if (typeof value === 'string') return change(value)
  if (Array.isArray(value)) return value.map((item) => deep(item, change))
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deep(value[key], change)]))
  return value === undefined ? null : value
}
// Values go through `change`; text, element names and keys never do
function ser(node, change) {
  if (node instanceof Y.XmlText)
    return node.toDelta().map((op) => ({
      insert: typeof op.insert === 'string' ? op.insert : deep(op.insert, change),
      attributes: deep(op.attributes ?? {}, change),
    }))
  if (node instanceof Y.XmlElement) return { el: node.nodeName, attrs: deep(node.getAttributes(), change), kids: node.toArray().map((kid) => ser(kid, change)) }
  return node.toArray().map((kid) => ser(kid, change))
}
const view = (doc, change) => JSON.stringify({ body: ser(doc.getXmlFragment('default'), change), meta: deep(doc.getMap('meta').toJSON(), change) })
const vector = (doc) => JSON.stringify([...Y.decodeStateVector(Y.encodeStateVector(doc)).entries()].sort())
const deletes = (doc) => {
  const set = Y.createDeleteSetFromStructStore(doc.store)
  return JSON.stringify([...set.clients.entries()].sort().map(([client, ranges]) => [client, ranges.map((r) => [r.clock, r.len])]))
}

function judge(results) {
  let bad = 0
  for (const result of results) {
    let failed = false
    const fail = (why) => {
      if (!failed) bad++
      failed = true
      console.log(`trial ${result.trial}: ${why}`)
    }
    if (result.error) {
      fail(`server refused: ${result.error}`)
      continue
    }
    const source = load(result.rows.map(bytes))
    const remapped = load([bytes(result.remapped)])
    if (view(remapped, (value) => value) !== view(source, rule)) fail('Yjs reads something other than the source with the map applied')
    if (vector(remapped) !== vector(source)) fail('state vector differs')
    if (deletes(remapped) !== deletes(source)) fail('delete set differs')
    if (!result.rerun_unchanged) fail('a second remap changed the bytes')
    const stillOld = view(remapped, (value) => (rule(value) !== value ? '<<OLD>>' : value)).includes('<<OLD>>')
    if (stillOld) fail('a value still names an old id')
  }
  console.log(`${results.length - bad}/${results.length} remapped compactions read as the source with the map applied`)
  return bad
}

const [mode, ...args] = process.argv.slice(2)
if (mode === 'generate') {
  const [seed, trials, out] = args
  fs.writeFileSync(out, JSON.stringify({ map: MAP, trials: generate(Number(seed), Number(trials)) }))
} else if (mode === 'judge') {
  process.exit(judge(JSON.parse(fs.readFileSync(args[0], 'utf8'))) ? 1 : 0)
} else {
  console.error('usage: node remap.cjs generate <seed> <trials> <out.json> | judge <remapped.json>')
  process.exit(2)
}
