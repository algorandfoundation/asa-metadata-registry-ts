/**
 * Unified read dispatcher for ARC-89.
 *
 * Ported from Python `asa_metadata_registry/read/reader.py`.
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
import * as enums from '../enums'
import { asBigInt } from '../internal/numbers'
import { concatBytes } from '../internal/bytes'
import { AsaMetadataRegistryAvmRead, SimulateOptions } from './avm'
import { AsaMetadataRegistryBoxRead } from './box'
import { parsePaginatedMetadata, withArgs } from './utils'

/**
 * Where reads should come from.
 *
 * - AUTO: prefer BOX when possible (fast), otherwise AVM (simulate)
 * - BOX: reconstruct from box value using Algod
 * - AVM: use the generated AppClient + simulate for smart-contract parity
 */
export enum MetadataSource {
  AUTO = 'auto',
  BOX = 'box',
  AVM = 'avm',
}

/**
 * Unified read API for ARC-89.
 *
 * Exposes:
 * - `.box` for fast Algod box reconstruction
 * - `.avm` for AVM-parity getters via simulate (if configured)
 * - dispatcher methods that accept `source=...`
 */
export class AsaMetadataRegistryRead {
  public readonly appId: bigint | null
  public readonly algod: AlgodBoxReader | null
  public readonly avmFactory: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null

  private paramsCache: RegistryParameters | null = null

  constructor(args: {
    appId?: bigint | number | null
    algod?: AlgodBoxReader | null
    avmFactory?: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null
  }) {
    this.appId = args.appId === undefined || args.appId === null ? null : asBigInt(args.appId, 'appId')
    this.algod = args.algod ?? null
    this.avmFactory = args.avmFactory ?? null
  }

  private requireAppId(appId?: bigint | number | null): bigint {
    const resolved = appId === undefined || appId === null ? this.appId : asBigInt(appId, 'appId')
    if (resolved === null) {
      throw new RegistryResolutionError('Registry appId is not configured and was not provided')
    }
    return resolved
  }

  private async getParams(): Promise<RegistryParameters> {
    if (this.paramsCache) return this.paramsCache

    // Prefer on-chain params if AVM access is available.
    if (this.avmFactory !== null && this.appId !== null) {
      try {
        const p = await this.avm({ appId: this.appId }).arc89GetMetadataRegistryParameters()
        this.paramsCache = p
        return p
      } catch {
        // Fall back to defaults.
      }
    }

    const p = getDefaultRegistryParams()
    this.paramsCache = p
    return p
  }

  // ------------------------------------------------------------------
  // Sub-readers
  // ------------------------------------------------------------------

  /** BOX reader bound to the configured registry app id. */
  get box(): AsaMetadataRegistryBoxRead {
    if (!this.algod) throw new Error('BOX reader requires an algod client')
    const params = this.paramsCache ?? getDefaultRegistryParams()
    return new AsaMetadataRegistryBoxRead({ algod: this.algod, appId: this.requireAppId(), params })
  }

