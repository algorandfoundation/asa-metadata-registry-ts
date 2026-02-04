import { MAX_UINT8 } from './numbers'

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Convert common byte-like inputs to a Uint8Array.
 * Accepts Uint8Array, ArrayBuffer, Buffer (Node), other typed array views, or an array of byte ints.
 * @throws {TypeError} when the value cannot be interpreted as bytes.
 */
export const toBytes = (v: unknown, name: string): Uint8Array => {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)

  const B = (globalThis as unknown as { Buffer?: { isBuffer: (v: unknown) => boolean } }).Buffer
  if (B?.isBuffer?.(v)) return new Uint8Array(v as ArrayLike<number>)

  if (v && typeof v === 'object') {
    const view = v as { buffer?: ArrayBuffer; byteOffset?: number; byteLength?: number; length?: number }

    // TypedArray / DataView / buffer-like object
    if (view.buffer instanceof ArrayBuffer) {
      return new Uint8Array(view.buffer, view.byteOffset ?? 0, view.byteLength ?? view.length)
    }

    if (Array.isArray(v)) {
      const view = v as number[]
      const out = new Uint8Array(view.length)
      for (let i = 0; i < view.length; i++) {
        const n = view[i]
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_UINT8) {
          throw new TypeError(`${name} must be bytes or a sequence of ints`)
        }
        out[i] = n
      }
      return out
    }
  }

  throw new TypeError(`${name} must be bytes or a sequence of ints`)
}

export const readUint64BE = (data: Uint8Array, offset: number): bigint => {
  if (offset < 0 || offset + 8 > data.length) throw new RangeError('uint64 out of range')
  const view = new DataView(data.buffer, data.byteOffset + offset, 8)
  return view.getBigUint64(0, false)
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
