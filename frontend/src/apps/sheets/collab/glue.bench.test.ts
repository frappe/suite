// Speed of the glue on a 100k-cell sheet. Skipped in normal runs; run with
//   SHEETS_BENCH=1 yarn vitest run src/apps/sheets/collab/glue.bench.test.ts --silent=false
// Numbers go into COLLAB-DESIGN (Q11: IronCalc rebuild on open).

/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { cellId } from '../utils/cells'
import { addSheet, axis, cellKey, initDoc, roots } from './schema'
import { cmd, inputs, openTab, type } from './test-tabs'

const ROWS = 10_000
const COLS = 10
const FORMATTED = 10_000 // cells with a format: every 10th

const colLetter = (c: number) => String.fromCharCode(65 + c)
const mixed = (r: number, c: number) => {
  const k = (r * 31 + c * 17) % 20
  if (k < 12) return String((r * 7919 + c * 104729) % 1000000)
  if (k < 17) return `Customer ${r}-${c}`
  return `=SUM(${colLetter(c)}${Math.max(1, r - 9)}:${colLetter(c)}${r + 1})`
}

// A doc as a converter would write it: one transaction, 100k inputs, 10k formats.
function bigDoc(): Y.Doc {
  const doc = new Y.Doc()
  doc.transact(() => {
    initDoc(doc)
    const sid = addSheet(doc, 'Sheet1')
    const rows = axis(doc, sid, 'rows')
    const cols = axis(doc, sid, 'cols')
    const r = roots(doc)
    cols.ensure(COLS - 1)
    rows.ensure(ROWS - 1)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const key = cellKey(sid, rows.idAt(row)!, cols.idAt(col)!)
        r.inputs.set(key, mixed(row, col))
        if ((row * COLS + col) % ((ROWS * COLS) / FORMATTED) === 0)
          r.formats.set(key, { bold: true })
      }
    }
  })
  return doc
}

async function time<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now()
  const out = await fn()
  return [out, performance.now() - t]
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

describe.skipIf(!process.env.SHEETS_BENCH)('glue benchmark: 100k cells', () => {
  it('opens, types and receives', { timeout: 600_000 }, async () => {
    const doc = bigDoc()
    const [a, openMs] = await time(() => openTab('A', doc))
    expect(Object.keys(await inputs(a)).length).toBeGreaterThan(ROWS * COLS * 0.9)
    const b = await openTab('B', a.doc)

    // The same keystroke in IronCalc alone (apply + recalc), no glue: the floor.
    const plain: number[] = []
    for (let i = 0; i < 20; i++) {
      const [, ms] = await time(async () => {
        b.client.dispatch(
          cmd('setInput', { sheet: 'Sheet1', row: 2000 + i, col: 12, input: String(i) }),
        )
        await b.client.idle()
      })
      plain.push(ms)
    }
    b.client.dispatch(
      cmd('clearContents', { sheet: 'Sheet1', range: { r1: 2000, c1: 12, r2: 2019, c2: 12 } }),
    )
    await b.client.idle()

    // One keystroke: dispatch + commit (store diff over 10k formats included).
    const commits: number[] = []
    for (let i = 0; i < 20; i++) {
      const [, ms] = await time(() => type(a, 'Sheet1', cellId(i, 0), String(i)))
      commits.push(ms)
    }
    // The same keystroke arriving in the other tab: receive → IronCalc batch → stores.
    const receives: number[] = []
    for (const update of a.outbox.splice(0)) {
      const t = performance.now()
      b.glue.receive(update)
      await b.glue.settled()
      receives.push(performance.now() - t)
    }
    // A row insert near the top: every formula is re-read and re-sent.
    const [, insertMs] = await time(async () => {
      a.glue.dispatch(cmd('insertRows', { sheet: 'Sheet1', row: 2, count: 1 }))
      await a.glue.commit()
    })
    const update = a.outbox.splice(0)
    const [, insertInMs] = await time(async () => {
      for (const u of update) b.glue.receive(u)
      await b.glue.settled()
    })

    console.log(
      [
        `open (decode + IronCalc rebuild + stores): ${openMs.toFixed(0)} ms`,
        `IronCalc alone, one cell (apply + recalc, median of 20): ${median(plain).toFixed(1)} ms`,
        `type one cell, out (commit, median of 20): ${median(commits).toFixed(1)} ms`,
        `type one cell, in (receive + IronCalc apply, median): ${median(receives).toFixed(1)} ms`,
        `insert a row, out: ${insertMs.toFixed(0)} ms; in: ${insertInMs.toFixed(0)} ms`,
      ].join('\n'),
    )
  })
})
