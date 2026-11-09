import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { readSlides } from './deck'

// The built converter (yarn build), run as the server runs it (suite/content/checker.py
// `node_command`): allowed to read only itself. A missing bundle skips here, and
// suite/slides/content/tests run the same bundle from Python
const CONVERTER = path.resolve(__dirname, '../../../../../suite/slides/content/dist/converter.cjs')
const VERSION = fromPartial<string>(
  JSON.parse(
    fs.readFileSync(path.resolve(path.dirname(CONVERTER), '../converter-version.json'), 'utf8'),
  ).version,
)

function run(header: unknown): Record<string, unknown> {
  const real = fs.realpathSync(CONVERTER)
  const body = Buffer.from(JSON.stringify(header))
  const length = Buffer.alloc(4)
  length.writeUInt32LE(body.length)
  const child = spawnSync(
    process.execPath,
    ['--permission', `--allow-fs-read=${real}`, '--expose-gc', real],
    {
      input: Buffer.concat([length, body]),
      env: {},
      timeout: 60_000,
    },
  )
  if (child.status !== 0) {
    throw new Error(child.stderr.toString())
  }

  return fromPartial<Record<string, unknown>>(JSON.parse(child.stdout.toString()))
}

describe.skipIf(!fs.existsSync(CONVERTER))('converter bundle under --permission', () => {
  it('answers its version to an empty request', () => {
    expect(run({})).toEqual({ version: VERSION })
  })

  it('converts a deck into a doc the browsers can open', { timeout: 60_000 }, () => {
    const elements = [{ id: 'element', type: 'text', content: '<p><strong>a</strong><br>b</p>' }]
    const answer = run({
      legacy: { slides: [{ id: 'slide', elements }] },
      maxState: 4 * 1024 * 1024,
    })
    expect(answer).toMatchObject({ kind: 'converted', version: VERSION, dropped: [] })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Buffer.from(fromPartial<string>(answer.state), 'base64'))
    expect(
      readSlides(doc).map(({ id, elements }) => [id, elements.map((element) => element.id)]),
    ).toEqual([['slide', ['element']]])
  })

  it('refuses a deck over maxState', { timeout: 60_000 }, () => {
    const elements = [{ id: 'element', type: 'text', content: '<p>a</p>' }]
    expect(run({ legacy: { slides: [{ id: 'slide', elements }] }, maxState: 8 })).toEqual({
      kind: 'failed',
      reason: 'too_large',
      version: VERSION,
    })
  })
})
