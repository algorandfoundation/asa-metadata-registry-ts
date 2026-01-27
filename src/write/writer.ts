/**
 * ARC-89 write helpers.
 *
 * Ported from Python `asa_metadata_registry/write/writer.py`.
 *
 * This module wraps the AlgoKit-generated ARC-56 AppClient to:
 * - split metadata into payload chunks
 * - build atomic groups (create/replace/delete + extra payload)
 * - optionally simulate before sending
 *
 * Notes:
 * - The Python SDK is synchronous; this TypeScript port is async.
 * - The generated AppClient is *not* re-implemented here; it is used as-is.
 */

import { microAlgo } from '@algorandfoundation/algokit-utils'
import { TransactionSigner } from 'algosdk'
import * as flagConsts from '../flags'
import { InvalidFlagIndexError, MissingAppClientError } from '../errors'
import {
  AssetMetadata,
  MbrDelta,
  RegistryParameters,
  getDefaultRegistryParams,
} from '../models'
import { asBigInt, toNumber } from '../internal/numbers'
import { toBytes } from '../internal/bytes'
import { AsaMetadataRegistryClient, AsaMetadataRegistryComposer } from '../generated'
import { AsaMetadataRegistryAvmRead, SimulateOptions } from '../read/avm'
import { parseMbrDelta, returnValues } from '../read/utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal shape we need to sign groups.
 *
 * (AlgoKit also has a `SigningAccount` concept in some versions; we keep this
 * local to avoid hard coupling to a particular helper type.)
 */
export type SigningAccount = {
  address: string
  signer: TransactionSigner
}

/**
 * Controls how ARC-89 write groups are built and sent.
 *
 * Notes:
 * - Algorand supports *fee pooling* in groups; this SDK sets fee=0 on most txns
 *   and pools fees on the first app call via `staticFee`.
 * - `feePaddingTxns` adds extra min-fee units to the fee pool as a safety margin
 *   to cover opcode budget inner transaction (related to metadata total pages).
 */
export interface WriteOptions {
  extraResources: number
  feePaddingTxns: number
  coverAppCallInnerTransactionFees: boolean
}

const writeOptionsDefault: WriteOptions = {extraResources: 0, feePaddingTxns: 0, coverAppCallInnerTransactionFees: true}

// ---------------------------------------------------------------------------
// Internal helpers (runtime-tolerant duck typing)
// ---------------------------------------------------------------------------

const noteU64 = (n: number): Uint8Array => {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('note index must be a non-negative integer')
  const out = new Uint8Array(8)
  const view = new DataView(out.buffer)
  // Big-endian uint64
  view.setBigUint64(0, BigInt(n), false)
  return out
}

const chunksForSlice = (payload: Uint8Array, maxSize: number): Uint8Array[] => {
  if (!Number.isInteger(maxSize) || maxSize <= 0) throw new RangeError('max_size must be > 0')
  if (payload.length === 0) return [new Uint8Array()]
  const out: Uint8Array[] = []
  for (let i = 0; i < payload.length; i += maxSize) {
    out.push(payload.slice(i, i + maxSize))
  }
  return out
}

const appendExtraPayload = (composer: any, args: { assetId: bigint | number; chunks: Uint8Array[]; sender: string; signer: TransactionSigner }) => {
  for (let i = 0; i < args.chunks.length - 1; i++) {
    const chunk = args.chunks[i + 1]
    composer.arc89ExtraPayload({
      args: { assetId: args.assetId, payload: chunk },
      sender: args.sender,
      signer: args.signer,
      note: noteU64(i),
      staticFee: 0,
    })
  }
}

const appendExtraResources = (composer: any, args: { count: number; sender: string; signer: TransactionSigner }) => {
  if (!Number.isInteger(args.count) || args.count <= 0) return
  for (let i = 0; i < args.count; i++) {
    composer.extraResources({
      sender: args.sender,
      signer: args.signer,
      note: noteU64(i),
      staticFee: 0,
    })
  }
}

