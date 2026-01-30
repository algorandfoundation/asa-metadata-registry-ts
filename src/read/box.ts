/**
 * ARC-89 box reader.
 *
 * Ported from Python `asa_metadata_registry/read/box.py`.
 * All methods that touch Algod are async.
 */

import * as enums from '../enums'
import { AlgodBoxReader } from '../algod'
import { computeHeaderHash, computePageHash, paginate } from '../hashing'
import {
  AssetMetadataBox,
  AssetMetadataRecord,
  MetadataHeader,
  PaginatedMetadata,
  Pagination,
  RegistryParameters,
} from '../models'
import { asBigInt, toBigInt } from '../internal/numbers'
import { AsaNotFoundError, BoxNotFoundError } from '../errors'

type JsonObject = Record<string, unknown>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

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

  /**
   * Off-chain, we can check only metadata existence by box lookup; ASA existence requires getAssetInfo.
   */
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

  async arc89IsMetadataImmutable(args: { assetId: bigint | number }): Promise<boolean> {
    return (await this.box(args.assetId)).header.isImmutable
  }

  async arc89IsMetadataShort(args: { assetId: bigint | number }): Promise<readonly [boolean, bigint]> {
    const h = (await this.box(args.assetId)).header
    return [h.isShort, h.lastModifiedRound]
  }

  async arc89GetMetadataHeader(args: { assetId: bigint | number }): Promise<MetadataHeader> {
    return (await this.box(args.assetId)).header
  }

  async arc89GetMetadataPagination(args: { assetId: bigint | number }): Promise<Pagination> {
    const b = await this.box(args.assetId)
    const size = b.body.size
    const pageSize = this.params.pageSize
    const totalPages = size === 0 ? 0 : Math.floor((size + pageSize - 1) / pageSize)
    return new Pagination({ metadataSize: size, pageSize, totalPages })
  }

  async arc89GetMetadata(args: { assetId: bigint | number; page: number }): Promise<PaginatedMetadata> {
    if (!Number.isInteger(args.page)) {
      throw new TypeError('page must be an integer')
    }
    const b = await this.box(args.assetId)
    const pages = paginate(b.body.rawBytes, this.params.pageSize)

    // Keep Python parity: if out of range, return empty content.
    if (args.page < 0 || args.page >= Math.max(1, pages.length)) {
      return new PaginatedMetadata({
        hasNextPage: false,
        lastModifiedRound: b.header.lastModifiedRound,
        pageContent: new Uint8Array(),
      })
    }

    const content = pages.length ? pages[args.page]! : new Uint8Array()
    const hasNext = args.page + 1 < pages.length
    return new PaginatedMetadata({
      hasNextPage: hasNext,
      lastModifiedRound: b.header.lastModifiedRound,
      pageContent: content,
    })
  }

  async arc89GetMetadataSlice(args: { assetId: bigint | number; offset: number; size: number }): Promise<Uint8Array> {
    const b = await this.box(args.assetId)
    if (!Number.isInteger(args.offset) || !Number.isInteger(args.size)) {
      throw new TypeError('offset and size must be integers')
    }
    if (args.offset < 0 || args.size < 0) return new Uint8Array()
    return b.body.rawBytes.slice(args.offset, args.offset + args.size)
  }

  async arc89GetMetadataHeaderHash(args: { assetId: bigint | number }): Promise<Uint8Array> {
    const b = await this.box(args.assetId)
    return computeHeaderHash({
      assetId: b.assetId,
      metadataIdentifiers: b.header.identifiers,
      reversibleFlags: b.header.flags.reversibleByte,
      irreversibleFlags: b.header.flags.irreversibleByte,
      metadataSize: b.body.size,
    })
  }

  async arc89GetMetadataPageHash(args: { assetId: bigint | number; page: number }): Promise<Uint8Array> {
    const b = await this.box(args.assetId)
    const pages = paginate(b.body.rawBytes, this.params.pageSize)
    if (!Number.isInteger(args.page) || args.page < 0 || args.page >= pages.length) return new Uint8Array()
    return computePageHash({ assetId: b.assetId, pageIndex: args.page, pageContent: pages[args.page]! })
  }

  /** On-chain method returns the header's stored metadata_hash. */
  async arc89GetMetadataHash(args: { assetId: bigint | number }): Promise<Uint8Array> {
    return (await this.box(args.assetId)).header.metadataHash
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

  async getStringByKey(args: { assetId: bigint | number; key: string }): Promise<string> {
    const obj = await this.getMetadataJson({ assetId: args.assetId })
    const v = obj[args.key]
    return typeof v === 'string' ? v : ''
  }

  /**
   * Returns a uint64-like value as bigint.
   */
  async getUint64ByKey(args: { assetId: bigint | number; key: string }): Promise<bigint> {
    const obj = await this.getMetadataJson({ assetId: args.assetId })
    const v = obj[args.key]
    if (typeof v === 'boolean') return v ? 1n : 0n
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return toBigInt(v)
    if (typeof v === 'bigint' && v >= 0n) return v
    return 0n
  }

  /**
   * Contract returns a JSON string for objects (limited by page size);
   * off-chain we stringify the value when it is an object.
   */
  async getObjectByKey(args: { assetId: bigint | number; key: string }): Promise<string> {
    const obj = await this.getMetadataJson({ assetId: args.assetId })
    const v = obj[args.key]
    try {
      return isPlainObject(v) ? (JSON.stringify(v) ?? '') : ''
    } catch {
      return ''
    }
  }

  async getB64BytesByKey(args: {
    assetId: bigint | number
    key: string
    b64Encoding: typeof enums.B64_STD_ENCODING | typeof enums.B64_URL_ENCODING
  }): Promise<Uint8Array> {
    const { assetId, key, b64Encoding } = args
    if (b64Encoding !== enums.B64_STD_ENCODING && b64Encoding !== enums.B64_URL_ENCODING) {
      throw new RangeError('b64Encoding must be B64_STD_ENCODING or B64_URL_ENCODING')
    }

    const obj = await this.getMetadataJson({ assetId })
    const v = obj[key]
    if (typeof v !== 'string') return new Uint8Array()

    try {
      // Node's Buffer supports both standard and urlsafe base64 strings.
      if (b64Encoding === enums.B64_URL_ENCODING) {
        return new Uint8Array(Buffer.from(v, 'base64url'))
      }
      return new Uint8Array(Buffer.from(v, 'base64'))
    } catch {
      return new Uint8Array()
    }
  }
}
