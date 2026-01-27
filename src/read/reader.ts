/**
 * Unified read dispatcher for ARC-89.
 *
 * Ported from Python `asa_metadata_registry/read/reader.py`.
 *
 * - AUTO prefers BOX (fast, direct box reads) when Algod is available; otherwise AVM (simulate).
 * - BOX reconstructs getter results from box values.
 * - AVM uses the generated AppClient + simulate for smart-contract parity.
 */

import { AlgodBoxReader } from '../algod'
import { Arc90Uri } from '../codec'
import {
  InvalidArc90UriError,
  MetadataDriftError,
  MissingAppClientError,
  RegistryResolutionError,
} from '../errors'
import {
  AssetMetadataRecord,
  MbrDelta,
  MetadataBody,
  MetadataExistence,
  MetadataHeader,
  PaginatedMetadata,
  Pagination,
  RegistryParameters,
  getDefaultRegistryParams,
} from '../models'
import { AsaMetadataRegistryAvmRead, SimulateOptions } from './avm'
import { AsaMetadataRegistryBoxRead } from './box'

const asBigInt = (v: bigint | number | null | undefined, label: string): bigint => {
  if (v === null || v === undefined) throw new TypeError(`${label} is required`)
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  throw new TypeError(`${label} must be bigint | number`)
}

const toBigInt = (v: unknown, label: string): bigint => {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v)
  throw new TypeError(`${label} must be uint64 (bigint)`)
}

const toUint8Array = (v: unknown, label: string): Uint8Array => {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (Array.isArray(v)) return Uint8Array.from(v)

  const B = (globalThis as any).Buffer
  if (B && typeof B.isBuffer === 'function' && B.isBuffer(v)) return new Uint8Array(v)

  if (v && typeof v === 'object' && 'buffer' in (v as any) && (v as any).buffer instanceof ArrayBuffer) {
    const view = v as any
    return new Uint8Array(view.buffer, view.byteOffset ?? 0, view.byteLength ?? view.length)
  }

  throw new TypeError(`${label} must be bytes (Uint8Array)`)
}

const toPaginatedMetadata = (v: unknown): PaginatedMetadata => {
  if (Array.isArray(v)) return PaginatedMetadata.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('PaginatedMetadata must be a tuple or struct')
  const o = v as any
  return new PaginatedMetadata({
    hasNextPage: Boolean(o.hasNextPage),
    lastModifiedRound: toBigInt(o.lastModifiedRound, 'last_modified_round'),
    pageContent: toUint8Array(o.pageContent, 'page_content'),
  })
}

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

const withArgs = (params: unknown | undefined, args: unknown[]) => {
  const p = params && typeof params === 'object' ? { ...(params as any) } : {}
  ;(p as any).args = args
  return p
}

export enum MetadataSource {
  /** Prefer BOX when possible, otherwise AVM. */
  AUTO = 'auto',
  /** Reconstruct from box value using Algod. */
  BOX = 'box',
  /** Use the generated AppClient + simulate for contract parity. */
  AVM = 'avm',
}

/**
 * Unified read API for ARC-89.
 */
export class AsaMetadataRegistryRead {
  public readonly appId: bigint | null
  public readonly algod: AlgodBoxReader | null
  public readonly avmFactory: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null

  private _paramsCache: RegistryParameters | null = null

  constructor(args: {
    appId?: bigint | number | null
    algod?: AlgodBoxReader | null
    avmFactory?: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null
  }) {
    this.appId = args.appId === undefined || args.appId === null ? null : asBigInt(args.appId, 'app_id')
    this.algod = args.algod ?? null
    this.avmFactory = args.avmFactory ?? null
  }

  private _requireAppId(appId?: bigint | number | null): bigint {
    const resolved = appId === undefined || appId === null ? this.appId : asBigInt(appId, 'app_id')
    if (resolved === null) {
      throw new RegistryResolutionError('Registry app_id is not configured and was not provided')
    }
    return resolved
  }

  private async _getParams(): Promise<RegistryParameters> {
    if (this._paramsCache) return this._paramsCache

    // Prefer on-chain params if AVM access is available.
    if (this.avmFactory !== null && this.appId !== null) {
      try {
        const p = await this.avm({ app_id: this.appId }).arc89_get_metadata_registry_parameters()
        this._paramsCache = p
        return p
      } catch {
        // Fall back to defaults.
      }
    }

    const p = getDefaultRegistryParams()
    this._paramsCache = p
    return p
  }