const defaultSendParams = (coverAppCallInnerTransactionFees: boolean) => ({
  coverAppCallInnerTransactionFees,
})

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/*
 * Write API for ARC-89.
 *
 * This wraps the generated AlgoKit AppClient to:
 *   - split metadata into payload chunks
 *   - build atomic groups (create/replace/delete + extra payload)
 *   - optionally simulate before sending
 */
export class AsaMetadataRegistryWrite {
  public readonly client: AsaMetadataRegistryClient
  public readonly params: RegistryParameters | null

  constructor(args: { client: AsaMetadataRegistryClient; params?: RegistryParameters | null }) {
    if (!args.client) throw new MissingAppClientError('Write module requires a generated AsaMetadataRegistryClient')
    this.client = args.client
    this.params = args.params ?? null
  }

  private async _params(): Promise<RegistryParameters> {
    if (this.params) return this.params
    // Prefer on-chain registry parameters (simulate).
    try {
      return await new AsaMetadataRegistryAvmRead({ client: this.client }).arc89GetMetadataRegistryParameters()
    } catch {
      return getDefaultRegistryParams()
    }
  }

  // ------------------------------------------------------------------
  // Group builders
  // ------------------------------------------------------------------

  /** Build (but do not send) an ARC-89 create metadata group. 
   * @returns The generated client's composer, so callers can `.simulate()` or `.send()`. 
  */
  async build_create_metadata_group(args: {
    asset_manager: SigningAccount
    metadata: AssetMetadata
    options?: WriteOptions
  }): Promise<AsaMetadataRegistryComposer> {
    const opt = args.options ?? writeOptionsDefault
    const chunks = args.metadata.body.chunkedPayload()

    const avm = new AsaMetadataRegistryAvmRead({ client: this.client })
    const mbrDelta = await avm.arc89GetMetadataMbrDelta({
      assetId: args.metadata.assetId,
      newSize: args.metadata.body.size,
    })
    const payAmount = mbrDelta.isPositive ? BigInt(mbrDelta.amount) : 0n
    const mbrPayment = await this.client.algorand.createTransaction.payment({
      sender: args.asset_manager.address,
      receiver: this.client.appAddress,
      amount: microAlgo(asBigInt(payAmount, 'amount_micro_algos')),
      staticFee: microAlgo(0n),
    })

    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)

    // Fee pooling
    let baseTxnCount = 1 + (chunks.length - 1) + 1 + opt.extraResources
    if (!args.metadata.isEmpty) baseTxnCount += 1
    const feePool = (baseTxnCount + opt.feePaddingTxns) * minFee

    const composer = this.client.newGroup()
    composer.arc89CreateMetadata({
      args: {
        assetId: args.metadata.assetId,
        reversibleFlags: args.metadata.flags.reversibleByte,
        irreversibleFlags: args.metadata.flags.irreversibleByte,
        metadataSize: args.metadata.body.size,
        payload: chunks[0] ?? new Uint8Array(),
        mbrDeltaPayment: mbrPayment as any,
      },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })

