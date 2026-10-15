// Media remap differential: Yjs must read a remapped compaction exactly as the source with the map applied.
// Usage: node remap.cjs generate <seed> <trials> <out.json>, then python remap.py <in.json> <out.json>,
// then node remap.cjs judge <remapped.json>. Exits 1 on any disagreement.
const path = require('path')
const fs = require('fs')
const Y = require(path.resolve(__dirname, '../../../../../node_modules/yjs'))

const OLD = ['pic0', 'pic1', 'pic2', 'pic3']
const MAP = Object.fromEntries(OLD.map((id, i) => [id, `new${i}x`]))
const EMBED_URL = /writer\.api\.embed\.get\?id=([A-Za-z0-9_-]{1,140})/g
const embed = (id) => `/api/method/suite.writer.api.embed.get?id=${id}`
// The rule Writer applies, written again here so the judge does not share code with the server
const remapValue = (value) => (value in MAP ? MAP[value] : value.replace(EMBED_URL, (match, id) => (id in MAP ? match.replace(id, MAP[id]) : match)))

function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generate(seed, trials) {
  const random = seededRandom(seed)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const histories = []
  for (let trial = 0; trial < trials; trial++) {
    const rows = []
    const docs = [1, 2, 3].map((writer) => {
      const doc = new Y.Doc()
      doc.clientID = trial * 10 + writer
      doc.on('update', (update) => rows.push(Buffer.from(update).toString('base64')))
      return doc
    })
    const sync = () => {
      for (const from of docs) for (const to of docs) if (from !== to) Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
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
      const roll = random()
      if (roll < 0.2) {
        const image = new Y.XmlElement('image')
        image.setAttribute('src', embed(pick(OLD)))
        if (random() < 0.3) image.setAttribute('data-node', pick(OLD))
        if (random() < 0.5) {
          const figure = new Y.XmlElement('figure')
          figure.insert(0, [image])
          body.insert(Math.floor(random() * (body.length + 1)), [figure])
        } else body.insert(Math.floor(random() * (body.length + 1)), [image])
      } else if (roll < 0.4) {
        const paragraph = new Y.XmlElement('paragraph')
        const text = new Y.XmlText()
        paragraph.insert(0, [text])
        body.insert(Math.floor(random() * (body.length + 1)), [paragraph])
        text.insert(0, `about ${pick(OLD)} and ${embed(pick(OLD))} `)
      } else if (roll < 0.6) {
        const image = images(doc).length ? pick(images(doc)) : null
        if (image) image.setAttribute('src', random() < 0.7 ? embed(pick(OLD)) : 'https://elsewhere.test/a.png')
      } else if (roll < 0.7) {
        const text = texts(doc).length ? pick(texts(doc)) : null
        if (text && text.length > 2) text.format(0, 2, { link: { href: embed(pick(OLD)), target: null } })
      } else if (roll < 0.75) {
        const text = texts(doc).length ? pick(texts(doc)) : null
        if (text) text.insertEmbed(text.length, { src: embed(pick(OLD)), node: pick(OLD) })
      } else if (roll < 0.85) {
        doc.getMap('meta').set('poster', { src: pick(OLD), nested: { list: [embed(pick(OLD)), 3] } })
        doc.getMap('meta').set('title', `notes on ${pick(OLD)}`)
      } else if (body.length) {
        body.delete(Math.floor(random() * body.length), 1)
      }
      if (random() < 0.3) sync()
    }
    sync()
    histories.push({ trial, rows })
  }
  return histories
}

const fromBase64 = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
const loadDoc = (parts) => {
  const doc = new Y.Doc()
  Y.transact(doc, () => parts.forEach((part) => Y.applyUpdate(doc, part)))
  return doc
}
const mapValues = (value, change) => {
  if (typeof value === 'string') return change(value)
  if (Array.isArray(value)) return value.map((item) => mapValues(item, change))
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, mapValues(value[key], change)]))
  return value === undefined ? null : value
}
// Values go through `change`; text, element names and keys never do
function serialize(node, change) {
  if (node instanceof Y.XmlText)
    return node.toDelta().map((delta) => ({
      insert: typeof delta.insert === 'string' ? delta.insert : mapValues(delta.insert, change),
      attributes: mapValues(delta.attributes ?? {}, change),
    }))
  if (node instanceof Y.XmlElement) return { el: node.nodeName, attrs: mapValues(node.getAttributes(), change), kids: node.toArray().map((child) => serialize(child, change)) }
  return node.toArray().map((child) => serialize(child, change))
}
const readableView = (doc, change) => JSON.stringify({ body: serialize(doc.getXmlFragment('default'), change), meta: mapValues(doc.getMap('meta').toJSON(), change) })
const stateVector = (doc) => JSON.stringify([...Y.decodeStateVector(Y.encodeStateVector(doc)).entries()].sort())
const deleteSetOf = (doc) => {
  const deleteSet = Y.createDeleteSetFromStructStore(doc.store)
  return JSON.stringify([...deleteSet.clients.entries()].sort().map(([client, ranges]) => [client, ranges.map((range) => [range.clock, range.len])]))
}

function judge(results) {
  let failedTrials = 0
  for (const result of results) {
    let failed = false
    const fail = (reason) => {
      if (!failed) failedTrials++
      failed = true
      console.log(`trial ${result.trial}: ${reason}`)
    }
    if (result.error) {
      fail(`server refused: ${result.error}`)
      continue
    }
    const source = loadDoc(result.rows.map(fromBase64))
    const remapped = loadDoc([fromBase64(result.remapped)])
    if (readableView(remapped, (value) => value) !== readableView(source, remapValue)) fail('Yjs reads something other than the source with the map applied')
    if (stateVector(remapped) !== stateVector(source)) fail('state vector differs')
    if (deleteSetOf(remapped) !== deleteSetOf(source)) fail('delete set differs')
    if (!result.rerun_unchanged) fail('a second remap changed the bytes')
    const stillOld = readableView(remapped, (value) => (remapValue(value) !== value ? '<<OLD>>' : value)).includes('<<OLD>>')
    if (stillOld) fail('a value still names an old id')
  }
  console.log(`${results.length - failedTrials}/${results.length} remapped compactions read as the source with the map applied`)
  return failedTrials
}

const [mode, ...args] = process.argv.slice(2)
if (mode === 'generate') {
  const [seed, trials, outPath] = args
  fs.writeFileSync(outPath, JSON.stringify({ map: MAP, trials: generate(Number(seed), Number(trials)) }))
} else if (mode === 'judge') {
  process.exit(judge(JSON.parse(fs.readFileSync(args[0], 'utf8'))) ? 1 : 0)
} else {
  console.error('usage: node remap.cjs generate <seed> <trials> <out.json> | judge <remapped.json>')
  process.exit(2)
}
