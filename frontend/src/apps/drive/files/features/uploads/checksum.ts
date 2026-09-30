/** Bytes read per step. A whole file never sits in memory. */
const STEP_BYTES = 8 * 1024 * 1024

/**
 * The sha256 of a file as lowercase hex, the form the server compares
 * (spec §6.2). Only a resumed upload needs it, so `hash-wasm` loads here and
 * nowhere else.
 */
export async function sha256(file: Blob): Promise<string> {
  const { createSHA256 } = await import('hash-wasm')
  const hasher = await createSHA256()
  hasher.init()
  for (let offset = 0; offset < file.size; offset += STEP_BYTES) {
    hasher.update(new Uint8Array(await file.slice(offset, offset + STEP_BYTES).arrayBuffer()))
  }
  return hasher.digest('hex')
}
