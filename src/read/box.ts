/**
 * ARC-89 box reader.
 *
 * Ported from Python `asa_metadata_registry/read/box.py`.
 * All methods that touch Algod are async.
 */

import { ALGORAND_ZERO_ADDRESS_STRING } from 'algosdk'
import * as enums from '../enums.js'
import { AlgodBoxReader } from '../algod.js'
import { b64UrlDecode } from '../codec.js'
import {
  AsaNotFoundError,
  BoxNotFoundError,
  InvalidPageIndexError,
  InvalidSliceError,
  MetadataEncodingError,
  MetadataKeyError,
} from '../errors.js'
import { computeHeaderHash, computePageHash, paginate } from '../hashing.js'
import {
  AssetMetadataBox,
  AssetMetadataRecord,
  MetadataBody,
  MetadataHeader,
  MetadataSlice,
  PaginatedMetadata,
  Pagination,
  RegistryParameters,
} from '../models.js'
import { isPlainObject } from '../validation.js'
import { b64DecodeStrict } from '../internal/base64.js'
import { integerLiteralValue, scanJsonText } from '../internal/json.js'
import { asBigInt } from '../internal/numbers.js'

type JsonObject = Record<string, unknown>

const MAX_UINT64 = (1n << 64n) - 1n

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const hasNonFiniteNumber = (value: unknown): boolean => {
  const stack = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    if (typeof v === 'number' && !Number.isFinite(v)) return true
    if (v !== null && typeof v === 'object') stack.push(...Object.values(v))
  }
  return false
}

/**
 * Reconstruct ARC-89 getter outputs from box contents (Algod).
 *
 * This reader is **fast** (direct box read) and does not require transactions.
 */
export class AsaMetadataRegistryBoxRead {
  public readonly algod: AlgodBoxReader
  public readonly appId: bigint
  public readonly params: RegistryParameters

  constructor(args: { algod: AlgodBoxReader; appId: bigint | number; params: RegistryParameters }) {
    this.algod = args.algod
    this.appId = asBigInt(args.appId, 'appId')
    this.params = args.params
  }

  private async box(assetId: bigint | number): Promise<AssetMetadataBox> {
    return await this.algod.getMetadataBox({ appId: this.appId, assetId, params: this.params })
  }

  // ------------------------------------------------------------------
  // Contract-equivalent getters (reconstructed)
  // ------------------------------------------------------------------

  /** Metadata existence by box lookup; ASA existence by `getAssetInfo`. */
  async arc89CheckMetadataExists(args: { assetId: bigint | number }): Promise<readonly [boolean, boolean]> {
    const assetId = args.assetId

    let metadataExists = true
    try {
      await this.box(assetId)
    } catch (e) {
      if (e instanceof BoxNotFoundError) metadataExists = false
      else throw e
    }

    let asaExists = true
    try {
      await this.algod.getAssetInfo(assetId)
    } catch (e) {
      if (e instanceof AsaNotFoundError) asaExists = false
      else throw e
    }

    return [asaExists, metadataExists]
  }

  /** Same rule as the AVM getter: immutable flag, or ASA Manager Address cleared. */
  async arc89IsMetadataImmutable(args: { assetId: bigint | number }): Promise<boolean> {
    if ((await this.box(args.assetId)).header.isImmutable) return true
    const manager = (await this.algod.getAssetInfo(args.assetId)).params?.manager
    return !manager || manager === ALGORAND_ZERO_ADDRESS_STRING
  }

  async arc89IsMetadataShort(args: { assetId: bigint | number }): Promise<readonly [boolean, bigint]> {
    const h = (await this.box(args.assetId)).header
    return [h.isShort, h.revision]
  }

  async arc89GetMetadataHeader(args: { assetId: bigint | number }): Promise<MetadataHeader> {
    return (await this.box(args.assetId)).header
  }

  async arc89GetMetadataPagination(args: { assetId: bigint | number }): Promise<Pagination> {
    const b = await this.box(args.assetId)
    const size = b.body.size
    const pageSize = this.params.pageSize
    const totalPages = size === 0 ? 0 : Math.floor((size + pageSize - 1) / pageSize)
    return new Pagination({
      metadataSize: size,
      pageSize,
      totalPages,
      revision: b.header.revision,
      deprecatedBy: b.header.deprecatedBy,
    })
  }

