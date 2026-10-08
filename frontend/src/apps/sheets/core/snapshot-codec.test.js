import pkg from '@ironcalc/wasm/package.json'
import { describe, expect, it } from 'vitest'

import { base64ToBytes, bytesToBase64, ENGINE_VERSION } from './snapshot-codec.js'

describe('snapshot codec', () => {
  it('round-trips bytes through base64', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('handles a workbook larger than one chunk', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('names the IronCalc version that is installed', () => {
    expect(ENGINE_VERSION).toBe(pkg.version)
  })
})
