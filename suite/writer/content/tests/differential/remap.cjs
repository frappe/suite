// Media remap differential: Yjs must read a remapped compaction exactly as the source with the map applied
// Usage: node remap.cjs generate <seed> <trials> <out.json>, then python remap.py <in.json> <out.json>,
// then node remap.cjs judge <remapped.json>, which exits 1 on any disagreement
const path = require('path')
const fs = require('fs')
const Yjs = require(path.resolve(__dirname, '../../../../../node_modules/yjs'))

const OLD = ['pic0', 'pic1', 'pic2', 'pic3']
const MAP = Object.fromEntries(OLD.map((id, i) => [id, `new${i}x`]))
const EMBED_URL = /writer\.api\.embed\.get\?id=([A-Za-z0-9_-]{1,140})/g

function embed(id) {
  return `/api/method/suite.writer.api.embed.get?id=${id}`
}

// The rule Writer applies, written again here so the judge does not share code with the server
function remapMatch(match, id) {
  if (!(id in MAP)) {
    return match
  }

  return match.replace(id, MAP[id])
}

function remapValue(value) {
  if (value in MAP) {
    return MAP[value]
  }

  return value.replace(EMBED_URL, remapMatch)
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)]
}

function insertIndex(random, body) {
  return Math.floor(random() * (body.length + 1))
}

function sync(docs) {
  for (const from of docs) {
    for (const to of docs.filter((doc) => doc !== from)) {
      const missing = Yjs.encodeStateAsUpdate(from, Yjs.encodeStateVector(to))
      Yjs.applyUpdate(to, missing)
    }
  }
}

function imagesIn(node) {
  const found = []
  for (const child of node.toArray()) {
    if (!(child instanceof Yjs.XmlElement)) {
      continue
    }

    if (child.nodeName === 'image') {
      found.push(child)
    }

    found.push(...imagesIn(child))
  }

  return found
}

function textsIn(node) {
  const found = []
  for (const child of node.toArray()) {
    if (child instanceof Yjs.XmlText) {
      found.push(child)
    } else if (child instanceof Yjs.XmlElement) {
      found.push(...textsIn(child))
    }
  }

  return found
}

function insertImage(body, random) {
  const image = new Yjs.XmlElement('image')
  image.setAttribute('src', embed(pick(random, OLD)))
  if (random() < 0.3) {
    image.setAttribute('data-node', pick(random, OLD))
  }

  if (random() < 0.5) {
    const figure = new Yjs.XmlElement('figure')
    figure.insert(0, [image])
    body.insert(insertIndex(random, body), [figure])
  } else {
    body.insert(insertIndex(random, body), [image])
  }
}

function insertParagraph(body, random) {
  const paragraph = new Yjs.XmlElement('paragraph')
  const text = new Yjs.XmlText()
  paragraph.insert(0, [text])
  body.insert(insertIndex(random, body), [paragraph])

  const named = pick(random, OLD)
  const linked = embed(pick(random, OLD))
  text.insert(0, `about ${named} and ${linked} `)
}

function repointImage(doc, random) {
  const images = imagesIn(doc.getXmlFragment('default'))
  if (!images.length) {
    return
  }

  const image = pick(random, images)
  let src = 'https://elsewhere.test/a.png'
  if (random() < 0.7) {
    src = embed(pick(random, OLD))
  }

  image.setAttribute('src', src)
}

function linkText(doc, random) {
  const texts = textsIn(doc.getXmlFragment('default'))
  if (!texts.length) {
    return
  }

  const text = pick(random, texts)
  if (text.length <= 2) {
    return
  }

  const link = {
    href: embed(pick(random, OLD)),
    target: null,
  }
  text.format(0, 2, { link })
}

function embedInText(doc, random) {
  const texts = textsIn(doc.getXmlFragment('default'))
  if (!texts.length) {
    return
  }

  const text = pick(random, texts)
  const embedded = {
    src: embed(pick(random, OLD)),
    node: pick(random, OLD),
  }
  text.insertEmbed(text.length, embedded)
}

function setMeta(doc, random) {
  const meta = doc.getMap('meta')
  const poster = {
    src: pick(random, OLD),
    nested: { list: [embed(pick(random, OLD)), 3] },
  }
  meta.set('poster', poster)

  const named = pick(random, OLD)
  meta.set('title', `notes on ${named}`)
}

