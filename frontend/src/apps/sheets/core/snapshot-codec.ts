// How the workbook is kept in sheets_data: IronCalc's own bytes
// (workbook.toBytes()) as base64, next to the IronCalc version that wrote
// them. Spec 002 leaves JSON vs bytes open; the choice lives here.

export const ENGINE_VERSION = '0.8.4'

// String.fromCharCode takes its bytes as arguments; chunk so a large
// workbook does not overflow the argument limit.
const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
