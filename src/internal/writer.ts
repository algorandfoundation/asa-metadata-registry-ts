import { microAlgo } from '@algorandfoundation/algokit-utils'
import type { Address, TransactionSigner } from 'algosdk'

import * as consts from '../constants.js'
import { uint64ToBytesBE } from './bytes.js'
import { isNotFoundError } from './http.js'
import { asUint64BigInt } from './numbers.js'
import type { AsaMetadataRegistryClient, AsaMetadataRegistryComposer } from '../generated/index.js'
import { AssetMetadataBox } from '../models.js'

// ---------------------------------------------------------------------------
// App call arguments sizes and fees (consensus v42)
// ---------------------------------------------------------------------------

const APP_ARGS_FREE_SIZE = 2048
const APP_ARG_BYTE_SURCHARGE_FACTOR = 100 // millionths of the min fee
const FEE_FACTOR_SCALE = 1_000_000

export const ARC89_CREATE_METADATA_FIXED_SIZE =
  consts.ARC4_METHOD_SELECTOR_SIZE +
  consts.UINT64_SIZE +
  consts.BYTE_SIZE +
  consts.BYTE_SIZE +
  consts.UINT16_SIZE +
  consts.ARC4_DYNAMIC_LENGTH_SIZE

export const ARC89_EXTRA_PAYLOAD_FIXED_SIZE =
  consts.ARC4_METHOD_SELECTOR_SIZE + consts.UINT64_SIZE + consts.ARC4_DYNAMIC_LENGTH_SIZE

export const ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE =
  consts.ARC4_METHOD_SELECTOR_SIZE + consts.UINT64_SIZE + consts.UINT16_SIZE + consts.ARC4_DYNAMIC_LENGTH_SIZE

/** Return the pooled protocol surcharge for app args above 2,048 bytes. */
export const appArgsSurchargeFee = (minFee: number, appArgsTotalSizes: readonly number[]): number => {
  const excessBytes = appArgsTotalSizes.reduce((sum, size) => sum + Math.max(0, size - APP_ARGS_FREE_SIZE), 0)
  const numerator = minFee * excessBytes * APP_ARG_BYTE_SURCHARGE_FACTOR
  return Math.floor((numerator + FEE_FACTOR_SCALE - 1) / FEE_FACTOR_SCALE)
}

// ---------------------------------------------------------------------------
// Box I/O and opcode budget resources
// ---------------------------------------------------------------------------

const BOX_REFERENCE_BYTES = 2048 // Box I/O budget per box reference (consensus v41)
const BOX_REFERENCES_PER_APP_CALL = 8

/**
 * `extraResources` calls needed to cover the Box I/O budget of a `boxSize` bytes box.
 *
 * The head call spends one reference slot on the asset (seven box references left);
 * every other app call in the group (extra payloads, extra resources) adds eight.
 */
export const boxIoExtraResources = (boxSize: number, otherAppCalls = 0): number => {
  const headCapacity = (BOX_REFERENCES_PER_APP_CALL - 1) * BOX_REFERENCE_BYTES
  const callCapacity = BOX_REFERENCES_PER_APP_CALL * BOX_REFERENCE_BYTES
  const neededCalls = Math.max(0, Math.ceil((boxSize - headCapacity) / callCapacity))
  return Math.max(0, neededCalls - otherAppCalls)
}

/** Opcode budget inner transactions to recompute the Metadata Hash over `totalPages`. */
export const hashBudgetTxns = (totalPages: number): number => {
  // Calibrated on-chain: the first at two pages, then one every five pages.
  return Math.floor((totalPages + 3) / 5)
}

/** Budget inner transactions the head call issues for the calls after it. */
export const tailBudgetTxns = (trailingCalls: number): number => {
  const reserved = trailingCalls * consts.GROUP_TAIL_OP_BUDGET_PER_TXN
  return Math.floor(reserved / consts.APP_CALL_OP_BUDGET) + (trailingCalls > 0 ? 1 : 0)
}

// ---------------------------------------------------------------------------
// Group builders helpers
// ---------------------------------------------------------------------------

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

/** Read and parse the metadata box for `assetId`, or return `null` if not found. */
export const parseMetadataBox = async (
  client: AsaMetadataRegistryClient,
  assetId: bigint | number,
): Promise<AssetMetadataBox | null> => {
  let boxValue: Uint8Array | undefined
  try {
    boxValue = await client.state.box.assetMetadata.value(assetId)
  } catch (e) {
    if (isNotFoundError(e)) return null
    throw e
  }
  return boxValue !== undefined ? AssetMetadataBox.parse({ assetId, value: boxValue }) : null
}