  /** @throws {InvalidPageIndexError} If the page is out of range (page 0 of empty Metadata is valid). */
  async arc89GetMetadata(args: { assetId: bigint | number; page: number }): Promise<PaginatedMetadata> {
    if (!Number.isInteger(args.page)) {
      throw new TypeError('page must be an integer')
    }
    const b = await this.box(args.assetId)
    const pages = paginate(b.body.rawBytes, this.params.pageSize)
    if (args.page < 0 || args.page >= Math.max(1, pages.length)) {
      throw new InvalidPageIndexError(`Page ${args.page} out of range (${pages.length} pages)`)
    }
    const content = pages.length ? pages[args.page]! : new Uint8Array()
    return new PaginatedMetadata({
      hasNextPage: args.page + 1 < pages.length,
      revision: b.header.revision,
      pageContent: content,
    })
  }

  /** @throws {InvalidSliceError} If the slice exceeds `PAGE_SIZE` or the Metadata size. */
  async arc89GetMetadataSlice(args: {
    assetId: bigint | number
    offset: number
    size: number
  }): Promise<MetadataSlice> {
    if (!Number.isInteger(args.offset) || !Number.isInteger(args.size)) {
      throw new TypeError('offset and size must be integers')
    }
    const b = await this.box(args.assetId)
    if (args.offset < 0 || args.size < 0 || args.size > this.params.pageSize) {
      throw new InvalidSliceError('Slice size must be within [0, PAGE_SIZE]')
    }
    if (args.offset + args.size > b.body.size) {
      throw new InvalidSliceError('Slice exceeds the Metadata size')
    }
    return new MetadataSlice({
      revision: b.header.revision,
      content: b.body.rawBytes.slice(args.offset, args.offset + args.size),
    })
  }

  /** @returns The Metadata Header Hash and the Revision it was computed at. */
  async arc89GetMetadataHeaderHash(args: { assetId: bigint | number }): Promise<readonly [Uint8Array, bigint]> {
    const b = await this.box(args.assetId)
    const hh = computeHeaderHash({
      metadataIdentifiers: b.header.identifiers,
      reversibleFlags: b.header.flags.reversibleByte,
      irreversibleFlags: b.header.flags.irreversibleByte,
      metadataSize: b.body.size,
    })
    return [hh, b.header.revision]
  }

  /**
   * @returns The page hash and the Revision it was computed at.
   * @throws {InvalidPageIndexError} If the page is out of range.
   */
  async arc89GetMetadataPageHash(args: {
    assetId: bigint | number
    page: number
  }): Promise<readonly [Uint8Array, bigint]> {
    const b = await this.box(args.assetId)
    const pages = paginate(b.body.rawBytes, this.params.pageSize)
    if (!Number.isInteger(args.page) || args.page < 0 || args.page >= pages.length) {
      throw new InvalidPageIndexError(`Page ${args.page} out of range (${pages.length} pages)`)
    }
    return [computePageHash({ pageIndex: args.page, pageContent: pages[args.page]! }), b.header.revision]
  }

  /** On-chain method returns the header's stored Metadata Hash (and the Revision). */
  async arc89GetMetadataHash(args: { assetId: bigint | number }): Promise<readonly [Uint8Array, bigint]> {
    const b = await this.box(args.assetId)
    return [b.header.metadataHash, b.header.revision]
  }

  // ------------------------------------------------------------------
  // Practical off-chain helpers
  // ------------------------------------------------------------------

  async getAssetMetadataRecord(args: { assetId: bigint | number }): Promise<AssetMetadataRecord> {
    return await this.algod.getAssetMetadataRecord({ appId: this.appId, assetId: args.assetId, params: this.params })
  }

  async getMetadataJson(args: { assetId: bigint | number }): Promise<JsonObject> {
    return (await this.getAssetMetadataRecord(args)).json
  }

