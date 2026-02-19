import { microAlgo } from '@algorandfoundation/algokit-utils'
import type { Address, TransactionSigner } from 'algosdk'

import * as flags from '../flags'
import { uint64ToBytesBE } from './bytes'
import { asUint64BigInt } from './numbers'
import { InvalidArc3PropertiesError } from '../errors'
import type { AsaMetadataRegistryComposer } from '../generated'

/** Encode a small u64 note value (used for sequencing). */
export const noteU64 = (n: number): Uint8Array => {
  return uint64ToBytesBE(asUint64BigInt(n, 'note index'))
}

/** Split payload into fixed-size chunks (last chunk may be smaller). */
export const chunksForSlice = (payload: Uint8Array, maxSize: number): Uint8Array[] => {
  if (!Number.isInteger(maxSize) || maxSize <= 0) throw new RangeError('maxSize must be > 0')
  if (payload.length === 0) return [new Uint8Array()]
  const out: Uint8Array[] = []
  for (let i = 0; i < payload.length; i += maxSize) {
    out.push(payload.slice(i, i + maxSize))
  }
  return out
}

/** Append extra payload transactions after the head chunk. */
export const appendExtraPayload = (
  composer: AsaMetadataRegistryComposer<unknown[]>,
  args: { assetId: bigint | number; chunks: Uint8Array[]; sender: string | Address; signer: TransactionSigner },
) => {
  for (let i = 0; i < args.chunks.length - 1; i++) {
    const chunk = args.chunks[i + 1]
    composer.arc89ExtraPayload({
      args: { assetId: args.assetId, payload: chunk },
      sender: args.sender,
      signer: args.signer,
      note: noteU64(i),
      staticFee: microAlgo(0),
    })
  }
}

/** Append extra resources transactions. */
export const appendExtraResources = (
  composer: AsaMetadataRegistryComposer<unknown[]>,
  args: { count: number; sender: string | Address; signer: TransactionSigner },
) => {
  if (!Number.isInteger(args.count) || args.count <= 0) return
  for (let i = 0; i < args.count; i++) {
    composer.extraResources({
      args: [],
      sender: args.sender,
      signer: args.signer,
      note: noteU64(i),
      staticFee: microAlgo(0),
    })
  }
}

// ARC-3 Compliance Helpers

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * ARC-3 metadata `properties` keys for reversible flags.
 */
export type ArcPropertyKey = 'arc-20' | 'arc-62'

/** Map a reversible flag index to the corresponding ARC-3 properties key. */
export const toArcPropertyKey = (flagIndex: number): ArcPropertyKey => {
  if (flagIndex === flags.REV_FLG_ARC20) return 'arc-20'
  if (flagIndex === flags.REV_FLG_ARC62) return 'arc-62'
  throw new Error(`Invalid flag index: ${flagIndex}`)
}

/**
 * Validate a positive uint64 represented as a JSON-parsed number.
 * @remarks Since parsing from JSON, expect a `number` input.
 *
 * @returns `true` if the value is type `number` and fits within the safe
 * integer range (2**53 - 1) and is greater than 0, `false` otherwise
 */
export const isPositiveUint64 = (value: unknown): boolean => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Validate that metadata `body` has a valid `arcKey` entry in properties.
 *
 * Per ARC-20 and ARC-62, the value must be an object with an "application-id" key
 * whose value is a valid app ID (positive uint64).
 */
export const validateArcProperty = (body: Record<string, unknown>, arcKey: ArcPropertyKey): void => {
  const properties = body['properties']
  if (!isPlainObject(properties)) {
    throw new InvalidArc3PropertiesError(`${arcKey.toUpperCase()} metadata must have a valid 'properties' field`)
  }

  const arcValue = properties[arcKey]
  if (!isPlainObject(arcValue)) {
    throw new InvalidArc3PropertiesError(`properties['${arcKey}'] must be an object`)
  }

  if (!isPositiveUint64(arcValue['application-id'])) {
    throw new InvalidArc3PropertiesError(`properties['${arcKey}']['application-id'] must be a positive uint64`)
  }
}
