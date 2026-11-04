import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { addSheet, axis, cellKey, initDoc, roots } from './schema'
import { docSheets } from './stores'

// The built bundles (yarn build), run as the server runs them
// (suite/content/checker.py `node_command`): allowed to read only themselves.
// suite/sheets/content/tests check the same bundles from Python, and fail on
// CI when they are missing; here a missing bundle skips.
const DIST = path.resolve(__dirname, '../../../../../suite/sheets/content/dist')
const CHECKER = path.join(DIST, 'checker.cjs')
const CONVERTER = path.join(DIST, 'converter.cjs')
const VERSION = JSON.parse(fs.readFileSync(path.resolve(DIST, '../converter-version.json'), 'utf8'))
  .version as string

// checker.py `framed`: each part after its length in 4 little-endian bytes.
function framed(parts: Uint8Array[]): Buffer {
  return Buffer.concat(
    parts.flatMap((part) => {
      const length = Buffer.alloc(4)
      length.writeUInt32LE(part.length)
      return [length, Buffer.from(part)]
    }),
  )
}

function run(bundle: string, header: object, ...rest: Uint8Array[]): Record<string, unknown> {
  const real = fs.realpathSync(bundle)
  const child = spawnSync(
    process.execPath,
    ['--permission', `--allow-fs-read=${real}`, '--expose-gc', real],
    { input: framed([Buffer.from(JSON.stringify(header)), ...rest]), env: {}, timeout: 60_000 },
  )
  if (child.status !== 0) throw new Error(`exit ${child.status}: ${child.stderr.toString()}`)
  return JSON.parse(child.stdout.toString()) as Record<string, unknown>
}

describe.skipIf(!fs.existsSync(CONVERTER))('converter bundle under --permission', () => {
  it('answers its version to an empty request', () => {
    expect(run(CONVERTER, {})).toEqual({ version: VERSION })
  })

  it('converts a develop body into a doc the browsers can open', { timeout: 60_000 }, () => {
    const legacy = {
      sheets_data: JSON.stringify({
        sheet: { v: 2, sheets: { Budget: { rows: { '0': ['Rent', '1200'] } } } },
      }),
    }
    const answer = run(CONVERTER, { legacy, maxState: 4 * 1024 * 1024 })
    expect(answer).toMatchObject({ kind: 'converted', version: VERSION, dropped: [] })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Buffer.from(answer.state as string, 'base64'))
    expect(docSheets(doc).map((s) => s.name)).toEqual(['Budget'])
    expect([...roots(doc).inputs.values()].sort()).toEqual(['1200', 'Rent'])
    expect(answer.html).toContain('<td>Rent</td>')
  })

  it('refuses a doc over maxState', { timeout: 60_000 }, () => {
    const legacy = {
      sheets_data: JSON.stringify({ sheet: { v: 2, sheets: { S: { rows: { '0': ['x'] } } } } }),
    }
    expect(run(CONVERTER, { legacy, maxState: 8 })).toEqual({
      kind: 'failed',
      reason: 'too_large',
      version: VERSION,
    })
  })
})

describe.skipIf(!fs.existsSync(CHECKER))('checker bundle under --permission', () => {
  function rows() {
    const doc = new Y.Doc()
    initDoc(doc)
    const sheetId = addSheet(doc, 'Sheet1')
    const checkpoint = Y.encodeStateAsUpdate(doc)
    const out: Uint8Array[] = []
    doc.on('update', (u: Uint8Array) => out.push(u))
    const key = cellKey(
      sheetId,
      axis(doc, sheetId, 'rows').ensure(0),
      axis(doc, sheetId, 'cols').ensure(0),
    )
    roots(doc).inputs.set(key, '=1+1')
    return { doc, checkpoint, out }
  }

  it('finds no fault in what the glue writes', () => {
    const { checkpoint, out } = rows()
    expect(run(CHECKER, { mode: 'judge' }, checkpoint, ...out)).toMatchObject({ verdict: 'clean' })
  })

  it('names the first row the editor could not take', () => {
    const { doc, checkpoint, out } = rows()
    doc.getArray('stray').push([1])
    expect(run(CHECKER, { mode: 'judge' }, checkpoint, ...out)).toMatchObject({
      verdict: 'bad',
      index: out.length - 1,
      reason: 'schema: unknown root',
    })
  })

  it('answers whether a checkpoint covers rows', () => {
    const { doc, checkpoint, out } = rows()
    const full = Y.encodeStateAsUpdate(doc)
    expect(run(CHECKER, { mode: 'covers' }, full, ...out)).toMatchObject({ covered: true })
    expect(run(CHECKER, { mode: 'covers' }, checkpoint, ...out)).toMatchObject({ covered: false })
  })
})
