/** The bytes of base64 text, as the server sends a Yjs state. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

/** A stored version's Yjs state, from its gzipped base64 text. */
export async function readStoredState(text: string): Promise<Uint8Array> {
  const stream = new Response(fromBase64(text)).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