  /** Same constraints as the AVM JSON getters: short Metadata, numbers within the float64 range, existing key. */
  private async shortJsonValue(args: {
    assetId: bigint | number
    key: string
  }): Promise<{ value: unknown; body: MetadataBody }> {
    const b = await this.box(args.assetId)
    if (b.body.size > this.params.shortMetadataSize) {
      throw new MetadataEncodingError('JSON getters require short Metadata')
    }
    const obj = b.body.json
    if (hasNonFiniteNumber(obj)) {
      throw new MetadataEncodingError('JSON getters reject numbers outside the float64 range')
    }
    if (!Object.prototype.hasOwnProperty.call(obj, args.key)) throw new MetadataKeyError(args.key)
    return { value: obj[args.key], body: b.body }
  }

  private checkValueSize(value: Uint8Array): void {
    if (value.length > this.params.pageSize) {
      throw new MetadataEncodingError('JSON value exceeds PAGE_SIZE')
    }
  }

  /** @throws {MetadataKeyError} If the key is missing or its value is not a JSON String. */
  async getStringByKey(args: { assetId: bigint | number; key: string }): Promise<string> {
    const { value } = await this.shortJsonValue(args)
    if (typeof value !== 'string') throw new MetadataKeyError(`${args.key}: not a JSON String`)
    this.checkValueSize(textEncoder.encode(value))
    return value
  }

  /**
   * Returns the exact uint64 value (integer literals are read from the raw JSON text, so values
   * beyond `Number.MAX_SAFE_INTEGER` keep full precision).
   *
   * @throws {MetadataKeyError} If the key is missing or its value is not a JSON Uint64.
   */
  async getUint64ByKey(args: { assetId: bigint | number; key: string }): Promise<bigint> {
    const { body } = await this.shortJsonValue(args)
    const raw = scanJsonText(textDecoder.decode(body.rawBytes)).topLevelMembers.get(args.key)
    const value = raw === undefined || raw.startsWith('-') ? undefined : integerLiteralValue(raw)
    if (value === undefined || value > MAX_UINT64) {
      throw new MetadataKeyError(`${args.key}: not a JSON Uint64`)
    }
    return value
  }

  /**
   * Returns the raw text of a JSON Object value, as the AVM `json_ref` does.
   *
   * @throws {MetadataKeyError} If the key is missing or its value is not a JSON Object.
   */
  async getObjectByKey(args: { assetId: bigint | number; key: string }): Promise<string> {
    const { value, body } = await this.shortJsonValue(args)
    const raw = scanJsonText(textDecoder.decode(body.rawBytes)).topLevelMembers.get(args.key)
    if (raw === undefined || !isPlainObject(value)) throw new MetadataKeyError(`${args.key}: not a JSON Object`)
    this.checkValueSize(textEncoder.encode(raw))
    return raw
  }

  /**
   * @throws {MetadataKeyError} If the key is missing or its value is not a JSON String.
   * @throws {MetadataEncodingError} If the value is not valid base64 for the requested encoding.
   */
  async getB64BytesByKey(args: {
    assetId: bigint | number
    key: string
    b64Encoding: typeof enums.B64_STD_ENCODING | typeof enums.B64_URL_ENCODING
  }): Promise<Uint8Array> {
    const { key, b64Encoding } = args
    if (b64Encoding !== enums.B64_STD_ENCODING && b64Encoding !== enums.B64_URL_ENCODING) {
      throw new RangeError('b64Encoding must be B64_STD_ENCODING or B64_URL_ENCODING')
    }

    const { value } = await this.shortJsonValue(args)
    if (typeof value !== 'string') throw new MetadataKeyError(`${key}: not a JSON String`)

    let decoded: Uint8Array
    try {
      if (b64Encoding === enums.B64_URL_ENCODING) {
        decoded = b64UrlDecode(value.replace(/=+$/, ''))
      } else {
        decoded = b64DecodeStrict(value)
      }
    } catch (e) {
      throw new MetadataEncodingError(`${key}: invalid base64 value`, { cause: e })
    }
    this.checkValueSize(decoded)
    return decoded
  }
}