function applyStep(doc, random) {
  const body = doc.getXmlFragment('default')
  const roll = random()
  if (roll < 0.2) {
    insertImage(body, random)
  } else if (roll < 0.4) {
    insertParagraph(body, random)
  } else if (roll < 0.6) {
    repointImage(doc, random)
  } else if (roll < 0.7) {
    linkText(doc, random)
  } else if (roll < 0.75) {
    embedInText(doc, random)
  } else if (roll < 0.85) {
    setMeta(doc, random)
  } else if (body.length) {
    body.delete(Math.floor(random() * body.length), 1)
  }
}

function generateTrial(trial, random) {
  const rows = []
  const docs = [1, 2, 3].map((writer) => {
    const doc = new Yjs.Doc()
    doc.clientID = trial * 10 + writer
    doc.on('update', (update) => rows.push(Buffer.from(update).toString('base64')))
    return doc
  })

  for (let step = 0; step < 12; step++) {
    applyStep(pick(random, docs), random)
    if (random() < 0.3) {
      sync(docs)
    }
  }

  sync(docs)
  return { trial, rows }
}

function generate(seed, trials) {
  const random = seededRandom(seed)
  const histories = []
  for (let trial = 0; trial < trials; trial++) {
    histories.push(generateTrial(trial, random))
  }

  return histories
}

function fromBase64(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

function loadDoc(parts) {
  const doc = new Yjs.Doc()
  Yjs.transact(doc, () => {
    for (const part of parts) {
      Yjs.applyUpdate(doc, part)
    }
  })
  return doc
}

function mapValues(value, change) {
  if (typeof value === 'string') {
    return change(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => mapValues(item, change))
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return Object.fromEntries(keys.map((key) => [key, mapValues(value[key], change)]))
  }

  return value === undefined ? null : value
}

function serializeInsert(insert, change) {
  if (typeof insert === 'string') {
    return insert
  }

  return mapValues(insert, change)
}

// Values go through `change`; text, element names and keys never do
function serialize(node, change) {
  if (node instanceof Yjs.XmlText) {
    return node.toDelta().map((delta) => ({
      insert: serializeInsert(delta.insert, change),
      attributes: mapValues(delta.attributes ?? {}, change),
    }))
  }

  if (node instanceof Yjs.XmlElement) {
    return {
      el: node.nodeName,
      attrs: mapValues(node.getAttributes(), change),
      kids: node.toArray().map((child) => serialize(child, change)),
    }
  }

  return node.toArray().map((child) => serialize(child, change))
}

function readableView(doc, change) {
  const view = {
    body: serialize(doc.getXmlFragment('default'), change),
    meta: mapValues(doc.getMap('meta').toJSON(), change),
  }
  return JSON.stringify(view)
}

function stateVector(doc) {
  const vector = Yjs.decodeStateVector(Yjs.encodeStateVector(doc))
  return JSON.stringify([...vector.entries()].sort())
}

function deleteSetOf(doc) {
  const deleteSet = Yjs.createDeleteSetFromStructStore(doc.store)
  const clients = [...deleteSet.clients.entries()].sort()
  return JSON.stringify(clients.map(([client, ranges]) => [client, ranges.map((range) => [range.clock, range.len])]))
}

function markOld(value) {
  return remapValue(value) !== value ? '<<OLD>>' : value
}

function trialFailures(result) {
  if (result.error) {
    return [`server refused: ${result.error}`]
  }

  const failures = []
  const source = loadDoc(result.rows.map(fromBase64))
  const remapped = loadDoc([fromBase64(result.remapped)])
  const isReadAsMapped = readableView(remapped, (value) => value) === readableView(source, remapValue)
  if (!isReadAsMapped) {
    failures.push('Yjs reads something other than the source with the map applied')
  }

  if (stateVector(remapped) !== stateVector(source)) {
    failures.push('state vector differs')
  }

  if (deleteSetOf(remapped) !== deleteSetOf(source)) {
    failures.push('delete set differs')
  }

  if (!result.rerun_unchanged) {
    failures.push('a second remap changed the bytes')
  }

  const hasOldId = readableView(remapped, markOld).includes('<<OLD>>')
  if (hasOldId) {
    failures.push('a value still names an old id')
  }

  return failures
}

function judge(results) {
  let failedTrials = 0
  for (const result of results) {
    const failures = trialFailures(result)
    for (const reason of failures) {
      console.log(`trial ${result.trial}: ${reason}`)
    }

    if (failures.length) {
      failedTrials++
    }
  }

  const passedTrials = results.length - failedTrials
  console.log(`${passedTrials}/${results.length} remapped compactions read as the source with the map applied`)
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
