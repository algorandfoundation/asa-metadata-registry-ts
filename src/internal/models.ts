/**
 * Set or clear a bit in a byte value.
 */
export const setBit = (args: { bits: number; mask: number; value: boolean }): number => {
  const { bits, mask, value } = args
  return value ? bits | mask : bits & ~mask & 0xff
}

/**
 * Check if a 32-byte array contains any non-zero bytes.
 */
export const isNonzero32 = (am: Uint8Array): boolean => am.length === 32 && am.some((b) => b !== 0)

/**
 * Split metadata bytes into head + extra payload chunks.
 */
export const chunkMetadataPayload = (args: {
  data: Uint8Array
  headMaxSize: number
  extraMaxSize: number
}): Uint8Array[] => {
  const { data, headMaxSize, extraMaxSize } = args
  if (!Number.isInteger(headMaxSize) || headMaxSize <= 0) throw new RangeError('Chunk sizes must be > 0')
  if (!Number.isInteger(extraMaxSize) || extraMaxSize <= 0) throw new RangeError('Chunk sizes must be > 0')

  if (data.length <= headMaxSize) return [data]

  const chunks: Uint8Array[] = [data.slice(0, headMaxSize)]
  for (let i = headMaxSize; i < data.length; i += extraMaxSize) {
    chunks.push(data.slice(i, i + extraMaxSize))
  }
  return chunks
}

/**
 * Read up to 8 bytes as a big-endian uint64, tolerating short buffers.
 * Mirrors Python's int.from_bytes on truncated slices.
 */
export const readUint64BE = (data: Uint8Array, offset: number): bigint => {
  if (offset >= data.length) return 0n
  const end = Math.min(offset + 8, data.length)
  let result = 0n
  for (let i = offset; i < end; i++) {
    result = (result << 8n) | BigInt(data[i]!)
  }
  return result
}
