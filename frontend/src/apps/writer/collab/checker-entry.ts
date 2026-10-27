import { covers, judge } from '@suite/collab-client'

import { readFrames } from '@/apps/writer/collab/child-input'
import { writerFault } from '@/apps/writer/collab/fault'

// Node's permission model can't block the network, so the child drops the globals the editor's
// paste and upload code would reach it with; judging never calls them
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
}

interface CheckerHeader {
  mode: 'judge' | 'covers'
}

// node_command starts the child with --expose-gc, so each probe's document is collected before the next
const { gc } = globalThis as unknown as { gc: () => void }

// The Node child the server runs on demand. On stdin, frames: a JSON header, the checkpoint (empty
// for none), then one frame per row. On stdout, a verdict and the bundled Yjs version; in `covers`
// mode, whether the checkpoint holds the rows
const stdinChunks: Buffer[] = []

function judgeInput() {
  // Trusted as checker.py's own request; anything else throws, and the server sees the child fail
  const [headerFrame, checkpointFrame, ...rows] = readFrames(Buffer.concat(stdinChunks))
  stdinChunks.length = 0
  const header = JSON.parse(headerFrame.toString()) as CheckerHeader
  const checkpoint = checkpointFrame.length ? checkpointFrame : null

  let answer: object
  if (header.mode === 'covers') {
    answer = { covered: checkpoint !== null && covers(checkpoint, rows) }
  } else {
    answer = judge(checkpoint, rows, writerFault, gc)
  }

  const reply = {
    ...answer,
    yjs: __CHECKER_YJS__,
  }
  process.stdout.write(JSON.stringify(reply))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', judgeInput)
