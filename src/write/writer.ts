/**
 * ARC-89 write helpers.
 *
 * Ported from Python `asa_metadata_registry/write/writer.py`.
 *
 * Notes:
 * - The Python SDK is synchronous; this TypeScript port is async.
 * - The generated AppClient is *not* re-implemented here; it is used as-is.
 */

import { microAlgo } from '@algorandfoundation/algokit-utils'
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import type { SendParams } from '@algorandfoundation/algokit-utils/types/transaction'
import * as flagConsts from '../flags'
import {
  AsaNotFoundError,
  InvalidFlagIndexError,
  InvalidSliceError,
  MetadataNotFoundError,
  MissingAppClientError,
} from '../errors'
import { AssetMetadata, MbrDelta, RegistryParameters } from '../models'
import { asBigInt, toNumber } from '../internal/numbers'
import { concatBytes, toBytes } from '../internal/bytes'
import { isNotFoundError } from '../internal/http'
import {
  AsaMetadataRegistryClient,
  AsaMetadataRegistryComposer,
  AsaMetadataRegistryComposerResults,
} from '../generated'
import { AsaMetadataRegistryAvmRead, SimulateOptions } from '../read/avm'
import { parseMbrDelta, returnValues } from '../internal/avm'
import {
  ARC3_PROPERTIES_FLAG_TO_KEY,
  decodeMetadataJson,
  validateArc3Properties,
  validateArc3Schema,
  validateArc3Values,
} from '../validation'
import {
  ARC89_CREATE_METADATA_FIXED_SIZE,
  ARC89_EXTRA_PAYLOAD_FIXED_SIZE,
  ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE,
  appArgsSurchargeFee,
  appendExtraPayload,
  appendExtraResources,
  boxIoExtraResources,
  chunksForSlice,
  hashBudgetTxns,
  parseMetadataBox,
  tailBudgetTxns,
} from '../internal/writer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Controls how ARC-89 write groups are built and sent.
 *
 * Notes:
 * - Algorand supports *fee pooling* in groups; this SDK sets fee=0 on most txns
 *   and pools fees on the first app call via `staticFee`.
 * - The fee pool covers the group transactions, the opcode budget and MBR inner transactions,
 *   the `extraResources` calls needed for the Box I/O budget and the app args surcharge.
 * - `feePaddingTxns` adds extra min-fee units to the fee pool as a safety margin.
 */
export interface WriteOptions {
  extraResources: number
  feePaddingTxns: number
  coverAppCallInnerTransactionFees: boolean
  populateAppCallResources: boolean
}

export const writeOptionsDefault: WriteOptions = {
  extraResources: 0,
  feePaddingTxns: 0,
  coverAppCallInnerTransactionFees: true, // composer.send() options
  populateAppCallResources: true, // composer.send() options
}

/*
 * Helper to build default send params from WriteOptions.
 */
const createSendParams = (options: WriteOptions): SendParams => ({
  coverAppCallInnerTransactionFees: options.coverAppCallInnerTransactionFees,
  populateAppCallResources: options.populateAppCallResources,
})

/** Raise AsaNotFoundError if the ASA does not exist on-chain. */
const getAsaParams = async (client: AsaMetadataRegistryClient, assetId: bigint | number) => {
  try {
    return await client.algorand.asset.getById(BigInt(assetId))
  } catch (ex: unknown) {
    if (isNotFoundError(ex)) {
      throw new AsaNotFoundError(`Asset ${assetId} does not exist.`, { cause: ex })
    }
    throw ex
  }
}

