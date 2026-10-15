// Checks the server's compactions (compact.py's output) against Yjs, the library the browsers run.
// Usage: node judge.cjs <compacted.json>. Exits 1 on any disagreement.
// Every history must end either compacted, equal to Yjs on content, state vector and delete set,
// or uncompacted because one of its rows splits a surrogate pair or can't be read, which Yjs must confirm.
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const Y = require(path.resolve(__dirname, '../../../../../node_modules/yjs'))

const decodeBase64 = (base64Text) => new Uint8Array(Buffer.from(base64Text, 'base64'))
const sortKeys = (value) => {
  if (value instanceof Y.AbstractType) return serialize(value)
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value instanceof Uint8Array) return { $bin: Buffer.from(value).toString('hex') }
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
  return value === undefined ? null : value
}
const delta = (text) =>
  text.toDelta().map((op) => ({ insert: sortKeys(op.insert), ...(op.attributes ? { attributes: sortKeys(op.attributes) } : {}) }))
function serialize(value) {
  if (value instanceof Y.XmlText) return { text: delta(value), attrs: sortKeys(value.getAttributes()) }
  if (value instanceof Y.XmlElement) return { el: value.nodeName, attrs: sortKeys(value.getAttributes()), kids: value.toArray().map(serialize) }
  if (value instanceof Y.XmlFragment) return { frag: value.toArray().map(serialize) }
  if (value instanceof Y.Map) return { map: Object.fromEntries([...value.keys()].sort().map((key) => [key, serialize(value.get(key))])) }
  if (value instanceof Y.Array) return { arr: value.toArray().map(serialize) }
  return sortKeys(value)
}
const content = (doc) => {
  const roots = doc.share.has('slides') ? { meta: doc.getMap('meta'), slides: doc.getMap('slides'), provenance: doc.getMap('provenance') } : { default: doc.getXmlFragment('default'), meta: doc.getMap('meta') }
  return JSON.stringify(Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, serialize(root)])))
}
const load = (parts) => {
  const doc = new Y.Doc()
  Y.transact(doc, () => parts.forEach((part) => Y.applyUpdate(doc, part)))
  return doc
}

// A row cuts a pair when Yjs ends up with more broken halves than the row itself carries (r12's count)
const brokenHalves = (text) => {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0xfffd) count++
    else if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = text.charCodeAt(i + 1)
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) i++
      else count++
    } else if (code >= 0xdc00 && code <= 0xdfff) count++
  }
  return count
}
const isString = (struct) => struct.content?.constructor === Y.ContentString
const brokenHalvesIn = (doc) => [...doc.store.clients.values()].flat().filter(isString).reduce((count, struct) => count + brokenHalves(struct.content.str), 0)
const cutsSurrogate = (parts) => {
  const doc = new Y.Doc({ gc: false })
  return parts.some((part) => {
    const before = brokenHalvesIn(doc)
    Y.applyUpdate(doc, part)
    const ownBroken = Y.decodeUpdate(part).structs.filter(isString).reduce((count, struct) => count + brokenHalves(struct.content.str), 0)
    return brokenHalvesIn(doc) - before > ownBroken
  })
}

const unreadable = (row) => {
  try {
    Y.decodeUpdate(decodeBase64(row))
    return false
  } catch {
    return true
  }
}

const jobs = new Map()
for (const name of ['robust', 'emoji']) {
  for (const job of JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, `${name}.json.gz`))))) jobs.set(job.id, job)
}
const results = JSON.parse(fs.readFileSync(process.argv[2]))
const disagreements = []
const tally = {}
for (const result of results) {
  const job = jobs.get(result.id)
  const parts = [job.cp, ...job.rows, job.heal].filter(Boolean).map(decodeBase64)
  const finalOutcome = result.outcomes[result.outcomes.length - 1]
  tally[finalOutcome] = (tally[finalOutcome] ?? 0) + 1
  if (finalOutcome === 'compacted') {
    const expected = load(parts)
    const compacted = load([decodeBase64(result.cp)])
    if (content(compacted) !== content(expected) || !Y.equalSnapshots(Y.snapshot(compacted), Y.snapshot(expected))) disagreements.push([result.id, 'differs from Yjs'])
  } else if (finalOutcome === 'malformed_row') {
    if (!job.rows.some(unreadable)) disagreements.push([result.id, 'refused rows Yjs reads'])
  } else if (finalOutcome !== 'cut_surrogate' || !cutsSurrogate(parts)) {
    disagreements.push([result.id, `left uncompacted: ${result.outcomes.join(' > ')}`])
  }
  if (result.outcomes.slice(0, -1).some((outcome) => outcome !== 'compacted' && outcome !== 'missing_dependency')) {
    disagreements.push([result.id, `refused before its last stage: ${result.outcomes.join(' > ')}`])
  }
}
for (const id of jobs.keys()) if (!results.some((result) => result.id === id)) disagreements.push([id, 'not compacted'])
console.log(JSON.stringify({ histories: results.length, outcomes: tally, wrong: disagreements }, null, 1))
process.exit(disagreements.length ? 1 : 0)
