import { microAlgo } from '@algorandfoundation/algokit-utils'
import type { Address, TransactionSigner } from 'algosdk'

import { uint64ToBytesBE } from './bytes'
import { asUint64BigInt } from './numbers'
import type { AsaMetadataRegistryClient, AsaMetadataRegistryComposer } from '../generated'
import { AssetMetadataBox } from '../models'

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

/** Read and parse the metadata box for `asset_id`, or return None if not found. */
export const parseMetadataBox = async (
  client: AsaMetadataRegistryClient,
  assetId: bigint | number,
): Promise<AssetMetadataBox | null> => {
  const boxValue = await client.state.box.assetMetadata.value(assetId)
  return boxValue !== undefined ? AssetMetadataBox.parse({ assetId, value: boxValue }) : null
}
