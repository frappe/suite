const HEX_RADIX = 16
const HEX_DIGITS_PER_BYTE = 2

export function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) =>
    byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0'),
  ).join('')
}

export function randomHex(byteCount: number) {
  const randomBytes = crypto.getRandomValues(new Uint8Array(byteCount))
  return hex(randomBytes)
}

export function decodeBase64(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) {
    bytes[at] = binary.charCodeAt(at)
  }

  return bytes
}