  // ------------------------------------------------------------------
  // Sub-readers
  // ------------------------------------------------------------------

  /** BOX reader bound to the configured registry app id. */
  get box(): AsaMetadataRegistryBoxRead {
    if (!this.algod) throw new RuntimeError('BOX reader requires an algod client')
    const params = this._paramsCache ?? getDefaultRegistryParams()
    return new AsaMetadataRegistryBoxRead({ algod: this.algod, appId: this._requireAppId(), params })
  }

  /** AVM reader bound to the requested registry app id (defaults to configured app id). */
  avm(args?: { app_id?: bigint | number | null }): AsaMetadataRegistryAvmRead {
    const resolved = this._requireAppId(args?.app_id ?? null)
    if (!this.avmFactory) {
      throw new MissingAppClientError('AVM reader requires a generated AppClient (avmFactory)')
    }
    return this.avmFactory(resolved)
  }

  // ------------------------------------------------------------------
  // Locator / discovery
  // ------------------------------------------------------------------

  /**
   * Resolve the ARC-90 URI for an asset from either an explicit URI or the ASA's `url` field.
   */
  async resolve_arc90_uri(args: {
    asset_id?: bigint | number | null
    metadata_uri?: string | null
    app_id?: bigint | number | null
  }): Promise<Arc90Uri> {
    const metadataUri = args.metadata_uri ?? null
    const assetId = args.asset_id ?? null

    if (metadataUri) {
      const parsed = Arc90Uri.parse(metadataUri)
      if (parsed.assetId === null) {
        throw new InvalidArc90UriError('Metadata URI is partial; missing box value (asset id)')
      }
      return parsed
    }

    if (assetId === null) {
      throw new RegistryResolutionError('Either asset_id or metadata_uri must be provided')
    }

    // Best UX: try resolving from the ASA url (if algod is configured).
    if (this.algod) {
      try {
        return await this.algod.resolveMetadataUriFromAsset({ assetId })
      } catch (e) {
        if (!(e instanceof InvalidArc90UriError)) throw e
      }
    }

    const resolvedAppId = args.app_id ?? this.appId
    if (resolvedAppId === null || resolvedAppId === undefined) {
      throw new RegistryResolutionError('Cannot resolve registry app_id from inputs or ASA url')
    }

    return new Arc90Uri({ netauth: null, appId: resolvedAppId, boxName: null }).withAssetId(assetId)
  }

  // ------------------------------------------------------------------
  // High-level read
  // ------------------------------------------------------------------

  /**
   * Fetch a full ARC-89 metadata record (header + metadata bytes).
   */
  async get_asset_metadata(args: {
    asset_id?: bigint | number | null
    metadata_uri?: string | null
    app_id?: bigint | number | null
    source?: MetadataSource
    follow_deprecation?: boolean
    max_deprecation_hops?: number
    simulate?: SimulateOptions
  }): Promise<AssetMetadataRecord> {
    const source = args.source ?? MetadataSource.AUTO
    const followDep = args.follow_deprecation ?? true
    const maxHops = args.max_deprecation_hops ?? 5

    const uri = await this.resolve_arc90_uri({
      asset_id: args.asset_id ?? null,
      metadata_uri: args.metadata_uri ?? null,
      app_id: args.app_id ?? null,
    })

    if (uri.assetId === null) throw new RegistryResolutionError('Resolved URI is partial (no asset id)')

    let currentAppId = uri.appId
    const currentAssetId = uri.assetId

    let record: AssetMetadataRecord | null = null

    for (let hop = 0; hop <= maxHops; hop++) {
      record = await this._get_asset_metadata_once({
        app_id: currentAppId,
        asset_id: currentAssetId,
        source,
        simulate: args.simulate,
      })

      if (followDep) {
        const deprecatedBy = record.header.deprecatedBy
        if (deprecatedBy !== 0n && deprecatedBy !== currentAppId) {
          currentAppId = deprecatedBy
          continue
        }
      }

      return record
    }

    // exceeded hop count; return the last fetched record
    if (!record) throw new RegistryResolutionError('Failed to fetch metadata')
    return record
  }

