// Gzip + base64 envelope for uploading large sheets_data payloads.
//
// Mirrors the server-side wire format in
// sheets/sheets/doctype/sheet/storage.py:
//
//   {"_z": "gzip", "data": "<base64-encoded gzip bytes>"}
//
// The server's `_validate_payload` and `save_sheet` accept either the envelope
// or plain JSON, so this is purely an optimisation — if `CompressionStream`
// isn't available (older Safari) or the payload is tiny, we fall back to
// sending the raw string.

const MARKER     = '_z'
const KIND       = 'gzip'
// Only compress payloads larger than this — below it the round-trip overhead
// outweighs the wire-size saving.
const MIN_BYTES  = 64 * 1024

export function isCompressionSupported() {
  return typeof CompressionStream !== 'undefined'
}

export function isDecompressionSupported() {
  return typeof DecompressionStream !== 'undefined'
}

// Inverse of encodeForUpload, for the download path: unwrap a stored envelope
// ({"_z":"gzip","data":"<base64>"}) back into the plain JSON string. Legacy
// values (plain JSON, or a server that already decoded) pass through untouched.
// Lets get_sheet ship the ~1.5MB compressed payload instead of the ~20MB
// decoded one and decompress here — gunzip runs on a stream, off the critical
// parse path.
export async function decodeFromDownload(stored) {
  if (!stored || typeof stored !== 'string') return stored
  // Envelopes are tiny and always start with the marker key; the workbook JSON
  // starts with `{"sheet"`/`{"v"`, so this cheap check avoids parsing a 20MB
  // legacy string just to discover it isn't an envelope.
  if (!stored.startsWith('{"_z"')) return stored
  let env
  try { env = JSON.parse(stored) } catch { return stored }
  if (!env || env[MARKER] !== KIND || typeof env.data !== 'string') return stored
  return _gunzip(env.data)
}

async function _gunzip(base64) {
  const bytes  = _base64ToBytes(base64)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function _base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encodeForUpload(jsonString) {
  if (!jsonString || jsonString.length < MIN_BYTES) return jsonString
  if (!isCompressionSupported())                    return jsonString
  const gz       = await _gzip(jsonString)
  const data     = _bytesToBase64(gz)
  return JSON.stringify({ [MARKER]: KIND, data })
}

async function _gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const buf    = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

// Chunked to avoid "Maximum call stack size exceeded" on multi-MB inputs.
function _bytesToBase64(bytes) {
  const CHUNK = 0x8000
  let binary  = ''
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}