  /** AVM reader bound to the requested registry app id (defaults to configured app id). */
  avm(args?: { appId?: bigint | number | null }): AsaMetadataRegistryAvmRead {
    const resolved = this.requireAppId(args?.appId ?? null)
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
   *
   * If `metadataUri` is provided, it's parsed and returned.
   *
   * If only `assetId` is provided, the SDK attempts:
   * 1) ASA url -> ARC-89 partial URI completion (requires algod)
   * 2) configured `appId` (if present)
   */
  async resolveArc90Uri(args: {
    assetId?: bigint | number | null
    metadataUri?: string | null
    appId?: bigint | number | null
  }): Promise<Arc90Uri> {
    const metadataUri = args.metadataUri ?? null
    const assetId = args.assetId ?? null

    if (metadataUri) {
      const parsed = Arc90Uri.parse(metadataUri)
      if (parsed.assetId === null) {
        throw new InvalidArc90UriError('Metadata URI is partial; missing box value (asset id)')
      }
      return parsed
    }

    if (assetId === null) {
      throw new RegistryResolutionError('Either assetId or metadataUri must be provided')
    }

    // Best UX: try resolving from the ASA url (if algod is configured).
    if (this.algod) {
      try {
        return await this.algod.resolveMetadataUriFromAsset({ assetId })
      } catch (e) {
        if (!(e instanceof InvalidArc90UriError)) throw e
      }
    }

    const resolvedAppId = args.appId ?? this.appId
    if (resolvedAppId === null || resolvedAppId === undefined) {
      throw new RegistryResolutionError('Cannot resolve registry appId from inputs or ASA url')
    }

    return new Arc90Uri({ netauth: null, appId: resolvedAppId, boxName: null }).withAssetId(assetId)
  }

  // ------------------------------------------------------------------
  // High-level read
  // ------------------------------------------------------------------

  /**
   * Fetch a full ARC-89 metadata record (header + metadata bytes).
   *
   * When `source=AUTO`, the SDK prefers BOX reads (fast) if algod is available; otherwise AVM.
   */
  async getAssetMetadata(args: {
    assetId?: bigint | number | null
    metadataUri?: string | null
    appId?: bigint | number | null
    source?: MetadataSource
    followDeprecation?: boolean
    maxDeprecationHops?: number
    simulate?: SimulateOptions
  }): Promise<AssetMetadataRecord> {
    const source = args.source ?? MetadataSource.AUTO
    const followDep = args.followDeprecation ?? true
    const maxHops = args.maxDeprecationHops ?? 5

    const uri = await this.resolveArc90Uri({
      assetId: args.assetId ?? null,
      metadataUri: args.metadataUri ?? null,
      appId: args.appId ?? null,
    })

    if (uri.assetId === null) throw new RegistryResolutionError('Resolved URI is partial (no asset id)')

    let currentAppId = uri.appId
    const currentAssetId = uri.assetId

    let record: AssetMetadataRecord | null = null

    for (let hop = 0; hop <= maxHops; hop++) {
      record = await this.getAssetMetadataOnce({
        appId: currentAppId,
        assetId: currentAssetId,
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

  private async getAssetMetadataOnce(args: {
    appId: bigint
    assetId: bigint
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
      if (!this.algod) throw new Error('BOX source selected but algod is not configured')
      const params = await this.getParams()
      return await this.algod.getAssetMetadataRecord({ appId: args.appId, assetId: args.assetId, params })
    }

    if (source === MetadataSource.AVM) {
      const avm = this.avm({ appId: args.appId })
      const header = await avm.arc89GetMetadataHeader({ assetId: args.assetId, simulate: args.simulate })
      const pagination = await avm.arc89GetMetadataPagination({ assetId: args.assetId, simulate: args.simulate })

      const totalPages = pagination.totalPages
      const batchSize = 10

      let lastRound: bigint | null = null
      const chunks: Uint8Array[] = []

      for (let start = 0; start < totalPages; start += batchSize) {
        const end = Math.min(totalPages, start + batchSize)

        const values = await avm.simulateMany(
          (c) => {
            for (let i = start; i < end; i++) {
              c.arc89GetMetadata(withArgs(undefined, [args.assetId, i]))
            }
          },
          { simulate: args.simulate },
        )

        for (const v of values) {
          const paged = parsePaginatedMetadata(v)
          if (lastRound === null) lastRound = paged.lastModifiedRound
          else if (paged.lastModifiedRound !== lastRound) {
            throw new MetadataDriftError('Metadata changed between simulated page reads')
          }
          chunks.push(paged.pageContent)
        }
      }

      const bodyRaw = concatBytes(chunks)
      const body = new MetadataBody(bodyRaw.slice(0, pagination.metadataSize))

      return new AssetMetadataRecord({ appId: args.appId, assetId: args.assetId, header, body })
    }

    throw new Error(`Unknown MetadataSource: ${String(source)}`)
  }

  // ------------------------------------------------------------------
  // Dispatcher versions of contract getters
  // ------------------------------------------------------------------

  async arc89GetMetadataRegistryParameters(args?: {
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<RegistryParameters> {
    const source = args?.source ?? MetadataSource.AUTO

    if ((source === MetadataSource.AUTO || source === MetadataSource.AVM) && this.avmFactory && this.appId !== null) {
      const p = await this.avm({ appId: this.appId }).arc89GetMetadataRegistryParameters({ simulate: args?.simulate })
      this.paramsCache = p
      return p
    }

    return await this.getParams()
  }

  async arc89GetMetadataPartialUri(args?: {
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<string> {
    const source = args?.source ?? MetadataSource.AUTO

    if ((source === MetadataSource.AUTO || source === MetadataSource.AVM) && this.avmFactory && this.appId !== null) {
      return await this.avm({ appId: this.appId }).arc89GetMetadataPartialUri({ simulate: args?.simulate })
    }

    throw new MissingAppClientError('getMetadataPartialUri requires AVM access (simulate)')
  }

  async arc89GetMetadataMbrDelta(args: {
    assetId: bigint | number
    newSize: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<MbrDelta> {
    const source = args.source ?? MetadataSource.AVM
    if (source !== MetadataSource.AVM) throw new Error('MBR delta getter is AVM-only; use AVM source')
    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataMbrDelta({
      assetId: args.assetId,
      newSize: args.newSize,
      simulate: args.simulate,
    })
  }

  async arc89CheckMetadataExists(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<MetadataExistence> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      const [asaExists, metadataExists] = await this.box.arc89CheckMetadataExists({ assetId: args.assetId })
      return new MetadataExistence({ asaExists, metadataExists })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89CheckMetadataExists({ assetId: args.assetId, simulate: args.simulate })
  }

  async arc89IsMetadataImmutable(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<boolean> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89IsMetadataImmutable({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89IsMetadataImmutable({ assetId: args.assetId, simulate: args.simulate })
  }

  async arc89IsMetadataShort(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<readonly [boolean, bigint]> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89IsMetadataShort({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89IsMetadataShort({ assetId: args.assetId, simulate: args.simulate })
  }

  async arc89GetMetadataHeader(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<MetadataHeader> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89GetMetadataHeader({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataHeader({ assetId: args.assetId, simulate: args.simulate })
  }

  async arc89GetMetadataPagination(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Pagination> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89GetMetadataPagination({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataPagination({ assetId: args.assetId, simulate: args.simulate })
  }

  async arc89GetMetadata(args: {
    assetId: bigint | number
    page: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<PaginatedMetadata> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89GetMetadata({ assetId: args.assetId, page: args.page })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadata({ assetId: args.assetId, page: args.page, simulate: args.simulate })
  }

  async arc89GetMetadataSlice(args: {
    assetId: bigint | number
    offset: number
    size: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89GetMetadataSlice({ assetId: args.assetId, offset: args.offset, size: args.size })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataSlice({
      assetId: args.assetId,
      offset: args.offset,
      size: args.size,
      simulate: args.simulate,
    })
  }

  async arc89GetMetadataHeaderHash(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89GetMetadataHeaderHash({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataHeaderHash({ assetId: args.assetId, simulate: args.simulate })
  }

  async arc89GetMetadataPageHash(args: {
    assetId: bigint | number
    page: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89GetMetadataPageHash({ assetId: args.assetId, page: args.page })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataPageHash({ assetId: args.assetId, page: args.page, simulate: args.simulate })
  }

  async arc89GetMetadataHash(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await this.box.arc89GetMetadataHash({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataHash({ assetId: args.assetId, simulate: args.simulate })
  }

  async arc89GetMetadataStringByKey(args: {
    assetId: bigint | number
    key: string
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<string> {
    const source = args.source ?? MetadataSource.AUTO

    // AUTO: prefer AVM for parity, but fall back to off-chain JSON if AVM is not configured.
    if (source === MetadataSource.AVM || (source === MetadataSource.AUTO && this.avmFactory !== null)) {
      return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataStringByKey({
        assetId: args.assetId,
        key: args.key,
        simulate: args.simulate,
      })
    }

    return await this.box.getStringByKey({ assetId: args.assetId, key: args.key })
  }

  async arc89GetMetadataUint64ByKey(args: {
    assetId: bigint | number
    key: string
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<bigint> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.AVM || (source === MetadataSource.AUTO && this.avmFactory !== null)) {
      return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataUint64ByKey({
        assetId: args.assetId,
        key: args.key,
        simulate: args.simulate,
      })
    }

    return await this.box.getUint64ByKey({ assetId: args.assetId, key: args.key })
  }

  async arc89GetMetadataObjectByKey(args: {
    assetId: bigint | number
    key: string
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<string> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.AVM || (source === MetadataSource.AUTO && this.avmFactory !== null)) {
      return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataObjectByKey({
        assetId: args.assetId,
        key: args.key,
        simulate: args.simulate,
      })
    }

    return await this.box.getObjectByKey({ assetId: args.assetId, key: args.key })
  }

  async arc89GetMetadataB64BytesByKey(args: {
    assetId: bigint | number
    key: string
    b64Encoding: typeof enums.B64_STD_ENCODING | typeof enums.B64_URL_ENCODING
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Uint8Array> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.AVM || (source === MetadataSource.AUTO && this.avmFactory !== null)) {
      return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataB64BytesByKey({
        assetId: args.assetId,
        key: args.key,
        b64Encoding: args.b64Encoding,
        simulate: args.simulate,
      })
    }

    return await this.box.getB64BytesByKey({ assetId: args.assetId, key: args.key, b64Encoding: args.b64Encoding })
  }
}