  private async _get_asset_metadata_once(args: {
    app_id: bigint
    asset_id: bigint
    source: MetadataSource
    simulate?: SimulateOptions
  }): Promise<AssetMetadataRecord> {
    let source = args.source

    if (source === MetadataSource.AUTO) {
      if (this.algod) source = MetadataSource.BOX
      else if (this.avmFactory) source = MetadataSource.AVM
      else throw new RegistryResolutionError('No read source available (need algod or avm)')
    }

    if (source === MetadataSource.BOX) {
      if (!this.algod) throw new RuntimeError('BOX source selected but algod is not configured')
      const params = await this._getParams()
      return await this.algod.getAssetMetadataRecord({ appId: args.app_id, assetId: args.asset_id, params })
    }

    if (source === MetadataSource.AVM) {
      const avm = this.avm({ app_id: args.app_id })
      const header = await avm.arc89_get_metadata_header({ asset_id: args.asset_id, simulate: args.simulate })
      const pagination = await avm.arc89_get_metadata_pagination({ asset_id: args.asset_id, simulate: args.simulate })

      const totalPages = pagination.totalPages
      const batchSize = 10

      let lastRound: bigint | null = null
      const chunks: Uint8Array[] = []

      for (let start = 0; start < totalPages; start += batchSize) {
        const end = Math.min(totalPages, start + batchSize)

        const values = await avm.simulate_many(
          (c) => {
            for (let i = start; i < end; i++) {
              c.arc89GetMetadata(withArgs(undefined, [args.asset_id, i]))
            }
          },
          { simulate: args.simulate },
        )

        for (const v of values) {
          const paged = toPaginatedMetadata(v)
          if (lastRound === null) lastRound = paged.lastModifiedRound
          else if (paged.lastModifiedRound !== lastRound) {
            throw new MetadataDriftError('Metadata changed between simulated page reads')
          }
          chunks.push(paged.pageContent)
        }
      }

      const bodyRaw = concatBytes(chunks)
      const body = new MetadataBody(bodyRaw.slice(0, pagination.metadataSize))

      return new AssetMetadataRecord({ appId: args.app_id, assetId: args.asset_id, header, body })
    }

    throw new Error(`Unknown MetadataSource: ${String(source)}`)
  }

  // ------------------------------------------------------------------
  // Dispatcher versions of contract getters
  // ------------------------------------------------------------------

