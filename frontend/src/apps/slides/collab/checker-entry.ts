import { covers, judge } from '@suite/collab-client'

import { readFrames } from './child-input'
import { slidesFault } from './fault'

// The Node child the server runs on demand (suite/content/checker.py), as
// Writer's and Sheets' checker-entry.ts: on stdin, frames of a JSON header, the checkpoint
// (empty for none), then one frame per row; on stdout, a verdict and the
// bundled Yjs version, or in `covers` mode whether the checkpoint holds the rows

// Node's permission model can't block the network, so the child drops the
// network globals; judging never calls them
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
}

// node_command starts the child with --expose-gc, so each probe's doc is collected before the next
function gc() {
  if (typeof globalThis.gc !== 'function') throw new Error('The checker requires Node --expose-gc')
  globalThis.gc()
}

const stdinChunks: Buffer[] = []

function verdictOn(mode: 'judge' | 'covers', checkpoint: Uint8Array | null, rows: Uint8Array[]) {
  if (mode === 'covers') {
    return { covered: checkpoint !== null && covers(checkpoint, rows) }
  }

  return judge(checkpoint, rows, slidesFault, gc)
}

function judgeInput() {
  // Trusted as checker.py's own request; anything else throws, and the server sees the child fail
  const [headerFrame, checkpointFrame, ...rows] = readFrames(Buffer.concat(stdinChunks))
  stdinChunks.length = 0
  const header: unknown = JSON.parse(headerFrame!.toString())
  if (
    !header ||
    typeof header !== 'object' ||
    !('mode' in header) ||
    (header.mode !== 'judge' && header.mode !== 'covers')
  )
    throw new Error('Invalid checker mode')
  const checkpoint = checkpointFrame?.length ? checkpointFrame : null
  const answer = verdictOn(header.mode, checkpoint, rows)
  process.stdout.write(JSON.stringify({ ...answer, yjs: __CHECKER_YJS__ }))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', judgeInput)
