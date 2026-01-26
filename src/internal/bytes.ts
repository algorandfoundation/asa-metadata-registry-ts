const MAX_UINT8 = 0xff

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const coerceBytes = (v: unknown, name: string): Uint8Array => {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
 
  const B = (globalThis as any).Buffer
  if (B && typeof B.isBuffer === 'function' && B.isBuffer(v)) return new Uint8Array(v as ArrayLike<number>)
 
  // TypedArray / DataView
  if (v && typeof v === 'object' && 'buffer' in (v as any) && (v as any).buffer instanceof ArrayBuffer) {
    const view = v as any
    return new Uint8Array(view.buffer, view.byteOffset ?? 0, view.byteLength ?? view.length)
  }
  if (Array.isArray(v)) {
    // Best-effort: if this isn't a sequence of byte values, we'll error.
    const out = new Uint8Array(v.length)
    for (let i = 0; i < v.length; i++) {
      const n = v[i]
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_UINT8) {
        throw new TypeError(`${name} must be bytes or a sequence of ints`)
      }
      out[i] = n
    }
    return out
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
