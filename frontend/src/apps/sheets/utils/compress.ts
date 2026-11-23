// The gzip + base64 envelope `sheets_data` may be stored in, read on download.
//
// Mirrors the server-side wire format in suite/sheets/doctype/sheet/storage.py:
//
//   {"_z": "gzip", "data": "<base64-encoded gzip bytes>"}

const MARKER = '_z'
const KIND = 'gzip'

export function isDecompressionSupported(): boolean {
  return typeof DecompressionStream !== 'undefined'
}

// The download path: unwrap a stored envelope
// ({"_z":"gzip","data":"<base64>"}) back into the plain JSON string. Legacy
// values (plain JSON, or a server that already decoded) pass through untouched.
// Lets get_sheet ship the ~1.5MB compressed payload instead of the ~20MB
// decoded one and decompress here — gunzip runs on a stream, off the critical
// parse path.
export async function decodeFromDownload(
  stored: string | null | undefined,
): Promise<string | null | undefined> {
  if (!stored || typeof stored !== 'string') return stored
  // Envelopes are tiny and always start with the marker key; the workbook JSON
  // starts with `{"sheet"`/`{"v"`, so this cheap check avoids parsing a 20MB
  // legacy string just to discover it isn't an envelope.
  if (!stored.startsWith('{"_z"')) return stored
  let env
  try {
    env = JSON.parse(stored)
  } catch {
    return stored
  }
  if (!env || env[MARKER] !== KIND || typeof env.data !== 'string') return stored
  return _gunzip(env.data)
}

async function _gunzip(base64: string): Promise<string> {
  const bytes = _base64ToBytes(base64)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function _base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
