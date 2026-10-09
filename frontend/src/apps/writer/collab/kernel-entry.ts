import { judge } from '@suite/collab-client'

import { writerFault } from '@/apps/writer/collab/fault'

// Node's permission model can't block the network, so the child drops the globals the editor's
// paste and upload code would reach it with; judging never calls them
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
}

type KernelInput = {
  checkpoint: string | null
  rows: string[]
}

// The Node child the server runs on demand: {checkpoint, rows} in base64 on stdin, a verdict
// and the bundled Yjs version on stdout
const stdinChunks: Buffer[] = []

const judgeInput = () => {
  // Trusted as kernel.py's own request; anything else throws, and the server sees the child fail
  const inputText = Buffer.concat(stdinChunks).toString()
  const input = JSON.parse(inputText) as KernelInput

  const fromBase64 = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))
  const checkpoint = input.checkpoint ? fromBase64(input.checkpoint) : null
  const rows = input.rows.map(fromBase64)
  const verdict = judge(checkpoint, rows, writerFault)

  const reply = {
    ...verdict,
    yjs: __KERNEL_YJS__,
  }
  process.stdout.write(JSON.stringify(reply))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', judgeInput)