  async arc89_get_metadata_registry_parameters(args?: {
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<RegistryParameters> {
    const source = args?.source ?? MetadataSource.AUTO

    if ((source === MetadataSource.AUTO || source === MetadataSource.AVM) && this.avmFactory && this.appId !== null) {
      const p = await this.avm({ app_id: this.appId }).arc89_get_metadata_registry_parameters({ simulate: args?.simulate })
      this._paramsCache = p
      return p
    }

    return await this._getParams()
  }

  async arc89_get_metadata_partial_uri(args?: {
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<string> {
    const source = args?.source ?? MetadataSource.AUTO

    if ((source === MetadataSource.AUTO || source === MetadataSource.AVM) && this.avmFactory && this.appId !== null) {
      return await this.avm({ app_id: this.appId }).arc89_get_metadata_partial_uri({ simulate: args?.simulate })
    }

    throw new MissingAppClientError('get_metadata_partial_uri requires AVM access (simulate)')
  }

  async arc89_get_metadata_mbr_delta(args: {
    asset_id: bigint | number
    new_size: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<MbrDelta> {
    const source = args.source ?? MetadataSource.AVM
    if (source !== MetadataSource.AVM) throw new Error('MBR delta getter is AVM-only; use AVM source')
    return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_mbr_delta({
      asset_id: args.asset_id,
      new_size: args.new_size,
      simulate: args.simulate,
    })
  }

  async arc89_check_metadata_exists(args: {
    asset_id: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<MetadataExistence> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      const [asaExists, metadataExists] = await this.box.arc89_check_metadata_exists({ asset_id: args.asset_id })
      return new MetadataExistence({ asaExists, metadataExists })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_check_metadata_exists({ asset_id: args.asset_id, simulate: args.simulate })
  }

  async arc89_is_metadata_immutable(args: {
    asset_id: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<boolean> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_is_metadata_immutable({ asset_id: args.asset_id })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_is_metadata_immutable({ asset_id: args.asset_id, simulate: args.simulate })
  }

  async arc89_is_metadata_short(args: {
    asset_id: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<readonly [boolean, bigint]> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_is_metadata_short({ asset_id: args.asset_id })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_is_metadata_short({ asset_id: args.asset_id, simulate: args.simulate })
  }

  async arc89_get_metadata_header(args: {
    asset_id: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<MetadataHeader> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_get_metadata_header({ asset_id: args.asset_id })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_header({ asset_id: args.asset_id, simulate: args.simulate })
  }

  async arc89_get_metadata_pagination(args: {
    asset_id: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Pagination> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_get_metadata_pagination({ asset_id: args.asset_id })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_pagination({ asset_id: args.asset_id, simulate: args.simulate })
  }

  async arc89_get_metadata(args: {
    asset_id: bigint | number
    page: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<PaginatedMetadata> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_get_metadata({ asset_id: args.asset_id, page: args.page })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata({ asset_id: args.asset_id, page: args.page, simulate: args.simulate })
  }

  async arc89_get_metadata_slice(args: {
    asset_id: bigint | number
    offset: number
    size: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_get_metadata_slice({ asset_id: args.asset_id, offset: args.offset, size: args.size })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_slice({
      asset_id: args.asset_id,
      offset: args.offset,
      size: args.size,
      simulate: args.simulate,
    })
  }

  async arc89_get_metadata_header_hash(args: {
    asset_id: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_get_metadata_header_hash({ asset_id: args.asset_id })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_header_hash({ asset_id: args.asset_id, simulate: args.simulate })
  }

  async arc89_get_metadata_page_hash(args: {
    asset_id: bigint | number
    page: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_get_metadata_page_hash({ asset_id: args.asset_id, page: args.page })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_page_hash({ asset_id: args.asset_id, page: args.page, simulate: args.simulate })
  }

  async arc89_get_metadata_hash(args: {
    asset_id: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89_get_metadata_hash({ asset_id: args.asset_id })
    }

    return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_hash({ asset_id: args.asset_id, simulate: args.simulate })
  }

  async arc89_get_metadata_string_by_key(args: {
    asset_id: bigint | number
    key: string
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<string> {
    const source = args.source ?? MetadataSource.AUTO

    // AUTO: prefer AVM for parity, but fall back to off-chain JSON if AVM is not configured.
    if (source === MetadataSource.AVM || (source === MetadataSource.AUTO && this.avmFactory !== null)) {
      return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_string_by_key({
        asset_id: args.asset_id,
        key: args.key,
        simulate: args.simulate,
      })
    }

    return await this.box.get_string_by_key({ asset_id: args.asset_id, key: args.key })
  }

  async arc89_get_metadata_uint64_by_key(args: {
    asset_id: bigint | number
    key: string
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<bigint> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.AVM || (source === MetadataSource.AUTO && this.avmFactory !== null)) {
      return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_uint64_by_key({
        asset_id: args.asset_id,
        key: args.key,
        simulate: args.simulate,
      })
    }

    return await this.box.get_uint64_by_key({ asset_id: args.asset_id, key: args.key })
  }

  async arc89_get_metadata_object_by_key(args: {
    asset_id: bigint | number
    key: string
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<string> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.AVM || (source === MetadataSource.AUTO && this.avmFactory !== null)) {
      return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_object_by_key({
        asset_id: args.asset_id,
        key: args.key,
        simulate: args.simulate,
      })
    }

    return await this.box.get_object_by_key({ asset_id: args.asset_id, key: args.key })
  }

  async arc89_get_metadata_b64_bytes_by_key(args: {
    asset_id: bigint | number
    key: string
    b64_encoding: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.AVM || (source === MetadataSource.AUTO && this.avmFactory !== null)) {
      return await this.avm({ app_id: this._requireAppId() }).arc89_get_metadata_b64_bytes_by_key({
        asset_id: args.asset_id,
        key: args.key,
        b64_encoding: args.b64_encoding,
        simulate: args.simulate,
      })
    }

    return await this.box.get_b64_bytes_by_key({ asset_id: args.asset_id, key: args.key, b64_encoding: args.b64_encoding as any })
  }
}

class RuntimeError extends Error {}
