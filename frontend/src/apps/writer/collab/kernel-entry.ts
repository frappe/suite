import { judge } from '@suite/collab-client'

import { writerFault } from '@/apps/writer/collab/fault'

// Node's permission model can't block the network, so the child drops the globals the editor's
// paste and upload code would reach it with; judging never calls them
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
}

// The Node child the server runs on demand: {checkpoint, rows} in base64 on stdin, a verdict
// and the bundled Yjs version on stdout
const chunks: Buffer[] = []
process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
process.stdin.on('end', () => {
  // Trusted as kernel.py's own request; anything else throws, and the server sees the child fail
  const input = JSON.parse(Buffer.concat(chunks).toString()) as {
    checkpoint: string | null
    rows: string[]
  }
  const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'base64'))
  const verdict = judge(
    input.checkpoint ? bytes(input.checkpoint) : null,
    input.rows.map(bytes),
    writerFault,
  )
  process.stdout.write(JSON.stringify({ ...verdict, yjs: __KERNEL_YJS__ }))
})
