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

interface CheckerHeader {
  mode: 'judge' | 'covers'
}

// node_command starts the child with --expose-gc, so each probe's doc is collected before the next
const { gc } = globalThis as unknown as { gc: () => void }

const stdinChunks: Buffer[] = []

function verdictOn(header: CheckerHeader, checkpoint: Uint8Array | null, rows: Uint8Array[]) {
  if (header.mode === 'covers') {
    return { covered: checkpoint !== null && covers(checkpoint, rows) }
  }

  return judge(checkpoint, rows, slidesFault, gc)
}

function judgeInput() {
  // Trusted as checker.py's own request; anything else throws, and the server sees the child fail
  const [headerFrame, checkpointFrame, ...rows] = readFrames(Buffer.concat(stdinChunks))
  stdinChunks.length = 0
  const header = JSON.parse(headerFrame!.toString()) as CheckerHeader
  const checkpoint = checkpointFrame?.length ? checkpointFrame : null
  const answer = verdictOn(header, checkpoint, rows)
  process.stdout.write(JSON.stringify({ ...answer, yjs: __CHECKER_YJS__ }))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', judgeInput)
