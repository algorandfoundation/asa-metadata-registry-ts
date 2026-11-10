import { MAX_UINT8 } from './numbers.js'

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// `instanceof ArrayBuffer` is false for an ArrayBuffer from another realm (iframe, node:vm, jsdom)
const isArrayBuffer = (v: unknown): v is ArrayBuffer =>
  v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]'

/**
 * Convert common byte-like inputs to a Uint8Array.
 * Accepts Uint8Array, ArrayBuffer, Buffer (Node), other typed array views, or an array of byte ints,
 * including typed arrays and ArrayBuffers from another realm (iframe, node:vm, jsdom).
 * A typed array other than Uint8Array gives its underlying memory bytes, not its element values.
 * @throws {TypeError} when the value cannot be interpreted as bytes.
 */
export const toBytes = (v: unknown, name: string): Uint8Array => {
  if (v instanceof Uint8Array) return v
  // Typed arrays (including Buffer) and DataView, from any realm
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  if (isArrayBuffer(v)) return new Uint8Array(v)

  if (Array.isArray(v)) {
    const out = new Uint8Array(v.length)
    for (let i = 0; i < v.length; i++) {
      const n: unknown = v[i]
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_UINT8) {
        throw new TypeError(`${name} must be bytes or a sequence of ints`)
      }
      out[i] = n
    }
    return out
  }

  throw new TypeError(`${name} must be bytes or a sequence of ints`)
}

export const uint64ToBytesBE = (n: bigint): Uint8Array => {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setBigUint64(0, n, false)
  return new Uint8Array(buf)
}

export const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}
