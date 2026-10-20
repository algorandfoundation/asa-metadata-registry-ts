import { toBytes } from './bytes.js'
import { asNumber, asUint64BigInt, asUint8 } from './numbers.js'
import { AbiValue, MbrDelta, MetadataSlice, PaginatedMetadata } from '../models.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const withArgs = (params: unknown | undefined, args: unknown[]): any => {
  const p = params && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : {}
  p.args = args
  return p
}

/**
 * Extract `.returns[*]` values from AlgoKit composer results, tolerating minor shape differences.
 *
 * The generated client's composer already maps ABI returns to their decoded value (structs as
 * objects); raw AlgoKit `ABIReturn` entries are unwrapped to their `returnValue`.
 */
export const returnValues = (results: unknown): unknown[] => {
  if (!results || typeof results !== 'object') return []
  const returns = (results as { returns?: unknown[] }).returns
  if (!Array.isArray(returns)) return []
  return returns.map((r: unknown) => {
    if (r && typeof r === 'object' && 'returnValue' in r && 'rawReturnValue' in r) {
      return (r as { returnValue: unknown }).returnValue
    }
    return r
  })
}

export const parsePaginatedMetadata = (v: unknown): PaginatedMetadata => {
  if (Array.isArray(v)) return PaginatedMetadata.fromTuple(v as readonly AbiValue[])
  if (!v || typeof v !== 'object') throw new TypeError('PaginatedMetadata must be a tuple or struct')
  const o = v as Record<string, unknown>
  return new PaginatedMetadata({
    hasNextPage: Boolean(o.hasNextPage),
    revision: asUint64BigInt(o.revision, 'revision'),
    pageContent: toBytes(o.pageContent, 'pageContent'),
  })
}

export const parseMetadataSlice = (v: unknown): MetadataSlice => {
  if (Array.isArray(v)) return MetadataSlice.fromTuple(v as readonly AbiValue[])
  if (!v || typeof v !== 'object') throw new TypeError('MetadataSlice must be a tuple or struct')
  const o = v as Record<string, unknown>
  return new MetadataSlice({
    revision: asUint64BigInt(o.revision, 'revision'),
    content: toBytes(o.content, 'content'),
  })
}

/** Parse a `HashRevision` struct (or `(byte[32],uint64)` tuple) into `[hash, revision]`. */
export const parseHashRevision = (v: unknown): readonly [hash: Uint8Array, revision: bigint] => {
  if (Array.isArray(v)) {
    if (v.length !== 2) throw new Error('Expected (hash, revision)')
    return [toBytes(v[0], 'hash'), asUint64BigInt(v[1], 'revision')]
  }
  if (!v || typeof v !== 'object') throw new TypeError('HashRevision must be a tuple or struct')
  const o = v as Record<string, unknown>
  return [toBytes(o.hash, 'hash'), asUint64BigInt(o.revision, 'revision')]
}

export const parseMbrDelta = (v: unknown): MbrDelta => {
  if (Array.isArray(v)) return MbrDelta.fromTuple(v as readonly (number | bigint)[])
  if (!v || typeof v !== 'object') throw new TypeError('MbrDelta must be a tuple or struct')
  const o = v as Record<string, unknown>
  return new MbrDelta({ sign: asUint8(o.sign, 'sign'), amount: asNumber(o.amount, 'amount') })
}