    appendExtraPayload(composer as any, {
      assetId: args.metadata.assetId,
      chunks,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    appendExtraResources(composer as any, {
      count: opt.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    return composer
  }

  /** Build a replace group, automatically choosing `replace_metadata` or `replace_metadata_larger`. */
  async build_replace_metadata_group(args: {
    asset_manager: SigningAccount
    metadata: AssetMetadata
    options?: WriteOptions
    assume_current_size?: number | null
  }): Promise<AsaMetadataRegistryComposer> {
    const opt = args.options ?? writeOptionsDefault
    const avm = new AsaMetadataRegistryAvmRead({ client: this.client })

    let currentSize = args.assume_current_size ?? null
    if (currentSize === null || currentSize === undefined) {
      const pagination = await avm.arc89GetMetadataPagination({ assetId: args.metadata.assetId })
      currentSize = pagination.metadataSize
    }

    if (args.metadata.body.size <= currentSize) {
      return await this._build_replace_smaller_or_equal({
        asset_manager: args.asset_manager,
        metadata: args.metadata,
        options: opt,
        equal_size: args.metadata.body.size === currentSize,
      })
    }

    return await this._build_replace_larger({ asset_manager: args.asset_manager, metadata: args.metadata, options: opt })
  }

  private async _build_replace_smaller_or_equal(args: {
    asset_manager: SigningAccount
    metadata: AssetMetadata
    options: WriteOptions
    equal_size: boolean
  }): Promise<AsaMetadataRegistryComposer> {
    const chunks = args.metadata.body.chunkedPayload()
    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)

    let baseTxnCount = 1 + (chunks.length - 1) + args.options.extraResources
    if (!args.equal_size) baseTxnCount += 1 // MBR refund inner payment
    const feePool = (baseTxnCount + args.options.feePaddingTxns) * minFee

    const composer = this.client.newGroup()
    composer.arc89ReplaceMetadata({
      args: {
        assetId: args.metadata.assetId,
        metadataSize: args.metadata.body.size,
        payload: chunks[0] ?? new Uint8Array(),
      },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })

    appendExtraPayload(composer as any, {
      assetId: args.metadata.assetId,
      chunks,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    appendExtraResources(composer as any, {
      count: args.options.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    return composer
  }

  private async _build_replace_larger(args: {
    asset_manager: SigningAccount
    metadata: AssetMetadata
    options: WriteOptions
  }): Promise<AsaMetadataRegistryComposer> {
    const chunks = args.metadata.body.chunkedPayload()

    const avm = new AsaMetadataRegistryAvmRead({ client: this.client })
    const mbrDelta = await avm.arc89GetMetadataMbrDelta({
      assetId: args.metadata.assetId,
      newSize: args.metadata.body.size,
    })
    const payAmount = mbrDelta.isPositive ? BigInt(mbrDelta.amount) : 0n
    const mbrPayment = await this.client.algorand.createTransaction.payment({
      sender: args.asset_manager.address,
      receiver: this.client.appAddress,
      amount: microAlgo(asBigInt(payAmount, 'amount_micro_algos')),
      staticFee: microAlgo(0n),
    })

    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)
    const txnCount = 1 + (chunks.length - 1) + 1 + args.options.extraResources
    const feePool = (txnCount + args.options.feePaddingTxns) * minFee

    const composer = this.client.newGroup()
    composer.arc89ReplaceMetadataLarger({
      args: {
        assetId: args.metadata.assetId,
        metadataSize: args.metadata.body.size,
        payload: chunks[0] ?? new Uint8Array(),
        mbrDeltaPayment: mbrPayment as any,
      },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })

    appendExtraPayload(composer as any, {
      assetId: args.metadata.assetId,
      chunks,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    appendExtraResources(composer as any, {
      count: args.options.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    return composer
  }

  /** Build a group that replaces a slice of the on-chain metadata. */
  async build_replace_metadata_slice_group(args: {
    asset_manager: SigningAccount
    asset_id: bigint | number
    offset: number
    payload: Uint8Array | ArrayBuffer | number[]
    options?: WriteOptions
  }): Promise<AsaMetadataRegistryComposer> {
    const opt = args.options ?? writeOptionsDefault
    const params = await this._params()
    const payloadBytes = toBytes(args.payload as any, 'payload')

    const chunks = chunksForSlice(payloadBytes, params.replacePayloadMaxSize)

    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)
    const txnCount = chunks.length + opt.extraResources
    const feePool = (txnCount + opt.feePaddingTxns) * minFee

    const composer = this.client.newGroup()

    composer.arc89ReplaceMetadataSlice({
      args: { assetId: args.asset_id, offset: args.offset, payload: chunks[0] ?? new Uint8Array() },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })

    for (let i = 1; i < chunks.length; i++) {
      composer.arc89ReplaceMetadataSlice({
        args: {
          assetId: args.asset_id,
          offset: args.offset + i * params.replacePayloadMaxSize,
          payload: chunks[i],
        },
        sender: args.asset_manager.address,
        signer: args.asset_manager.signer,
        staticFee: new AlgoAmount({ microAlgos: 0 }),
      })
    }

    appendExtraResources(composer as any, {
      count: opt.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    return composer
  }

  /** Build (but do not send) an ARC-89 delete metadata group. */
  async build_delete_metadata_group(args: {
    asset_manager: SigningAccount
    asset_id: bigint | number
    options?: WriteOptions
  }): Promise<AsaMetadataRegistryComposer> {
    const opt = args.options ?? writeOptionsDefault
    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)
    const txnCount = 1 + 1 + opt.extraResources
    const feePool = (txnCount + opt.feePaddingTxns) * minFee

    const composer = this.client.newGroup()
    composer.arc89DeleteMetadata({
      args: { assetId: args.asset_id },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })
    appendExtraResources(composer as any, {
      count: opt.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    return composer
  }

  // ------------------------------------------------------------------
  // High-level send helpers
  // ------------------------------------------------------------------

  private static async _send_group(args: {
    composer: any
    simulate_before_send: boolean
    simulate_options?: SimulateOptions | null
    send_params?: any | null
    options?: WriteOptions | null
  }): Promise<any> {
    if (args.simulate_before_send) {
      const sim = args.simulate_options ?? ({ allowEmptySignatures: true, skipSignatures: true } as SimulateOptions)
      await args.composer.simulate(sim)
    }

    const opt = args.options ?? writeOptionsDefault
    const sendParams = args.send_params ?? defaultSendParams(opt.coverAppCallInnerTransactionFees)
    return await args.composer.send(sendParams)
  }

  async create_metadata(args: {
    asset_manager: SigningAccount
    metadata: AssetMetadata
    options?: WriteOptions
    send_params?: any | null
    simulate_before_send?: boolean
    simulate_options?: SimulateOptions | null
  }): Promise<MbrDelta> {
    const composer = await this.build_create_metadata_group({
      asset_manager: args.asset_manager,
      metadata: args.metadata,
      options: args.options,
    })
    const result = await AsaMetadataRegistryWrite._send_group({
      composer,
      simulate_before_send: Boolean(args.simulate_before_send),
      simulate_options: args.simulate_options,
      send_params: args.send_params,
      options: args.options,
    })

    const [ret] = returnValues(result)
    return parseMbrDelta(ret)
  }

  async replace_metadata(args: {
    asset_manager: SigningAccount
    metadata: AssetMetadata
    options?: WriteOptions
    send_params?: any | null
    simulate_before_send?: boolean
    simulate_options?: SimulateOptions | null
    assume_current_size?: number | null
  }): Promise<MbrDelta> {
    const composer = await this.build_replace_metadata_group({
      asset_manager: args.asset_manager,
      metadata: args.metadata,
      options: args.options,
      assume_current_size: args.assume_current_size,
    })
    const result = await AsaMetadataRegistryWrite._send_group({
      composer,
      simulate_before_send: Boolean(args.simulate_before_send),
      simulate_options: args.simulate_options,
      send_params: args.send_params,
      options: args.options,
    })
    const [ret] = returnValues(result)
    return parseMbrDelta(ret)
  }

  async replace_metadata_slice(args: {
    asset_manager: SigningAccount
    asset_id: bigint | number
    offset: number
    payload: Uint8Array | ArrayBuffer | number[]
    options?: WriteOptions
    send_params?: any | null
    simulate_before_send?: boolean
    simulate_options?: SimulateOptions | null
  }): Promise<void> {
    const composer = await this.build_replace_metadata_slice_group({
      asset_manager: args.asset_manager,
      asset_id: args.asset_id,
      offset: args.offset,
      payload: args.payload,
      options: args.options,
    })
    await AsaMetadataRegistryWrite._send_group({
      composer,
      simulate_before_send: Boolean(args.simulate_before_send),
      simulate_options: args.simulate_options,
      send_params: args.send_params,
      options: args.options,
    })
  }

  async delete_metadata(args: {
    asset_manager: SigningAccount
    asset_id: bigint | number
    options?: WriteOptions
    send_params?: any | null
    simulate_before_send?: boolean
    simulate_options?: SimulateOptions | null
  }): Promise<MbrDelta> {
    const composer = await this.build_delete_metadata_group({
      asset_manager: args.asset_manager,
      asset_id: args.asset_id,
      options: args.options,
    })
    const result = await AsaMetadataRegistryWrite._send_group({
      composer,
      simulate_before_send: Boolean(args.simulate_before_send),
      simulate_options: args.simulate_options,
      send_params: args.send_params,
      options: args.options,
    })
    const [ret] = returnValues(result)
    return parseMbrDelta(ret)
  }

  // ------------------------------------------------------------------
  // Flag & migration
  // ------------------------------------------------------------------

  async set_reversible_flag(args: {
    asset_manager: SigningAccount
    asset_id: bigint | number
    flag_index: number
    value: boolean
    options?: WriteOptions
    send_params?: any | null
  }): Promise<void> {
    if (!(flagConsts.REV_FLG_ARC20 <= args.flag_index && args.flag_index <= flagConsts.REV_FLG_RESERVED_7)) {
      throw new InvalidFlagIndexError(`Invalid reversible flag index: ${args.flag_index}, must be in [0, 7]`)
    }
    const opt = args.options ?? writeOptionsDefault
    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)
    const feePool = (1 + opt.extraResources + opt.feePaddingTxns) * minFee

    const composer = this.client.newGroup()
    composer.arc89SetReversibleFlag({
      args: { assetId: args.asset_id, flag: args.flag_index, value: args.value },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })
    appendExtraResources(composer as any, {
      count: opt.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })

    const sendParams = args.send_params ?? defaultSendParams(opt.coverAppCallInnerTransactionFees)
    await composer.send(sendParams)
  }

  async set_irreversible_flag(args: {
    asset_manager: SigningAccount
    asset_id: bigint | number
    flag_index: number
    options?: WriteOptions
    send_params?: any | null
  }): Promise<void> {
    if (!(flagConsts.IRR_FLG_RESERVED_2 <= args.flag_index && args.flag_index <= flagConsts.IRR_FLG_IMMUTABLE)) {
      throw new InvalidFlagIndexError(
        `Invalid irreversible flag index: ${args.flag_index}, must be in [2, 7]. Flags 0, 1 are creation only.`,
      )
    }
    const opt = args.options ?? writeOptionsDefault
    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)
    const feePool = (1 + opt.extraResources + opt.feePaddingTxns) * minFee

    const composer = this.client.newGroup()
    composer.arc89SetIrreversibleFlag({
      args: { assetId: args.asset_id, flag: args.flag_index },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })
    appendExtraResources(composer as any, {
      count: opt.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })

    const sendParams = args.send_params ?? defaultSendParams(opt.coverAppCallInnerTransactionFees)
    await composer.send(sendParams)
  }

  async set_immutable(args: {
    asset_manager: SigningAccount
    asset_id: bigint | number
    options?: WriteOptions
    send_params?: any | null
  }): Promise<void> {
    const opt = args.options ?? writeOptionsDefault
    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)
    const feePool = (1 + opt.extraResources + opt.feePaddingTxns) * minFee

    const composer = this.client.newGroup()
    composer.arc89SetImmutable({
      args: { assetId: args.asset_id },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })
    appendExtraResources(composer as any, {
      count: opt.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    const sendParams = args.send_params ?? defaultSendParams(opt.coverAppCallInnerTransactionFees)
    await composer.send(sendParams)
  }

  async migrate_metadata(args: {
    asset_manager: SigningAccount
    asset_id: bigint | number
    new_registry_id: bigint | number
    options?: WriteOptions
    send_params?: any | null
  }): Promise<void> {
    const opt = args.options ?? writeOptionsDefault
    const sp = await this.client.algorand.getSuggestedParams()
    const minFee = toNumber(sp.minFee)
    const feePool = (1 + opt.extraResources + opt.feePaddingTxns) * minFee

    const composer = this.client.newGroup()
    composer.arc89MigrateMetadata({
      args: { assetId: args.asset_id, newRegistryId: args.new_registry_id },
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
      staticFee: new AlgoAmount({ microAlgos: feePool }),
    })
    appendExtraResources(composer as any, {
      count: opt.extraResources,
      sender: args.asset_manager.address,
      signer: args.asset_manager.signer,
    })
    const sendParams = args.send_params ?? defaultSendParams(opt.coverAppCallInnerTransactionFees)
    await composer.send(sendParams)
  }
}
