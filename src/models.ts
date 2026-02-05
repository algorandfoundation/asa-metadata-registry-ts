/**
 * Core domain models for the ASA Metadata Registry SDK.
 *
 * Ported from Python `asa_metadata_registry/models.py`.
 */

import * as bitmasks from './bitmasks'
import * as enums from './enums'
import * as consts from './constants'
import { BoxParseError, InvalidPageIndexError, MetadataHashMismatchError } from './errors'
import { computeHeaderHash, computeMetadataHash, computePageHash } from './hashing'
import { decodeMetadataJson, encodeMetadataJson, validateArc3Schema } from './validation'
import { asBigInt, asNumber, asUint8, MAX_UINT8 } from './internal/numbers'
import { bytesEqual, toBytes, uint64ToBytesBE } from './internal/bytes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * ABI values returned by Algorand ARC-4 / generated clients.
 *
 * The generated client typically returns `bigint` for uint64 and `Uint8Array` for byte arrays.
 *
 * **Warning**: When passing `number` values representing uint64 (asset IDs, app IDs, rounds),
 * ensure they are within Number.MAX_SAFE_INTEGER (2^53-1). Values outside this range will
 * throw RangeError. Use `bigint` for large values.
 */
export type AbiValue = bigint | number | boolean | Uint8Array | readonly number[] | readonly AbiValue[]

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Set or clear a bit in a byte value.
 * @internal
 */
export const setBit = (args: { bits: number; mask: number; value: boolean }): number => {
  const { bits, mask, value } = args
  return value ? bits | mask : bits & ~mask & 0xff
}

/**
 * Check if a 32-byte array contains any non-zero bytes.
 * @internal
 */
export const isNonzero32 = (am: Uint8Array): boolean => am.length === 32 && am.some((b) => b !== 0)

/**
 * Split metadata bytes into head + extra payload chunks.
 * @internal
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
 * @internal
 */
const readUint64BE = (data: Uint8Array, offset: number): bigint => {
  if (offset >= data.length) return 0n
  const end = Math.min(offset + 8, data.length)
  let result = 0n
  for (let i = offset; i < end; i++) {
    result = (result << 8n) | BigInt(data[i]!)
  }
  return result
}

// ---------------------------------------------------------------------------
// Default registry params cache
// ---------------------------------------------------------------------------

let _DEFAULT_REGISTRY_PARAMS: RegistryParameters | undefined