const validateArc3Decimals = async (client: AsaMetadataRegistryClient, metadata: AssetMetadata): Promise<void> => {
  const bodyJson = metadata.body.json
  if ('decimals' in bodyJson) {
    const asaParams = await getAsaParams(client, metadata.assetId)
    validateArc3Values(bodyJson, asaParams.decimals)
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write API for ARC-89.
 *
 * This wraps the AlgoKit-generated ARC-56 AppClient to:
 *   - split metadata into payload chunks
 *   - build atomic groups (create/replace/delete + extra payload)
 *   - size the Box I/O and opcode budget resources and pool the fees
 */
export class AsaMetadataRegistryWrite {
  public readonly client: AsaMetadataRegistryClient
  public readonly params: RegistryParameters | null

  private paramsCache: RegistryParameters | null = null

  constructor(args: { client: AsaMetadataRegistryClient; params?: RegistryParameters | null }) {
    if (!args.client) throw new MissingAppClientError('Write module requires a generated AsaMetadataRegistryClient')
    this.client = args.client
    this.params = args.params ?? null
  }

  private async _params(): Promise<RegistryParameters> {
    if (this.params) return this.params
    if (this.paramsCache) return this.paramsCache
    // Prefer on-chain registry parameters (simulate); cached for the life of the writer.
    const p = await new AsaMetadataRegistryAvmRead({ client: this.client }).arc89GetMetadataRegistryParameters()
    this.paramsCache = p
    return p
  }

  private async minFee(): Promise<number> {
    const sp = await this.client.algorand.getSuggestedParams()
    return toNumber(sp.minFee)
  }

  private newGroup(): AsaMetadataRegistryComposer<unknown[]> {
    return this.client.newGroup() as unknown as AsaMetadataRegistryComposer<unknown[]>
  }

  /** `[extraResources calls, budget inner txns]` to touch the current box of `assetId`. */
  private async boxResources(
    assetId: bigint | number,
    args: { hashing: boolean; otherCalls?: number },
  ): Promise<readonly [number, number]> {
    const box = await parseMetadataBox(this.client, assetId)
    if (box === null) return [0, 0]
    const params = await this._params()
    const extra = boxIoExtraResources(params.headerSize + box.body.size)
    let budget = 0
    if (args.hashing) {
      budget = hashBudgetTxns(box.body.totalPages(params))
      budget += tailBudgetTxns(extra + (args.otherCalls ?? 0))
    }
    return [extra, budget]
  }

  private async mbrDeltaPayment(args: { assetManager: TransactionSignerAccount; metadata: AssetMetadata }) {
    // Determine MBR delta via on-chain getter (simulate).
    const mbrDelta = await new AsaMetadataRegistryAvmRead({ client: this.client }).arc89GetMetadataMbrDelta({
      assetId: args.metadata.assetId,
      newSize: args.metadata.body.size,
    })
    const payAmount = mbrDelta.isPositive ? BigInt(mbrDelta.amount) : 0n
    // Build payment txn for MBR delta (fee pooled).
    return await this.client.algorand.createTransaction.payment({
      sender: args.assetManager.addr,
      receiver: this.client.appAddress,
      amount: microAlgo(asBigInt(payAmount, 'amountMicroAlgos')),
      staticFee: microAlgo(0),
    })
  }

  // ------------------------------------------------------------------
  // Group builders
  // ------------------------------------------------------------------

  /**
   * Build (but do not send) an ARC-89 create metadata group.
   *
   * @returns The generated client's composer, so callers can `.simulate()` or `.send()`.
   */
  async buildCreateMetadataGroup(args: {
    assetManager: TransactionSignerAccount
    metadata: AssetMetadata
    options?: WriteOptions
  }): Promise<AsaMetadataRegistryComposer> {
    const opt = args.options ?? writeOptionsDefault
    const { metadata } = args
    const params = await this._params()

    const chunks = metadata.body.chunkedPayload(params)
    const ioExtra = boxIoExtraResources(params.headerSize + metadata.body.size, chunks.length - 1)

    const mbrPayment = await this.mbrDeltaPayment({ assetManager: args.assetManager, metadata })

    const minFee = await this.minFee()
    const nonEmpty = metadata.isEmpty ? 0 : 1
    // Calculate transaction count for fee pooling
    let baseTxnCount =
      1 + // main app call (arc89CreateMetadata)
      (chunks.length - 1) + // extra payload calls
      1 + // MBR payment transaction
      ioExtra +
      opt.extraResources // optional extra resources

    // Opcode budget inner transactions: metadata hashing, native Asset URL check, tail
    baseTxnCount += nonEmpty + (metadata.isArc89Native ? 1 : 0)
    baseTxnCount += tailBudgetTxns(chunks.length - 1 + ioExtra + opt.extraResources + nonEmpty)

    // Calculate total fee pool including padding
    const appArgsSizes = [
      ARC89_CREATE_METADATA_FIXED_SIZE + chunks[0]!.length,
      ...chunks.slice(1).map((chunk) => ARC89_EXTRA_PAYLOAD_FIXED_SIZE + chunk.length),
    ]
    const feePool = (baseTxnCount + opt.feePaddingTxns) * minFee + appArgsSurchargeFee(minFee, appArgsSizes)

    const composer = this.newGroup()
    composer.arc89CreateMetadata({
      args: {
        assetId: metadata.assetId,
        reversibleFlags: metadata.flags.reversibleByte,
        irreversibleFlags: metadata.flags.irreversibleByte,
        metadataSize: metadata.body.size,
        payload: chunks[0]!,
        mbrDeltaPayment: mbrPayment,
      },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })

    appendExtraPayload(composer, {
      assetId: metadata.assetId,
      chunks,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })

    appendExtraResources(composer, {
      count: ioExtra + opt.extraResources + nonEmpty,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })
    return composer as unknown as AsaMetadataRegistryComposer
  }

  /**
   * Build a replace group, automatically choosing `replaceMetadata` or `replaceMetadataLarger`.
   *
   * If you already know the current on-chain metadata size, pass `assumeCurrentSize` to avoid
   * an extra simulate read.
   *
   * @returns The generated client's composer, so callers can `.simulate()` or `.send()`.
   */
  async buildReplaceMetadataGroup(args: {
    assetManager: TransactionSignerAccount
    metadata: AssetMetadata
    options?: WriteOptions
    assumeCurrentSize?: number | null
  }): Promise<AsaMetadataRegistryComposer> {
    const opt = args.options ?? writeOptionsDefault
    const avm = new AsaMetadataRegistryAvmRead({ client: this.client })

    let currentSize = args.assumeCurrentSize ?? null
    if (currentSize === null || currentSize === undefined) {
      const pagination = await avm.arc89GetMetadataPagination({ assetId: args.metadata.assetId })
      currentSize = pagination.metadataSize
    }

    if (args.metadata.body.size <= currentSize) {
      return await this.buildReplaceSmallerOrEqual({
        assetManager: args.assetManager,
        metadata: args.metadata,
        options: opt,
        currentSize,
      })
    }

    return await this.buildReplaceLarger({ assetManager: args.assetManager, metadata: args.metadata, options: opt })
  }

  private async buildReplaceSmallerOrEqual(args: {
    assetManager: TransactionSignerAccount
    metadata: AssetMetadata
    options: WriteOptions
    currentSize: number
  }): Promise<AsaMetadataRegistryComposer> {
    const { metadata, options } = args
    const params = await this._params()
    const chunks = metadata.body.chunkedPayload(params)
    const equalSize = metadata.body.size === args.currentSize
    // The whole existing box is touched (resize), size the I/O budget on it.
    const ioExtra = boxIoExtraResources(params.headerSize + args.currentSize, chunks.length - 1)

    const minFee = await this.minFee()
    const nonEmpty = metadata.isEmpty ? 0 : 1
    let baseTxnCount =
      1 + // main app call (arc89ReplaceMetadata)
      (chunks.length - 1) + // extra payload calls
      ioExtra +
      options.extraResources + // optional extra resources
      nonEmpty + // extraResources call
      nonEmpty + // hash-budget inner transaction
      tailBudgetTxns(chunks.length - 1 + ioExtra + options.extraResources + nonEmpty)

    // MBR refund inner payment transaction (only when size is smaller, not equal)
    if (!equalSize) baseTxnCount += 1

    // Calculate total fee pool including padding
    const appArgsSizes = [
      ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE + chunks[0]!.length,
      ...chunks.slice(1).map((chunk) => ARC89_EXTRA_PAYLOAD_FIXED_SIZE + chunk.length),
    ]
    const feePool = (baseTxnCount + options.feePaddingTxns) * minFee + appArgsSurchargeFee(minFee, appArgsSizes)

    const composer = this.newGroup()
    composer.arc89ReplaceMetadata({
      args: {
        assetId: metadata.assetId,
        metadataSize: metadata.body.size,
        payload: chunks[0]!,
      },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })

    appendExtraPayload(composer, {
      assetId: metadata.assetId,
      chunks,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })

    appendExtraResources(composer, {
      count: ioExtra + options.extraResources + nonEmpty,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })
    return composer as unknown as AsaMetadataRegistryComposer
  }

  private async buildReplaceLarger(args: {
    assetManager: TransactionSignerAccount
    metadata: AssetMetadata
    options: WriteOptions
  }): Promise<AsaMetadataRegistryComposer> {
    const { metadata, options } = args
    const params = await this._params()
    const chunks = metadata.body.chunkedPayload(params)
    const ioExtra = boxIoExtraResources(params.headerSize + metadata.body.size, chunks.length - 1)

    const mbrPayment = await this.mbrDeltaPayment({ assetManager: args.assetManager, metadata })

    const minFee = await this.minFee()
    const nonEmpty = metadata.isEmpty ? 0 : 1
    const txnCount =
      1 + // main app call (arc89ReplaceMetadataLarger)
      (chunks.length - 1) + // extra payload calls
      1 + // MBR payment transaction
      ioExtra +
      options.extraResources + // optional extra resources
      nonEmpty + // extraResources call
      nonEmpty + // hash-budget inner transaction
      tailBudgetTxns(chunks.length - 1 + ioExtra + options.extraResources + nonEmpty)

    // Calculate total fee pool including padding
    const appArgsSizes = [
      ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE + chunks[0]!.length,
      ...chunks.slice(1).map((chunk) => ARC89_EXTRA_PAYLOAD_FIXED_SIZE + chunk.length),
    ]
    const feePool = (txnCount + options.feePaddingTxns) * minFee + appArgsSurchargeFee(minFee, appArgsSizes)

    const composer = this.newGroup()
    composer.arc89ReplaceMetadataLarger({
      args: {
        assetId: metadata.assetId,
        metadataSize: metadata.body.size,
        payload: chunks[0]!,
        mbrDeltaPayment: mbrPayment,
      },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })

    appendExtraPayload(composer, {
      assetId: metadata.assetId,
      chunks,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })

    appendExtraResources(composer, {
      count: ioExtra + options.extraResources + nonEmpty,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })
    return composer as unknown as AsaMetadataRegistryComposer
  }

  /**
   * Build a group that replaces a slice of the on-chain metadata.
   *
   * If `payload` exceeds the registry's replace payload limit, this builds multiple
   * `arc89ReplaceMetadataSlice` calls in one group, adjusting the offset for each chunk.
   *
   * @returns The generated client's composer, so callers can `.simulate()` or `.send()`.
   */
  async buildReplaceMetadataSliceGroup(args: {
    assetManager: TransactionSignerAccount
    assetId: bigint | number
    offset: number
    payload: Uint8Array | ArrayBuffer | number[]
    options?: WriteOptions
  }): Promise<AsaMetadataRegistryComposer> {
    const opt = args.options ?? writeOptionsDefault
    const params = await this._params()
    const payloadBytes = toBytes(args.payload, 'payload')

    const chunks = chunksForSlice(payloadBytes, params.replacePayloadMaxSize)
    const [boxIoExtra, budget] = await this.boxResources(args.assetId, {
      hashing: true,
      otherCalls: chunks.length - 1 + opt.extraResources,
    })
    const ioExtra = Math.max(0, boxIoExtra - (chunks.length - 1))

    const minFee = await this.minFee()
    const txnCount =
      chunks.length + // main app calls (arc89ReplaceMetadataSlice)
      budget * chunks.length + // hash recomputed by every slice call
      ioExtra +
      opt.extraResources // optional extra resources

    // Calculate total fee pool including padding
    const appArgsSizes = chunks.map((chunk) => ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE + chunk.length)
    const feePool = (txnCount + opt.feePaddingTxns) * minFee + appArgsSurchargeFee(minFee, appArgsSizes)

    const composer = this.newGroup()

    // First call pays pooled fees.
    composer.arc89ReplaceMetadataSlice({
      args: { assetId: args.assetId, offset: args.offset, payload: chunks[0]! },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })

    // Subsequent calls have 0 fee.
    for (let i = 1; i < chunks.length; i++) {
      composer.arc89ReplaceMetadataSlice({
        args: {
          assetId: args.assetId,
          offset: args.offset + i * params.replacePayloadMaxSize,
          payload: chunks[i]!,
        },
        sender: args.assetManager.addr,
        signer: args.assetManager.signer,
        staticFee: microAlgo(0),
      })
    }

    appendExtraResources(composer, {
      count: ioExtra + opt.extraResources,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })
    return composer as unknown as AsaMetadataRegistryComposer
  }

  /** Build (but do not send) an ARC-89 delete metadata group. */
  async buildDeleteMetadataGroup(args: {
    assetManager: TransactionSignerAccount
    assetId: bigint | number
    options?: WriteOptions
  }): Promise<AsaMetadataRegistryComposer> {
    const opt = args.options ?? writeOptionsDefault
    const [ioExtra] = await this.boxResources(args.assetId, { hashing: false })

    const minFee = await this.minFee()
    const txnCount =
      1 + // main app call (arc89DeleteMetadata)
      1 + // MBR refund inner payment transaction
      ioExtra +
      opt.extraResources // optional extra resources

    // Calculate total fee pool including padding
    const feePool = (txnCount + opt.feePaddingTxns) * minFee

    const composer = this.newGroup()
    composer.arc89DeleteMetadata({
      args: { assetId: args.assetId },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })
    appendExtraResources(composer, {
      count: ioExtra + opt.extraResources,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })
    return composer as unknown as AsaMetadataRegistryComposer
  }

  // ------------------------------------------------------------------
  // High-level send helpers
  // ------------------------------------------------------------------

  /**
   * Send or simulate a transaction group.
   * If `simulate` is provided, simulate instead of sending.
   */
  static async sendGroup(args: {
    composer: AsaMetadataRegistryComposer<unknown[]>
    sendParams?: SendParams | null
    options?: WriteOptions | null
    simulate?: SimulateOptions | null
  }): Promise<AsaMetadataRegistryComposerResults<unknown[]>> {
    if (args.simulate) {
      return await args.composer.simulate(args.simulate)
    }

    const sendParams = args.sendParams ?? createSendParams(args.options ?? writeOptionsDefault)
    return await args.composer.send(sendParams)
  }

  async createMetadata(args: {
    assetManager: TransactionSignerAccount
    metadata: AssetMetadata
    options?: WriteOptions
    sendParams?: SendParams | null
    validateArc3?: boolean
  }): Promise<MbrDelta> {
    if (args.validateArc3 ?? true) {
      await validateArc3Decimals(this.client, args.metadata)
    }

    const composer = await this.buildCreateMetadataGroup({
      assetManager: args.assetManager,
      metadata: args.metadata,
      options: args.options,
    })
    const result = await AsaMetadataRegistryWrite.sendGroup({
      composer: composer as unknown as AsaMetadataRegistryComposer<unknown[]>,
      sendParams: args.sendParams,
      options: args.options,
    })

    const [ret] = returnValues(result)
    return parseMbrDelta(ret)
  }

  async replaceMetadata(args: {
    assetManager: TransactionSignerAccount
    metadata: AssetMetadata
    options?: WriteOptions
    sendParams?: SendParams | null
    assumeCurrentSize?: number | null
    validateArc3?: boolean
  }): Promise<MbrDelta> {
    if (args.validateArc3 ?? true) {
      await validateArc3Decimals(this.client, args.metadata)
    }

    const composer = await this.buildReplaceMetadataGroup({
      assetManager: args.assetManager,
      metadata: args.metadata,
      options: args.options,
      assumeCurrentSize: args.assumeCurrentSize,
    })
    const result = await AsaMetadataRegistryWrite.sendGroup({
      composer: composer as unknown as AsaMetadataRegistryComposer<unknown[]>,
      sendParams: args.sendParams,
      options: args.options,
    })
    const [ret] = returnValues(result)
    return parseMbrDelta(ret)
  }

  /**
   * Replace a slice of the on-chain metadata.
   *
   * With `validate` (default), the complete post-replacement Metadata is validated client side,
   * as ARC-89 requires: it must decode to a JSON object (and match the ARC-3 schema if flagged).
   *
   * @throws {MetadataNotFoundError} If the Asset has no metadata (with `validate`).
   * @throws {InvalidSliceError} If the slice exceeds the Metadata size (with `validate`).
   */
  async replaceMetadataSlice(args: {
    assetManager: TransactionSignerAccount
    assetId: bigint | number
    offset: number
    payload: Uint8Array | ArrayBuffer | number[]
    options?: WriteOptions
    sendParams?: SendParams | null
    validate?: boolean
  }): Promise<void> {
    if (args.validate ?? true) {
      // ARC-89: clients MUST validate the complete post-replacement Metadata.
      const box = await parseMetadataBox(this.client, args.assetId)
      if (box === null) throw new MetadataNotFoundError(`No metadata box for asset ${args.assetId}`)
      const payload = toBytes(args.payload, 'payload')
      const body = box.body.rawBytes
      if (args.offset < 0 || args.offset + payload.length > body.length) {
        throw new InvalidSliceError('Slice exceeds the Metadata size')
      }
      const newBody = concatBytes([body.slice(0, args.offset), payload, body.slice(args.offset + payload.length)])
      const obj = decodeMetadataJson(newBody)
      if (box.header.flags.irreversible.arc3) validateArc3Schema(obj)
    }

    const composer = await this.buildReplaceMetadataSliceGroup({
      assetManager: args.assetManager,
      assetId: args.assetId,
      offset: args.offset,
      payload: args.payload,
      options: args.options,
    })
    await AsaMetadataRegistryWrite.sendGroup({
      composer: composer as unknown as AsaMetadataRegistryComposer<unknown[]>,
      sendParams: args.sendParams,
      options: args.options,
    })
  }

  async deleteMetadata(args: {
    assetManager: TransactionSignerAccount
    assetId: bigint | number
    options?: WriteOptions
    sendParams?: SendParams | null
  }): Promise<MbrDelta> {
    const composer = await this.buildDeleteMetadataGroup({
      assetManager: args.assetManager,
      assetId: args.assetId,
      options: args.options,
    })
    const result = await AsaMetadataRegistryWrite.sendGroup({
      composer: composer as unknown as AsaMetadataRegistryComposer<unknown[]>,
      sendParams: args.sendParams,
      options: args.options,
    })
    const [ret] = returnValues(result)
    return parseMbrDelta(ret)
  }

  // ------------------------------------------------------------------
  // Flag & migration
  // ------------------------------------------------------------------

  async setReversibleFlag(args: {
    assetManager: TransactionSignerAccount
    assetId: bigint | number
    flagIndex: number
    value: boolean
    options?: WriteOptions
    sendParams?: SendParams | null
  }): Promise<void> {
    if (!(flagConsts.REV_FLG_ARC20 <= args.flagIndex && args.flagIndex <= flagConsts.REV_FLG_RESERVED_7)) {
      throw new InvalidFlagIndexError(`Invalid reversible flag index: ${args.flagIndex}, must be in [0, 7]`)
    }

    if (args.value && args.flagIndex in ARC3_PROPERTIES_FLAG_TO_KEY) {
      const box = await parseMetadataBox(this.client, args.assetId)
      if (box !== null && box.header.flags.irreversible.arc3) {
        validateArc3Properties(box.body.json, ARC3_PROPERTIES_FLAG_TO_KEY[args.flagIndex]!)
      }
    }

    const opt = args.options ?? writeOptionsDefault
    const [ioExtra, budget] = await this.boxResources(args.assetId, {
      hashing: true,
      otherCalls: opt.extraResources,
    })

    const minFee = await this.minFee()
    const feePool = (1 + budget + ioExtra + opt.extraResources + opt.feePaddingTxns) * minFee

    const composer = this.newGroup()
    composer.arc89SetReversibleFlag({
      args: { assetId: args.assetId, flag: args.flagIndex, value: args.value },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })
    appendExtraResources(composer, {
      count: ioExtra + opt.extraResources,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })

    const sendParams = args.sendParams ?? createSendParams(opt)
    await composer.send(sendParams)
  }

  async setIrreversibleFlag(args: {
    assetManager: TransactionSignerAccount
    assetId: bigint | number
    flagIndex: number
    options?: WriteOptions
    sendParams?: SendParams | null
  }): Promise<void> {
    if (!(flagConsts.IRR_FLG_ARC54 <= args.flagIndex && args.flagIndex <= flagConsts.IRR_FLG_RESERVED_6)) {
      throw new InvalidFlagIndexError(
        `Invalid irreversible flag index: ${args.flagIndex}, must be in [2, 6]. Flags 0, 1 are creation only. Flag 7 is reserved to set_immutable.`,
      )
    }
    const opt = args.options ?? writeOptionsDefault
    const [ioExtra, budget] = await this.boxResources(args.assetId, {
      hashing: true,
      otherCalls: opt.extraResources,
    })

    const minFee = await this.minFee()
    const feePool = (1 + budget + ioExtra + opt.extraResources + opt.feePaddingTxns) * minFee

    const composer = this.newGroup()
    composer.arc89SetIrreversibleFlag({
      args: { assetId: args.assetId, flag: args.flagIndex },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })
    appendExtraResources(composer, {
      count: ioExtra + opt.extraResources,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })

    const sendParams = args.sendParams ?? createSendParams(opt)
    await composer.send(sendParams)
  }

  async setImmutable(args: {
    assetManager: TransactionSignerAccount
    assetId: bigint | number
    options?: WriteOptions
    sendParams?: SendParams | null
  }): Promise<void> {
    const opt = args.options ?? writeOptionsDefault
    const [ioExtra, budget] = await this.boxResources(args.assetId, {
      hashing: true,
      otherCalls: opt.extraResources,
    })

    const minFee = await this.minFee()
    const feePool = (1 + budget + ioExtra + opt.extraResources + opt.feePaddingTxns) * minFee

    const composer = this.newGroup()
    composer.arc89SetImmutable({
      args: { assetId: args.assetId },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })
    appendExtraResources(composer, {
      count: ioExtra + opt.extraResources,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })
    const sendParams = args.sendParams ?? createSendParams(opt)
    await composer.send(sendParams)
  }

  async migrateMetadata(args: {
    assetManager: TransactionSignerAccount
    assetId: bigint | number
    newRegistryId: bigint | number
    options?: WriteOptions
    sendParams?: SendParams | null
  }): Promise<void> {
    const opt = args.options ?? writeOptionsDefault
    const [ioExtra, budget] = await this.boxResources(args.assetId, { hashing: false })

    const minFee = await this.minFee()
    const feePool = (1 + budget + ioExtra + opt.extraResources + opt.feePaddingTxns) * minFee

    const composer = this.newGroup()
    composer.arc89MigrateMetadata({
      args: { assetId: args.assetId, newRegistryId: args.newRegistryId },
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
      staticFee: microAlgo(feePool),
    })
    appendExtraResources(composer, {
      count: ioExtra + opt.extraResources,
      sender: args.assetManager.addr,
      signer: args.assetManager.signer,
    })
    const sendParams = args.sendParams ?? createSendParams(opt)
    await composer.send(sendParams)
  }
}
