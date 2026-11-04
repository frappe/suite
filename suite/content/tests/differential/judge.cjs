// Checks the server's compactions (compact.py's output) against Yjs, the library the browsers run
// Usage: node judge.cjs <compacted.json>. Exits 1 on any disagreement
// Every history must end either compacted, equal to Yjs on content, state vector and delete set,
// or uncompacted because one of its rows splits a surrogate pair or can't be read, which Yjs must confirm
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const Yjs = require(path.resolve(__dirname, '../../../../node_modules/yjs'))

function decodeBase64(base64Text) {
  return new Uint8Array(Buffer.from(base64Text, 'base64'))
}

function sortKeys(value) {
  if (value instanceof Yjs.AbstractType) {
    return serialize(value)
  }

  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }

  if (value instanceof Uint8Array) {
    return { $bin: Buffer.from(value).toString('hex') }
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
  }

  return value === undefined ? null : value
}

function delta(text) {
  return text.toDelta().map((op) => {
    const entry = { insert: sortKeys(op.insert) }
    if (op.attributes) {
      entry.attributes = sortKeys(op.attributes)
    }

    return entry
  })
}

function serialize(value) {
  if (value instanceof Yjs.XmlText) {
    return { text: delta(value), attrs: sortKeys(value.getAttributes()) }
  }

  if (value instanceof Yjs.XmlElement) {
    return { el: value.nodeName, attrs: sortKeys(value.getAttributes()), kids: value.toArray().map(serialize) }
  }

  if (value instanceof Yjs.XmlFragment) {
    return { frag: value.toArray().map(serialize) }
  }

  if (value instanceof Yjs.Map) {
    return { map: Object.fromEntries([...value.keys()].sort().map((key) => [key, serialize(value.get(key))])) }
  }

  if (value instanceof Yjs.Array) {
    return { arr: value.toArray().map(serialize) }
  }

  return sortKeys(value)
}

function content(doc) {
  let roots
  if (doc.share.has('slides')) {
    roots = { meta: doc.getMap('meta'), slides: doc.getMap('slides'), provenance: doc.getMap('provenance') }
  } else {
    roots = { default: doc.getXmlFragment('default'), meta: doc.getMap('meta') }
  }

  return JSON.stringify(Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, serialize(root)])))
}

function load(parts) {
  const doc = new Yjs.Doc()
  Yjs.transact(doc, () => {
    for (const part of parts) {
      Yjs.applyUpdate(doc, part)
    }
  })
  return doc
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff
}

// A row cuts a pair when Yjs ends up with more broken halves than the row itself carries (r12's count)
function brokenHalves(text) {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(i + 1))) {
      i++
      continue
    }

    if (code === 0xfffd || isHighSurrogate(code) || isLowSurrogate(code)) {
      count++
    }
  }

  return count
}

function isString(struct) {
  return struct.content?.constructor === Yjs.ContentString
}

function brokenHalvesIn(doc) {
  return [...doc.store.clients.values()].flat().filter(isString).reduce((count, struct) => count + brokenHalves(struct.content.str), 0)
}

function cutsSurrogate(parts) {
  const doc = new Yjs.Doc({ gc: false })
  return parts.some((part) => {
    const before = brokenHalvesIn(doc)
    Yjs.applyUpdate(doc, part)
    const ownBroken = Yjs.decodeUpdate(part).structs.filter(isString).reduce((count, struct) => count + brokenHalves(struct.content.str), 0)
    return brokenHalvesIn(doc) - before > ownBroken
  })
}

function unreadable(row) {
  try {
    Yjs.decodeUpdate(decodeBase64(row))
    return false
  } catch {
    return true
  }
}

function finalOutcomeDisagreement(finalOutcome, result, job) {
  const parts = [job.cp, ...job.rows, job.heal].filter(Boolean).map(decodeBase64)
  if (finalOutcome === 'compacted') {
    const expected = load(parts)
    const compacted = load([decodeBase64(result.cp)])
    const isSameAsYjs = content(compacted) === content(expected) && Yjs.equalSnapshots(Yjs.snapshot(compacted), Yjs.snapshot(expected))
    return isSameAsYjs ? null : 'differs from Yjs'
  }

  if (finalOutcome === 'malformed_row') {
    return job.rows.some(unreadable) ? null : 'refused rows Yjs reads'
  }

  if (finalOutcome !== 'cut_surrogate' || !cutsSurrogate(parts)) {
    const stages = result.outcomes.join(' > ')
    return `left uncompacted: ${stages}`
  }

  return null
}

const jobs = new Map()
for (const name of ['robust', 'emoji']) {
  const compressed = fs.readFileSync(path.join(__dirname, `${name}.json.gz`))
  for (const job of JSON.parse(zlib.gunzipSync(compressed))) {
    jobs.set(job.id, job)
  }
}

const results = JSON.parse(fs.readFileSync(process.argv[2]))
const disagreements = []
const tally = {}
for (const result of results) {
  const job = jobs.get(result.id)
  const finalOutcome = result.outcomes[result.outcomes.length - 1]
  tally[finalOutcome] = (tally[finalOutcome] ?? 0) + 1
  const disagreement = finalOutcomeDisagreement(finalOutcome, result, job)
  if (disagreement) {
    disagreements.push([result.id, disagreement])
  }

  if (result.outcomes.slice(0, -1).some((outcome) => outcome !== 'compacted' && outcome !== 'missing_dependency')) {
    const stages = result.outcomes.join(' > ')
    disagreements.push([result.id, `refused before its last stage: ${stages}`])
  }
}

for (const id of jobs.keys()) {
  if (!results.some((result) => result.id === id)) {
    disagreements.push([id, 'not compacted'])
  }
}

console.log(JSON.stringify({ histories: results.length, outcomes: tally, wrong: disagreements }, null, 1))
process.exit(disagreements.length ? 1 : 0)