/** Get a cached singleton of default registry parameters. */
export const getDefaultRegistryParams = (): RegistryParameters => {
  if (_DEFAULT_REGISTRY_PARAMS === undefined) {
    _DEFAULT_REGISTRY_PARAMS = RegistryParameters.defaults()
  }
  return _DEFAULT_REGISTRY_PARAMS
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export enum MbrDeltaSign {
  NULL = enums.MBR_DELTA_NULL,
  POS = enums.MBR_DELTA_POS,
  NEG = enums.MBR_DELTA_NEG,
}

export class MbrDelta {
  public readonly sign: MbrDeltaSign
  /** microALGO */
  public readonly amount: number

  constructor(args: { sign: MbrDeltaSign; amount: number }) {
    this.sign = args.sign
    this.amount = args.amount
  }

  get isPositive(): boolean {
    return this.sign === MbrDeltaSign.POS && this.amount > 0
  }

  get isNegative(): boolean {
    return this.sign === MbrDeltaSign.NEG && this.amount > 0
  }

  get isZero(): boolean {
    return this.sign === MbrDeltaSign.NULL || this.amount === 0
  }

  get signedAmount(): number {
    if (this.isPositive) return this.amount
    if (this.isNegative) return -this.amount
    return 0
  }

  static fromTuple(value: readonly (number | bigint)[]): MbrDelta {
    if (value.length !== 2) throw new Error('Expected (sign, amount)')
    const sign = asNumber(value[0], 'sign')
    const validSigns: number[] = [enums.MBR_DELTA_NULL, enums.MBR_DELTA_POS, enums.MBR_DELTA_NEG]
    if (!validSigns.includes(sign)) {
      throw new Error(`Invalid MBR delta sign: ${sign}`)
    }
    const amount = asNumber(value[1], 'amount')
    if (amount < 0) throw new Error('MBR delta amount must be non-negative')
    return new MbrDelta({ sign: sign as MbrDeltaSign, amount })
  }
}

export class RegistryParameters {
  public readonly keySize: number
  public readonly headerSize: number
  public readonly maxMetadataSize: number
  public readonly shortMetadataSize: number
  public readonly pageSize: number
  public readonly firstPayloadMaxSize: number
  public readonly extraPayloadMaxSize: number
  public readonly replacePayloadMaxSize: number
  public readonly flatMbr: number
  public readonly byteMbr: number

  constructor(args: {
    keySize: number
    headerSize: number
    maxMetadataSize: number
    shortMetadataSize: number
    pageSize: number
    firstPayloadMaxSize: number
    extraPayloadMaxSize: number
    replacePayloadMaxSize: number
    flatMbr: number
    byteMbr: number
  }) {
    this.keySize = args.keySize
    this.headerSize = args.headerSize
    this.maxMetadataSize = args.maxMetadataSize
    this.shortMetadataSize = args.shortMetadataSize
    this.pageSize = args.pageSize
    this.firstPayloadMaxSize = args.firstPayloadMaxSize
    this.extraPayloadMaxSize = args.extraPayloadMaxSize
    this.replacePayloadMaxSize = args.replacePayloadMaxSize
    this.flatMbr = args.flatMbr
    this.byteMbr = args.byteMbr
  }

  static defaults(): RegistryParameters {
    return new RegistryParameters({
      keySize: consts.ASSET_METADATA_BOX_KEY_SIZE,
      headerSize: consts.HEADER_SIZE,
      maxMetadataSize: consts.MAX_METADATA_SIZE,
      shortMetadataSize: consts.SHORT_METADATA_SIZE,
      pageSize: consts.PAGE_SIZE,
      firstPayloadMaxSize: consts.FIRST_PAYLOAD_MAX_SIZE,
      extraPayloadMaxSize: consts.EXTRA_PAYLOAD_MAX_SIZE,
      replacePayloadMaxSize: consts.REPLACE_PAYLOAD_MAX_SIZE,
      flatMbr: consts.FLAT_MBR,
      byteMbr: consts.BYTE_MBR,
    })
  }

  static fromTuple(value: readonly (number | bigint)[]): RegistryParameters {
    if (value.length !== 10) throw new Error('Expected 10-tuple of registry parameters')
    return new RegistryParameters({
      keySize: asNumber(value[0], 'keySize'),
      headerSize: asNumber(value[1], 'headerSize'),
      maxMetadataSize: asNumber(value[2], 'maxMetadataSize'),
      shortMetadataSize: asNumber(value[3], 'shortMetadataSize'),
      pageSize: asNumber(value[4], 'pageSize'),
      firstPayloadMaxSize: asNumber(value[5], 'firstPayloadMaxSize'),
      extraPayloadMaxSize: asNumber(value[6], 'extraPayloadMaxSize'),
      replacePayloadMaxSize: asNumber(value[7], 'replacePayloadMaxSize'),
      flatMbr: asNumber(value[8], 'flatMbr'),
      byteMbr: asNumber(value[9], 'byteMbr'),
    })
  }

  /** Compute the minimum balance requirement for a metadata box holding `metadataSize` bytes. */
  mbrForBox(metadataSize: number): number {
    if (!Number.isInteger(metadataSize) || metadataSize < 0) throw new RangeError('metadataSize must be non-negative')
    return this.flatMbr + this.byteMbr * (this.keySize + this.headerSize + metadataSize)
  }

  /** Compute MBR delta from old->new box size using the registry MBR parameters. */
  mbrDelta(args: { oldMetadataSize: number | null; newMetadataSize: number; delete?: boolean }): MbrDelta {
    const { oldMetadataSize, newMetadataSize, delete: del } = args
    if (!Number.isInteger(newMetadataSize) || newMetadataSize < 0)
      throw new RangeError('newMetadataSize must be non-negative')

    const oldMbr = oldMetadataSize === null ? 0 : this.mbrForBox(oldMetadataSize)
    const newMbr = this.mbrForBox(newMetadataSize)
    let delta = newMbr - oldMbr

    if (del) {
      if (oldMetadataSize === null) throw new Error('oldMetadataSize must be provided when delete=true')
      if (newMetadataSize !== 0) throw new Error('newMetadataSize must be 0 when delete=true')
      delta = -this.mbrForBox(oldMetadataSize)
    }

    if (delta === 0) return new MbrDelta({ sign: MbrDeltaSign.NULL, amount: 0 })
    if (delta > 0) return new MbrDelta({ sign: MbrDeltaSign.POS, amount: delta })
    return new MbrDelta({ sign: MbrDeltaSign.NEG, amount: Math.abs(delta) })
  }
}

export class MetadataExistence {
  public readonly asaExists: boolean
  public readonly metadataExists: boolean

  constructor(args: { asaExists: boolean; metadataExists: boolean }) {
    this.asaExists = args.asaExists
    this.metadataExists = args.metadataExists
  }

  static fromTuple(value: readonly boolean[]): MetadataExistence {
    if (value.length !== 2) throw new Error('Expected (asaExists, metadataExists)')
    return new MetadataExistence({ asaExists: Boolean(value[0]), metadataExists: Boolean(value[1]) })
  }
}

export class ReversibleFlags {
  public readonly arc20: boolean
  public readonly arc62: boolean
  public readonly reserved2: boolean
  public readonly reserved3: boolean
  public readonly reserved4: boolean
  public readonly reserved5: boolean
  public readonly reserved6: boolean
  public readonly reserved7: boolean

  constructor(
    args: {
      arc20?: boolean
      arc62?: boolean
      reserved2?: boolean
      reserved3?: boolean
      reserved4?: boolean
      reserved5?: boolean
      reserved6?: boolean
      reserved7?: boolean
    } = {},
  ) {
    this.arc20 = Boolean(args.arc20)
    this.arc62 = Boolean(args.arc62)
    this.reserved2 = Boolean(args.reserved2)
    this.reserved3 = Boolean(args.reserved3)
    this.reserved4 = Boolean(args.reserved4)
    this.reserved5 = Boolean(args.reserved5)
    this.reserved6 = Boolean(args.reserved6)
    this.reserved7 = Boolean(args.reserved7)
  }

  get byteValue(): number {
    let value = 0
    if (this.arc20) value |= bitmasks.MASK_REV_ARC20
    if (this.arc62) value |= bitmasks.MASK_REV_ARC62
    if (this.reserved2) value |= bitmasks.MASK_REV_RESERVED_2
    if (this.reserved3) value |= bitmasks.MASK_REV_RESERVED_3
    if (this.reserved4) value |= bitmasks.MASK_REV_RESERVED_4
    if (this.reserved5) value |= bitmasks.MASK_REV_RESERVED_5
    if (this.reserved6) value |= bitmasks.MASK_REV_RESERVED_6
    if (this.reserved7) value |= bitmasks.MASK_REV_RESERVED_7
    return value
  }

  static fromByte(value: number): ReversibleFlags {
    if (!Number.isInteger(value) || value < 0 || value > MAX_UINT8)
      throw new RangeError(`Byte value must be 0-255, got ${value}`)
    return new ReversibleFlags({
      arc20: Boolean(value & bitmasks.MASK_REV_ARC20),
      arc62: Boolean(value & bitmasks.MASK_REV_ARC62),
      reserved2: Boolean(value & bitmasks.MASK_REV_RESERVED_2),
      reserved3: Boolean(value & bitmasks.MASK_REV_RESERVED_3),
      reserved4: Boolean(value & bitmasks.MASK_REV_RESERVED_4),
      reserved5: Boolean(value & bitmasks.MASK_REV_RESERVED_5),
      reserved6: Boolean(value & bitmasks.MASK_REV_RESERVED_6),
      reserved7: Boolean(value & bitmasks.MASK_REV_RESERVED_7),
    })
  }

  static empty(): ReversibleFlags {
    return new ReversibleFlags()
  }
}

export class IrreversibleFlags {
  public readonly arc3: boolean
  public readonly arc89Native: boolean
  public readonly reserved2: boolean
  public readonly reserved3: boolean
  public readonly reserved4: boolean
  public readonly reserved5: boolean
  public readonly reserved6: boolean
  public readonly immutable: boolean

  constructor(
    args: {
      arc3?: boolean
      arc89Native?: boolean
      reserved2?: boolean
      reserved3?: boolean
      reserved4?: boolean
      reserved5?: boolean
      reserved6?: boolean
      immutable?: boolean
    } = {},
  ) {
    this.arc3 = Boolean(args.arc3)
    this.arc89Native = Boolean(args.arc89Native)
    this.reserved2 = Boolean(args.reserved2)
    this.reserved3 = Boolean(args.reserved3)
    this.reserved4 = Boolean(args.reserved4)
    this.reserved5 = Boolean(args.reserved5)
    this.reserved6 = Boolean(args.reserved6)
    this.immutable = Boolean(args.immutable)
  }

  get byteValue(): number {
    let value = 0
    if (this.arc3) value |= bitmasks.MASK_IRR_ARC3
    if (this.arc89Native) value |= bitmasks.MASK_IRR_ARC89_NATIVE
    if (this.reserved2) value |= bitmasks.MASK_IRR_RESERVED_2
    if (this.reserved3) value |= bitmasks.MASK_IRR_RESERVED_3
    if (this.reserved4) value |= bitmasks.MASK_IRR_RESERVED_4
    if (this.reserved5) value |= bitmasks.MASK_IRR_RESERVED_5
    if (this.reserved6) value |= bitmasks.MASK_IRR_RESERVED_6
    if (this.immutable) value |= bitmasks.MASK_IRR_IMMUTABLE
    return value
  }

  static fromByte(value: number): IrreversibleFlags {
    if (!Number.isInteger(value) || value < 0 || value > MAX_UINT8)
      throw new RangeError(`Byte value must be 0-255, got ${value}`)
    return new IrreversibleFlags({
      arc3: Boolean(value & bitmasks.MASK_IRR_ARC3),
      arc89Native: Boolean(value & bitmasks.MASK_IRR_ARC89_NATIVE),
      reserved2: Boolean(value & bitmasks.MASK_IRR_RESERVED_2),
      reserved3: Boolean(value & bitmasks.MASK_IRR_RESERVED_3),
      reserved4: Boolean(value & bitmasks.MASK_IRR_RESERVED_4),
      reserved5: Boolean(value & bitmasks.MASK_IRR_RESERVED_5),
      reserved6: Boolean(value & bitmasks.MASK_IRR_RESERVED_6),
      immutable: Boolean(value & bitmasks.MASK_IRR_IMMUTABLE),
    })
  }

  static empty(): IrreversibleFlags {
    return new IrreversibleFlags()
  }
}

export class MetadataFlags {
  public readonly reversible: ReversibleFlags
  public readonly irreversible: IrreversibleFlags

  constructor(args: { reversible: ReversibleFlags; irreversible: IrreversibleFlags }) {
    this.reversible = args.reversible
    this.irreversible = args.irreversible
  }

  get reversibleByte(): number {
    return this.reversible.byteValue
  }

  get irreversibleByte(): number {
    return this.irreversible.byteValue
  }

  static fromBytes(reversible: number, irreversible: number): MetadataFlags {
    return new MetadataFlags({
      reversible: ReversibleFlags.fromByte(reversible),
      irreversible: IrreversibleFlags.fromByte(irreversible),
    })
  }

  static empty(): MetadataFlags {
    return new MetadataFlags({ reversible: ReversibleFlags.empty(), irreversible: IrreversibleFlags.empty() })
  }
}

export class MetadataHeader {
  public readonly identifiers: number
  public readonly flags: MetadataFlags
  /** 32 bytes */
  public readonly metadataHash: Uint8Array
  public readonly lastModifiedRound: bigint
  public readonly deprecatedBy: bigint

  constructor(args: {
    identifiers: number
    flags: MetadataFlags
    metadataHash: Uint8Array
    lastModifiedRound: bigint | number
    deprecatedBy: bigint | number
  }) {
    this.identifiers = args.identifiers
    this.flags = args.flags
    this.metadataHash = args.metadataHash
    this.lastModifiedRound = asBigInt(args.lastModifiedRound, 'last_modified_round')
    this.deprecatedBy = asBigInt(args.deprecatedBy, 'deprecated_by')
    if (this.metadataHash.length !== 32) throw new RangeError('metadata_hash must be 32 bytes')
    if (!Number.isInteger(this.identifiers) || this.identifiers < 0 || this.identifiers > MAX_UINT8)
      throw new RangeError('identifiers must fit in uint8')
  }

  get isShort(): boolean {
    return Boolean(this.identifiers & bitmasks.MASK_ID_SHORT)
  }

  get isImmutable(): boolean {
    return this.flags.irreversible.immutable
  }

  get isArc3Compliant(): boolean {
    return this.flags.irreversible.arc3
  }

  get isArc89Native(): boolean {
    return this.flags.irreversible.arc89Native
  }

  get isArc20SmartAsa(): boolean {
    return this.flags.reversible.arc20
  }

  get isArc62CirculatingSupply(): boolean {
    return this.flags.reversible.arc62
  }

  get isDeprecated(): boolean {
    return this.deprecatedBy !== 0n
  }

  get serialized(): Uint8Array {
    const out = new Uint8Array(consts.HEADER_SIZE)
    out[0] = this.identifiers & 0xff
    out[1] = this.flags.reversibleByte & 0xff
    out[2] = this.flags.irreversibleByte & 0xff
    out.set(this.metadataHash, consts.IDX_METADATA_HASH)
    out.set(uint64ToBytesBE(this.lastModifiedRound), consts.IDX_LAST_MODIFIED_ROUND)
    out.set(uint64ToBytesBE(this.deprecatedBy), consts.IDX_DEPRECATED_BY)
    return out
  }

  /** Return identifiers whose shortness bit is consistent with `body` (reserved bits preserved). */
  expectedIdentifiers(args: { body: MetadataBody; params?: RegistryParameters }): number {
    const p = args.params ?? getDefaultRegistryParams()
    const isShort = args.body.size <= p.shortMetadataSize
    return setBit({ bits: this.identifiers & 0xff, mask: bitmasks.MASK_ID_SHORT, value: isShort })
  }

  static fromTuple(value: readonly AbiValue[]): MetadataHeader {
    if (value.length !== 6) throw new Error('Expected 6-tuple for metadata header')
    const [v0, v1, v2, v3, v4, v5] = value

    const identifiers = asUint8(v0, 'identifiers')
    const rev = asUint8(v1, 'reversibleFlags')
    const irr = asUint8(v2, 'irreversibleFlags')
    const metadataHash = toBytes(v3, 'metadataHash')
    if (metadataHash.length !== 32) throw new Error('metadataHash must be 32 bytes')

    const lastModifiedRound = asBigInt(v4 as bigint | number, 'lastModifiedRound')
    const deprecatedBy = asBigInt(v5 as bigint | number, 'deprecatedBy')

    return new MetadataHeader({
      identifiers,
      flags: MetadataFlags.fromBytes(rev, irr),
      metadataHash,
      lastModifiedRound,
      deprecatedBy,
    })
  }
}

export class MetadataBody {
  public readonly rawBytes: Uint8Array

  constructor(rawBytes: Uint8Array) {
    this.rawBytes = rawBytes
  }

  get size(): number {
    return this.rawBytes.length
  }

  get isShort(): boolean {
    const p = getDefaultRegistryParams()
    return this.size <= p.shortMetadataSize
  }

  get isEmpty(): boolean {
    return this.size === 0
  }

  get json(): Record<string, unknown> {
    return decodeMetadataJson(this.rawBytes)
  }

  totalPages(params?: RegistryParameters): number {
    if (this.size === 0) return 0
    const p = params ?? getDefaultRegistryParams()
    return Math.floor((this.size + p.pageSize - 1) / p.pageSize)
  }

  getPage(pageIndex: number, params?: RegistryParameters): Uint8Array {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new InvalidPageIndexError('pageIndex must be non-negative')
    const total = this.totalPages(params)
    if (pageIndex >= total) {
      throw new InvalidPageIndexError(`Page index ${pageIndex} out of range (total pages: ${total})`)
    }
    const p = params ?? getDefaultRegistryParams()
    const start = pageIndex * p.pageSize
    const end = Math.min(start + p.pageSize, this.size)
    return this.rawBytes.slice(start, end)
  }

  /** Split the metadata bytes into head + extra payload chunks. */
  chunkedPayload(params?: RegistryParameters): Uint8Array[] {
    const p = params ?? getDefaultRegistryParams()
    return chunkMetadataPayload({
      data: this.rawBytes,
      headMaxSize: p.firstPayloadMaxSize,
      extraMaxSize: p.extraPayloadMaxSize,
    })
  }

  /** Raise RangeError if metadata exceeds max size. */
  validateSize(params?: RegistryParameters): void {
    const p = params ?? getDefaultRegistryParams()
    if (this.size > p.maxMetadataSize) {
      throw new RangeError(`Metadata size ${this.size} exceeds max ${p.maxMetadataSize}`)
    }
  }

  static fromJson(obj: Record<string, unknown>, args?: { arc3Compliant?: boolean }): MetadataBody {
    if (args?.arc3Compliant) {
      validateArc3Schema(obj)
    }
    return new MetadataBody(encodeMetadataJson(obj))
  }

  /** Create an empty metadata body (represents `{}`). */
  static empty(): MetadataBody {
    return new MetadataBody(new Uint8Array())
  }
}

export class Pagination {
  public readonly metadataSize: number
  public readonly pageSize: number
  public readonly totalPages: number

  constructor(args: { metadataSize: number; pageSize: number; totalPages: number }) {
    this.metadataSize = args.metadataSize
    this.pageSize = args.pageSize
    this.totalPages = args.totalPages
  }

  static fromTuple(value: readonly (number | bigint)[]): Pagination {
    if (value.length !== 3) throw new Error('Expected (metadataSize, pageSize, totalPages)')
    return new Pagination({
      metadataSize: asNumber(value[0], 'metadataSize'),
      pageSize: asNumber(value[1], 'pageSize'),
      totalPages: asNumber(value[2], 'totalPages'),
    })
  }
}

export class PaginatedMetadata {
  public readonly hasNextPage: boolean
  public readonly lastModifiedRound: bigint
  public readonly pageContent: Uint8Array

  constructor(args: { hasNextPage: boolean; lastModifiedRound: bigint | number; pageContent: Uint8Array }) {
    this.hasNextPage = args.hasNextPage
    this.lastModifiedRound = asBigInt(args.lastModifiedRound, 'lastModifiedRound')
    this.pageContent = args.pageContent
  }

  static fromTuple(value: readonly AbiValue[]): PaginatedMetadata {
    if (value.length !== 3) throw new Error('Expected (hasNextPage, lastModifiedRound, pageContent)')
    const [v0, v1, v2] = value
    if (typeof v0 !== 'boolean') throw new TypeError('hasNextPage must be bool')
    const lmr = asBigInt(v1 as bigint | number, 'lastModifiedRound')
    const pageContent = toBytes(v2, 'pageContent')
    return new PaginatedMetadata({ hasNextPage: v0, lastModifiedRound: lmr, pageContent })
  }
}

export class AssetMetadataBox {
  public readonly assetId: bigint
  public readonly header: MetadataHeader
  public readonly body: MetadataBody

  constructor(args: { assetId: bigint | number; header: MetadataHeader; body: MetadataBody }) {
    this.assetId = asBigInt(args.assetId, 'assetId')
    this.header = args.header
    this.body = args.body
  }

  /**
   * Parse an ARC-89 box value into (header, body).
   */
  static parse(args: {
    assetId: bigint | number
    value: Uint8Array
    headerSize?: number
    maxMetadataSize?: number
    params?: RegistryParameters
  }): AssetMetadataBox {
    const p = args.params ?? getDefaultRegistryParams()
    const headerSize = args.headerSize ?? p.headerSize
    const maxMetadataSize = args.maxMetadataSize ?? p.maxMetadataSize

    if (args.value.length < headerSize) {
      throw new BoxParseError(`Box value too small: ${args.value.length} < ${headerSize}`)
    }

    let identifiers: number
    let revFlags: number
    let irrFlags: number
    let metadataHash: Uint8Array
    let lastModifiedRound: bigint
    let deprecatedBy: bigint

    try {
      identifiers = args.value[consts.IDX_METADATA_IDENTIFIERS]!
      revFlags = args.value[consts.IDX_REVERSIBLE_FLAGS]!
      irrFlags = args.value[consts.IDX_IRREVERSIBLE_FLAGS]!
      metadataHash = args.value.slice(consts.IDX_METADATA_HASH, consts.IDX_LAST_MODIFIED_ROUND)
      lastModifiedRound = readUint64BE(args.value, consts.IDX_LAST_MODIFIED_ROUND)
      deprecatedBy = readUint64BE(args.value, consts.IDX_DEPRECATED_BY)
    } catch (e) {
      throw new BoxParseError('Failed to parse ARC-89 metadata header', { cause: e })
    }

    if (metadataHash.length !== 32) throw new BoxParseError('Invalid metadataHash length')

    const bodyBytes = args.value.slice(headerSize)
    if (bodyBytes.length > maxMetadataSize) throw new BoxParseError('Metadata exceeds maxMetadataSize')

    const header = new MetadataHeader({
      identifiers,
      flags: MetadataFlags.fromBytes(revFlags, irrFlags),
      metadataHash,
      lastModifiedRound,
      deprecatedBy,
    })
    const body = new MetadataBody(bodyBytes)
    return new AssetMetadataBox({ assetId: args.assetId, header, body })
  }

  /**
   * Compute the *effective* metadata hash for this record.
   */
  expectedMetadataHash(args?: {
    params?: RegistryParameters
    asaAm?: Uint8Array | null
    enforceImmutableOnOverride?: boolean
    enforceArc89NativeHashMatch?: boolean
  }): Uint8Array {
    const p = args?.params ?? getDefaultRegistryParams()
    const identifiers = this.header.expectedIdentifiers({ body: this.body, params: p })

    const computed = computeMetadataHash({
      assetId: this.assetId,
      metadataIdentifiers: identifiers,
      reversibleFlags: this.header.flags.reversibleByte,
      irreversibleFlags: this.header.flags.irreversibleByte,
      metadata: this.body.rawBytes,
      pageSize: p.pageSize,
    })

    const asaAm = args?.asaAm ?? null
    if (asaAm && isNonzero32(asaAm)) {
      const enforceImmutable = args?.enforceImmutableOnOverride ?? true
      const enforceHashMatch = args?.enforceArc89NativeHashMatch ?? true

      if (enforceImmutable && !this.header.flags.irreversible.immutable) {
        throw new Error('ASA `am` override requires immutable metadata')
      }
      if (
        enforceHashMatch &&
        this.header.isArc89Native &&
        !this.header.isArc3Compliant &&
        !bytesEqual(asaAm, computed)
      ) {
        throw new MetadataHashMismatchError(
          'ASA Metadata Hash (am) does not match the computed hash; ARC89 native metadata without ARC3 requires matching hashes',
        )
      }
      return asaAm
    }

    return computed
  }

  /** Compare observed on-chain hash to the locally computed effective hash. */
  hashMatches(args?: {
    params?: RegistryParameters
    asaAm?: Uint8Array | null
    skipValidationOnOverride?: boolean
  }): boolean {
    const asaAm = args?.asaAm ?? null
    if (asaAm && isNonzero32(asaAm) && (args?.skipValidationOnOverride ?? true)) {
      return true
    }
    const expected = this.expectedMetadataHash({ params: args?.params, asaAm })
    return bytesEqual(expected, this.header.metadataHash)
  }

  get json(): Record<string, unknown> {
    return decodeMetadataJson(this.body.rawBytes)
  }

  asAssetMetadata(): AssetMetadata {
    return new AssetMetadata({
      assetId: this.assetId,
      body: this.body,
      flags: this.header.flags,
      deprecatedBy: this.header.deprecatedBy,
    })
  }
}

export class AssetMetadataRecord {
  public readonly appId: bigint
  public readonly assetId: bigint
  public readonly header: MetadataHeader
  public readonly body: MetadataBody

  constructor(args: { appId: bigint | number; assetId: bigint | number; header: MetadataHeader; body: MetadataBody }) {
    this.appId = asBigInt(args.appId, 'appId')
    this.assetId = asBigInt(args.assetId, 'assetId')
    this.header = args.header
    this.body = args.body
  }

  get json(): Record<string, unknown> {
    return decodeMetadataJson(this.body.rawBytes)
  }

  asAssetMetadata(): AssetMetadata {
    return new AssetMetadata({
      assetId: this.assetId,
      body: this.body,
      flags: this.header.flags,
      deprecatedBy: this.header.deprecatedBy,
    })
  }

  expectedMetadataHash(args?: {
    params?: RegistryParameters
    asaAm?: Uint8Array | null
    enforceImmutableOnOverride?: boolean
    enforceArc89NativeHashMatch?: boolean
  }): Uint8Array {
    return new AssetMetadataBox({ assetId: this.assetId, header: this.header, body: this.body }).expectedMetadataHash(
      args,
    )
  }

  hashMatches(args?: { params?: RegistryParameters; asaAm?: Uint8Array | null }): boolean {
    return new AssetMetadataBox({ assetId: this.assetId, header: this.header, body: this.body }).hashMatches({
      params: args?.params,
      asaAm: args?.asaAm ?? null,
    })
  }
}

export class AssetMetadata {
  public readonly assetId: bigint
  public readonly body: MetadataBody
  public readonly flags: MetadataFlags
  public readonly deprecatedBy: bigint

  constructor(args: {
    assetId: bigint | number
    body: MetadataBody
    flags: MetadataFlags
    deprecatedBy?: bigint | number
  }) {
    this.assetId = asBigInt(args.assetId, 'assetId')
    this.body = args.body
    this.flags = args.flags
    this.deprecatedBy = args.deprecatedBy === undefined ? 0n : asBigInt(args.deprecatedBy, 'deprecatedBy')
  }

  get isEmpty(): boolean {
    return this.body.isEmpty
  }

  get isShort(): boolean {
    return this.body.isShort
  }

  get size(): number {
    return this.body.size
  }

  get isImmutable(): boolean {
    return this.flags.irreversible.immutable
  }

  get isArc3Compliant(): boolean {
    return this.flags.irreversible.arc3
  }

  get isArc89Native(): boolean {
    return this.flags.irreversible.arc89Native
  }

  get isArc20SmartAsa(): boolean {
    return this.flags.reversible.arc20
  }

  get isArc62CirculatingSupply(): boolean {
    return this.flags.reversible.arc62
  }

  get isDeprecated(): boolean {
    return this.deprecatedBy !== 0n
  }

  /** Compute the identifiers byte for hashing/writes (reserved bits default to 0). */
  get identifiersByte(): number {
    let value = 0
    if (this.isShort) value |= bitmasks.MASK_ID_SHORT
    return value
  }

  computeHeaderHash(): Uint8Array {
    return computeHeaderHash({
      assetId: this.assetId,
      metadataIdentifiers: this.identifiersByte,
      reversibleFlags: this.flags.reversibleByte,
      irreversibleFlags: this.flags.irreversibleByte,
      metadataSize: this.body.size,
    })
  }

  computePageHash(args: { pageIndex: number }): Uint8Array {
    return computePageHash({
      assetId: this.assetId,
      pageIndex: args.pageIndex,
      pageContent: this.body.getPage(args.pageIndex),
    })
  }

  /** Compute ARC-89 hash from (identifiers, flags, pages) ignoring ASA `am` override. */
  computeArc89MetadataHash(): Uint8Array {
    const p = getDefaultRegistryParams()
    return computeMetadataHash({
      assetId: this.assetId,
      metadataIdentifiers: this.identifiersByte,
      reversibleFlags: this.flags.reversibleByte,
      irreversibleFlags: this.flags.irreversibleByte,
      metadata: this.body.rawBytes,
      pageSize: p.pageSize,
    })
  }

  /** Compute the effective on-chain metadata hash (supports ASA `am` override). */
  computeMetadataHash(args?: {
    asaAm?: Uint8Array | null
    enforceImmutableOnOverride?: boolean
    enforceArc89NativeHashMatch?: boolean
  }): Uint8Array {
    const computed = this.computeArc89MetadataHash()
    const asaAm = args?.asaAm ?? null
    if (asaAm) {
      if (asaAm.length !== 32) throw new RangeError('ASA `am` override must be exactly 32 bytes')
      if (isNonzero32(asaAm)) {
        const enforceImmutable = args?.enforceImmutableOnOverride ?? true
        const enforceHashMatch = args?.enforceArc89NativeHashMatch ?? true

        if (enforceImmutable && !this.flags.irreversible.immutable) {
          throw new Error('ASA `am` override requires immutable metadata')
        }
        if (enforceHashMatch && this.isArc89Native && !this.isArc3Compliant && !bytesEqual(asaAm, computed)) {
          throw new MetadataHashMismatchError(
            'ASA Metadata Hash (am) does not match the computed hash; ARC89 native metadata without ARC3 requires matching hashes',
          )
        }
        return asaAm
      }
    }
    return computed
  }

  getMbrDelta(args?: { oldSize?: number | null }): MbrDelta {
    const p = getDefaultRegistryParams()
    return p.mbrDelta({ oldMetadataSize: args?.oldSize ?? null, newMetadataSize: this.body.size })
  }

  getDeleteMbrDelta(): MbrDelta {
    const p = getDefaultRegistryParams()
    return p.mbrDelta({ oldMetadataSize: this.body.size, newMetadataSize: 0, delete: true })
  }

  static fromJson(args: {
    assetId: bigint | number
    jsonObj: Record<string, unknown>
    flags?: MetadataFlags | null
    deprecatedBy?: bigint | number
    arc3Compliant?: boolean
  }): AssetMetadata {
    const arc3 = Boolean(args.arc3Compliant)
    if (arc3) validateArc3Schema(args.jsonObj)

    const raw = encodeMetadataJson(args.jsonObj)
    // Validate round-trip and schema constraints (object)
    decodeMetadataJson(raw)

    let finalFlags: MetadataFlags
    if (args.flags) {
      finalFlags = args.flags
    } else if (arc3) {
      finalFlags = new MetadataFlags({
        reversible: ReversibleFlags.empty(),
        irreversible: new IrreversibleFlags({ arc3: true }),
      })
    } else {
      finalFlags = MetadataFlags.empty()
    }

    return new AssetMetadata({
      assetId: args.assetId,
      body: new MetadataBody(raw),
      flags: finalFlags,
      deprecatedBy: args.deprecatedBy ?? 0n,
    })
  }

  static fromBytes(args: {
    assetId: bigint | number
    metadataBytes: Uint8Array
    flags?: MetadataFlags | null
    deprecatedBy?: bigint | number
    validateJsonObject?: boolean
    arc3Compliant?: boolean
  }): AssetMetadata {
    const validateJson = args.validateJsonObject ?? true
    const arc3 = Boolean(args.arc3Compliant)
    if (arc3 && !validateJson) throw new Error('arc3Compliant=true requires validateJsonObject=true')

    if (validateJson) {
      const obj = decodeMetadataJson(args.metadataBytes)
      if (arc3) validateArc3Schema(obj)
    }

    return new AssetMetadata({
      assetId: args.assetId,
      body: new MetadataBody(args.metadataBytes),
      flags: args.flags ?? MetadataFlags.empty(),
      deprecatedBy: args.deprecatedBy ?? 0n,
    })
  }
}
