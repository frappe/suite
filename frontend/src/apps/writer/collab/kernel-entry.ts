import { judge } from '@suite/collab-client'

import { writerFault } from '@/apps/writer/collab/fault'

// The Node child the server runs on demand: {checkpoint, rows} in base64 on stdin, a verdict on stdout
const chunks: Buffer[] = []
process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
process.stdin.on('end', () => {
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
  process.stdout.write(JSON.stringify(verdict))
})
