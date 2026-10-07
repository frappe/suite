// Checks the server's compactions (compact.py's output) against Yjs, the library the browsers run.
// Usage: node judge.cjs <compacted.json>. Exits 1 on any disagreement.
// Every history must end either compacted, equal to Yjs on content, state vector and delete set,
// or uncompacted because one of its rows splits a surrogate pair or can't be read, which Yjs must confirm.
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const Y = require(path.resolve(__dirname, '../../../../../node_modules/yjs'))

const bytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
const sortKeys = (x) => {
  if (x instanceof Y.AbstractType) return ser(x)
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x instanceof Uint8Array) return { $bin: Buffer.from(x).toString('hex') }
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]))
  return x === undefined ? null : x
}
const delta = (t) =>
  t.toDelta().map((op) => ({ insert: sortKeys(op.insert), ...(op.attributes ? { attributes: sortKeys(op.attributes) } : {}) }))
function ser(v) {
  if (v instanceof Y.XmlText) return { text: delta(v), attrs: sortKeys(v.getAttributes()) }
  if (v instanceof Y.XmlElement) return { el: v.nodeName, attrs: sortKeys(v.getAttributes()), kids: v.toArray().map(ser) }
  if (v instanceof Y.XmlFragment) return { frag: v.toArray().map(ser) }
  if (v instanceof Y.Map) return { map: Object.fromEntries([...v.keys()].sort().map((k) => [k, ser(v.get(k))])) }
  if (v instanceof Y.Array) return { arr: v.toArray().map(ser) }
  return sortKeys(v)
}
const content = (doc) => {
  const roots = doc.share.has('slides') ? { meta: doc.getMap('meta'), slides: doc.getMap('slides'), provenance: doc.getMap('provenance') } : { default: doc.getXmlFragment('default'), meta: doc.getMap('meta') }
  return JSON.stringify(Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, ser(root)])))
}
const load = (parts) => {
  const doc = new Y.Doc()
  Y.transact(doc, () => parts.forEach((part) => Y.applyUpdate(doc, part)))
  return doc
}

// A row cuts a pair when Yjs ends up with more broken halves than the row itself carries (r12's count)
const broken = (text) => {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    if (k === 0xfffd) n++
    else if (k >= 0xd800 && k <= 0xdbff) {
      const q = text.charCodeAt(i + 1)
      if (q >= 0xdc00 && q <= 0xdfff) i++
      else n++
    } else if (k >= 0xdc00 && k <= 0xdfff) n++
  }
  return n
}
const isString = (s) => s.content?.constructor === Y.ContentString
const brokenIn = (doc) => [...doc.store.clients.values()].flat().filter(isString).reduce((n, s) => n + broken(s.content.str), 0)
const cuts = (parts) => {
  const doc = new Y.Doc({ gc: false })
  return parts.some((part) => {
    const before = brokenIn(doc)
    Y.applyUpdate(doc, part)
    const own = Y.decodeUpdate(part).structs.filter(isString).reduce((n, s) => n + broken(s.content.str), 0)
    return brokenIn(doc) - before > own
  })
}

const unreadable = (row) => {
  try {
    Y.decodeUpdate(bytes(row))
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
const wrong = []
const tally = {}
for (const result of results) {
  const job = jobs.get(result.id)
  const parts = [job.cp, ...job.rows, job.heal].filter(Boolean).map(bytes)
  const final = result.outcomes[result.outcomes.length - 1]
  tally[final] = (tally[final] ?? 0) + 1
  if (final === 'compacted') {
    const expected = load(parts)
    const found = load([bytes(result.cp)])
    if (content(found) !== content(expected) || !Y.equalSnapshots(Y.snapshot(found), Y.snapshot(expected))) wrong.push([result.id, 'differs from Yjs'])
  } else if (final === 'malformed_row') {
    if (!job.rows.some(unreadable)) wrong.push([result.id, 'refused rows Yjs reads'])
  } else if (final !== 'cut_surrogate' || !cuts(parts)) {
    wrong.push([result.id, `left uncompacted: ${result.outcomes.join(' > ')}`])
  }
  if (result.outcomes.slice(0, -1).some((outcome) => outcome !== 'compacted' && outcome !== 'missing_dependency')) {
    wrong.push([result.id, `refused before its last stage: ${result.outcomes.join(' > ')}`])
  }
}
for (const id of jobs.keys()) if (!results.some((result) => result.id === id)) wrong.push([id, 'not compacted'])
console.log(JSON.stringify({ histories: results.length, outcomes: tally, wrong }, null, 1))
process.exit(wrong.length ? 1 : 0)
