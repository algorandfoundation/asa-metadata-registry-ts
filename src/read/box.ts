/**
 * Reconstruct ARC-89 getter outputs from box contents (Algod).
 *
 * Ported from Python `asa_metadata_registry/read/box.py`.
 *
 * This reader is **fast** (direct box read) and does not require transactions.
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
import { toBigInt } from '../codec'
import { AsaNotFoundError, BoxNotFoundError } from '../errors'

type JsonObject = Record<string, unknown>

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Box-based reader.
 */
export class AsaMetadataRegistryBoxRead {
  public readonly algod: AlgodBoxReader
  public readonly appId: bigint
  public readonly params: RegistryParameters

  constructor(args: { algod: AlgodBoxReader; appId: bigint | number; params: RegistryParameters }) {
    this.algod = args.algod
    this.appId = toBigInt(args.appId)
    this.params = args.params
  }

  private async _box(assetId: bigint | number): Promise<AssetMetadataBox> {
    return await this.algod.getMetadataBox({ appId: this.appId, assetId, params: this.params })
  }

  // ------------------------------------------------------------------
  // Contract-equivalent getters (reconstructed)
  // ------------------------------------------------------------------

  /**
   * Off-chain, we can check only metadata existence by box lookup; ASA existence requires getAssetInfo.
   */
  async arc89_check_metadata_exists(args: { asset_id: bigint | number }): Promise<readonly [boolean, boolean]> {
    const assetId = args.asset_id

    let metadataExists = true
    try {
      await this._box(assetId)
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

  async arc89_is_metadata_immutable(args: { asset_id: bigint | number }): Promise<boolean> {
    return (await this._box(args.asset_id)).header.isImmutable
  }

  async arc89_is_metadata_short(args: { asset_id: bigint | number }): Promise<readonly [boolean, bigint]> {
    const h = (await this._box(args.asset_id)).header
    return [h.isShort, h.lastModifiedRound]
  }

  async arc89_get_metadata_header(args: { asset_id: bigint | number }): Promise<MetadataHeader> {
    return (await this._box(args.asset_id)).header
  }

  async arc89_get_metadata_pagination(args: { asset_id: bigint | number }): Promise<Pagination> {
    const b = await this._box(args.asset_id)
    const size = b.body.size
    const pageSize = this.params.pageSize
    const totalPages = size === 0 ? 0 : Math.floor((size + pageSize - 1) / pageSize)
    return new Pagination({ metadataSize: size, pageSize, totalPages })
  }

  async arc89_get_metadata(args: { asset_id: bigint | number; page: number }): Promise<PaginatedMetadata> {
    if (!Number.isInteger(args.page)) {
      throw new TypeError('page must be an integer')
    }
    const b = await this._box(args.asset_id)
    const pages = paginate(b.body.rawBytes, this.params.pageSize)

    // Keep Python parity: if out of range, return empty content.
    if (args.page < 0 || args.page >= Math.max(1, pages.length)) {
      return new PaginatedMetadata({ hasNextPage: false, lastModifiedRound: b.header.lastModifiedRound, pageContent: new Uint8Array() })
    }

    const content = pages.length ? pages[args.page]! : new Uint8Array()
    const hasNext = args.page + 1 < pages.length
    return new PaginatedMetadata({ hasNextPage: hasNext, lastModifiedRound: b.header.lastModifiedRound, pageContent: content })
  }

  async arc89_get_metadata_slice(args: { asset_id: bigint | number; offset: number; size: number }): Promise<Uint8Array> {
    const b = await this._box(args.asset_id)
    if (!Number.isInteger(args.offset) || !Number.isInteger(args.size)) {
      throw new TypeError('offset and size must be integers')
    }
    if (args.offset < 0 || args.size < 0) return new Uint8Array()
    return b.body.rawBytes.slice(args.offset, args.offset + args.size)
  }

  async arc89_get_metadata_header_hash(args: { asset_id: bigint | number }): Promise<Uint8Array> {
    const b = await this._box(args.asset_id)
    return computeHeaderHash({
      assetId: b.assetId,
      metadataIdentifiers: b.header.identifiers,
      reversibleFlags: b.header.flags.reversibleByte,
      irreversibleFlags: b.header.flags.irreversibleByte,
      metadataSize: b.body.size,
    })
  }

  async arc89_get_metadata_page_hash(args: { asset_id: bigint | number; page: number }): Promise<Uint8Array> {
    const b = await this._box(args.asset_id)
    const pages = paginate(b.body.rawBytes, this.params.pageSize)
    if (!Number.isInteger(args.page) || args.page < 0 || args.page >= pages.length) return new Uint8Array()
    return computePageHash({ assetId: b.assetId, pageIndex: args.page, pageContent: pages[args.page]! })
  }

  /** On-chain method returns the header's stored metadata_hash. */
  async arc89_get_metadata_hash(args: { asset_id: bigint | number }): Promise<Uint8Array> {
    return (await this._box(args.asset_id)).header.metadataHash
  }

  // ------------------------------------------------------------------
  // Practical off-chain helpers
  // ------------------------------------------------------------------

  async get_asset_metadata_record(args: { asset_id: bigint | number }): Promise<AssetMetadataRecord> {
    return await this.algod.getAssetMetadataRecord({ appId: this.appId, assetId: args.asset_id, params: this.params })
  }

  async get_metadata_json(args: { asset_id: bigint | number }): Promise<JsonObject> {
    return (await this.get_asset_metadata_record(args)).json
  }

  async get_string_by_key(args: { asset_id: bigint | number; key: string }): Promise<string> {
    const obj = await this.get_metadata_json({ asset_id: args.asset_id })
    const v = obj[args.key]
    return typeof v === 'string' ? v : ''
  }

  /**
   * Returns a uint64-like value as bigint.
   */
  async get_uint64_by_key(args: { asset_id: bigint | number; key: string }): Promise<bigint> {
    const obj = await this.get_metadata_json({ asset_id: args.asset_id })
    const v = obj[args.key]
    if (typeof v === 'boolean') return v ? 1n : 0n
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return toBigInt(v)
    if (typeof v === 'bigint' && v >= 0n) return v
    return 0n
  }

  /**
   * Contract returns a JSON string for objects (limited by page size);
   * off-chain we just JSON.stringify the value when it is an object.
   */
  async get_object_by_key(args: { asset_id: bigint | number; key: string }): Promise<string> {
    const obj = await this.get_metadata_json({ asset_id: args.asset_id })
    const v = obj[args.key]
    try {
      return isPlainObject(v) ? (JSON.stringify(v) ?? '') : ''
    } catch {
      return ''
    }
  }

  async get_b64_bytes_by_key(args: {
    asset_id: bigint | number
    key: string
    b64_encoding: typeof enums.B64_STD_ENCODING | typeof enums.B64_URL_ENCODING
  }): Promise<Uint8Array> {
    const { asset_id, key, b64_encoding } = args
    if (b64_encoding !== enums.B64_STD_ENCODING && b64_encoding !== enums.B64_URL_ENCODING) {
      throw new RangeError('b64_encoding must be B64_STD_ENCODING or B64_URL_ENCODING')
    }

    const obj = await this.get_metadata_json({ asset_id })
    const v = obj[key]
    if (typeof v !== 'string') return new Uint8Array()

    try {
      // Node's Buffer supports both standard and urlsafe base64 strings.
      if (b64_encoding === enums.B64_URL_ENCODING) {
        return new Uint8Array(Buffer.from(v, 'base64url'))
      }
      return new Uint8Array(Buffer.from(v, 'base64'))
    } catch {
      return new Uint8Array()
    }
  }
}
