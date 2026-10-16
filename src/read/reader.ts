/**
 * Unified read dispatcher for ARC-89.
 *
 * Ported from Python `asa_metadata_registry/read/reader.py`.
 */

import { AlgodBoxReader } from '../algod'
import { Arc90Uri, completePartialAssetUrl } from '../codec'
import { deploymentForGenesis, netauthForGenesis, netauthMatchesGenesis } from '../deployments'
import { InvalidArc90UriError, MetadataDriftError, MissingAppClientError, RegistryResolutionError } from '../errors'
import {
  AssetMetadataRecord,
  MbrDelta,
  MetadataBody,
  MetadataExistence,
  MetadataHeader,
  MetadataSlice,
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
import { parsePaginatedMetadata, withArgs } from '../internal/avm'

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
 *
 * The registry identity always comes from the trusted side: the explicit `appId`, the configured
 * one, or the known deployment of the connected network (`DEFAULT_DEPLOYMENTS`), optionally
 * followed by newer trusted registry versions (`trustedVersions`, oldest first).
 */
export class AsaMetadataRegistryRead {
  public readonly appId: bigint | null
  public readonly algod: AlgodBoxReader | null
  public readonly avmFactory: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null
  /** ARC-90 netauth the registry is pinned to (e.g. "net:testnet"); null derives it from the network. */
  public readonly netauth: string | null
  /** Newer trusted ASA Metadata Registry versions, oldest first, after the trusted one. */
  public trustedVersions: readonly bigint[]

  private paramsCache: RegistryParameters | null = null
  /** Genesis hash of the connected network; `undefined` until fetched. */
  private genesisHashCache: string | null | undefined = undefined

  constructor(args: {
    appId?: bigint | number | null
    algod?: AlgodBoxReader | null
    avmFactory?: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null
    netauth?: string | null
    trustedVersions?: readonly (bigint | number)[]
  }) {
    this.appId = args.appId === undefined || args.appId === null ? null : asBigInt(args.appId, 'appId')
    this.algod = args.algod ?? null
    this.avmFactory = args.avmFactory ?? null
    this.netauth = args.netauth ?? null
    this.trustedVersions = (args.trustedVersions ?? []).map((v) => asBigInt(v, 'trustedVersions'))
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
        // Fall back to the compiled defaults without caching, so later reads retry.
        return getDefaultRegistryParams()
      }
    }

    const p = getDefaultRegistryParams()
    this.paramsCache = p
    return p
  }

  // ------------------------------------------------------------------
  // Sub-readers
  // ------------------------------------------------------------------

  /**
   * BOX reader bound to the configured registry app id.
   *
   * Synchronous accessor: it uses the registry parameters already fetched (or the compiled
   * defaults); the dispatcher methods resolve the on-chain parameters first, when AVM is available.
   */
  get box(): AsaMetadataRegistryBoxRead {
    if (!this.algod) throw new Error('BOX reader requires an algod client')
    const params = this.paramsCache ?? getDefaultRegistryParams()
    return new AsaMetadataRegistryBoxRead({ algod: this.algod, appId: this.requireAppId(), params })
  }

  /** BOX reader bound to the configured registry app id, with the resolved registry parameters. */
  private async boxReader(): Promise<AsaMetadataRegistryBoxRead> {
    if (!this.algod) throw new Error('BOX reader requires an algod client')
    const appId = this.requireAppId()
    return new AsaMetadataRegistryBoxRead({ algod: this.algod, appId, params: await this.getParams() })
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

  private async genesisHash(): Promise<string | null> {
    if (this.algod === null) return null
    if (this.genesisHashCache === undefined) this.genesisHashCache = await this.algod.getGenesisHashB64()
    return this.genesisHashCache
  }

  /** Explicit app id, else the configured one, else the deployment for the network. */
  private async trustedAppId(appId?: bigint | number | null): Promise<bigint | null> {
    if (appId !== undefined && appId !== null) return asBigInt(appId, 'appId')
    if (this.appId !== null) return this.appId
    const gh = await this.genesisHash()
    const deployment = gh !== null ? deploymentForGenesis(gh) : null
    return deployment?.appId != null ? BigInt(deployment.appId) : null
  }

  /** Trusted registry versions, oldest first: the trusted one, then `trustedVersions`. */
  private async trustedVersionsFor(appId?: bigint | number | null): Promise<readonly bigint[]> {
    const trusted = await this.trustedAppId(appId)
    const head = trusted === null ? [] : [trusted]
    return [...head, ...this.trustedVersions.filter((v) => v !== trusted)]
  }

  /** Reject a URI naming a registry or a network other than the trusted ones. */
  private async checkTrusted(uri: Arc90Uri, versions: readonly bigint[]): Promise<void> {
    if (versions.length === 0) {
      throw new RegistryResolutionError('No trusted registry for this network: configure or pass appId')
    }
    if (!versions.includes(uri.appId)) {
      throw new RegistryResolutionError(`URI names registry ${uri.appId}, trusted registry is ${versions.join(', ')}`)
    }
    if (this.netauth !== null) {
      if (uri.netauth !== this.netauth) {
        throw new RegistryResolutionError(
          `URI netauth ${JSON.stringify(uri.netauth)} does not match ${JSON.stringify(this.netauth)}`,
        )
      }
      return
    }
    const gh = await this.genesisHash()
    if (gh !== null && !netauthMatchesGenesis(uri.netauth, gh)) {
      throw new RegistryResolutionError(
        `URI netauth ${JSON.stringify(uri.netauth)} does not denote the connected network`,
      )
    }
  }

  /**
   * Resolve the ARC-90 URI for an asset, from an explicit URI or by the canonical look-up.
   *
   * The registry identity always comes from the trusted side (explicit `appId`, the
   * configured one, or the known deployment of the connected network): an explicit URI
   * naming another registry or network is rejected; the ASA's Asset URL is not read.
   *
   * @throws {RegistryResolutionError} If no trusted registry is available, or the URI names an
   * untrusted registry or network.
   * @throws {InvalidArc90UriError} If the Metadata URI is invalid or partial.
   * @throws {AsaNotFoundError} If the ASA does not exist (canonical look-up with algod).
   */
  async resolveArc90Uri(args: {
    assetId?: bigint | number | null
    metadataUri?: string | null
    appId?: bigint | number | null
  }): Promise<Arc90Uri> {
    const metadataUri = args.metadataUri ?? null
    const assetId = args.assetId ?? null

    const versions = await this.trustedVersionsFor(args.appId)
    const trusted = versions.length ? versions[0]! : null

    if (metadataUri) {
      const parsed = Arc90Uri.parse(metadataUri)
      if (parsed.assetId === null) {
        throw new InvalidArc90UriError('Metadata URI is partial; missing box value (asset id)')
      }
      await this.checkTrusted(parsed, versions)
      return parsed
    }

    if (assetId === null) {
      throw new RegistryResolutionError('Either assetId or metadataUri must be provided')
    }

    if (trusted === null) {
      throw new RegistryResolutionError('Cannot resolve registry appId from inputs')
    }
    if (this.algod !== null) {
      // Canonical look-up: the ASA must exist; its Asset URL is informational.
      await this.algod.getAssetInfo(assetId)
    }
    let netauth = this.netauth
    if (netauth === null) {
      const gh = await this.genesisHash()
      netauth = gh !== null ? netauthForGenesis(gh) : null
    }
    return new Arc90Uri({ netauth, appId: trusted, boxName: null }).withAssetId(assetId)
  }

  /**
   * Resolve the ARC-90 URI from an Asset URL the client already holds, without fetching
   * the ASA, or null if it is not an ARC-89 partial URI (use the canonical look-up).
   *
   * The Asset URL is informational: a URI naming another registry or network is rejected.
   *
   * @throws {RegistryResolutionError} If the Asset URL names an untrusted registry or network.
   */
  async resolveArc90UriFromAssetUrl(args: {
    assetId: bigint | number
    assetUrl: string
    appId?: bigint | number | null
  }): Promise<Arc90Uri | null> {
    let uri: Arc90Uri
    try {
      uri = Arc90Uri.parse(completePartialAssetUrl(args.assetUrl, args.assetId))
    } catch (e) {
      if (e instanceof InvalidArc90UriError) return null
      throw e
    }
    await this.checkTrusted(uri, await this.trustedVersionsFor(args.appId))
    return uri
  }

  // ------------------------------------------------------------------
  // High-level read
  // ------------------------------------------------------------------

  /**
   * Fetch a full ARC-89 metadata record (header + metadata bytes).
   *
   * When `source=AUTO`, the SDK prefers BOX reads (fast) if algod is available; otherwise AVM.
   * Non-atomic reads that observe a Revision change are retried up to `driftRetries` times.
   * The look-up and Deprecated By pointers stay within the trusted registry versions.
   *
   * @throws {RegistryResolutionError} If a Deprecated By pointer names an untrusted registry, or
   * the deprecation chain exceeds `maxDeprecationHops`.
   * @throws {MetadataDriftError} If the Metadata keeps changing across `driftRetries` retries.
   */
  async getAssetMetadata(args: {
    assetId?: bigint | number | null
    metadataUri?: string | null
    appId?: bigint | number | null
    source?: MetadataSource
    followDeprecation?: boolean
    maxDeprecationHops?: number
    simulate?: SimulateOptions
    driftRetries?: number
  }): Promise<AssetMetadataRecord> {
    const source = args.source ?? MetadataSource.AUTO
    const followDep = args.followDeprecation ?? true
    const maxHops = args.maxDeprecationHops ?? 5
    const driftRetries = args.driftRetries ?? 2
    if (!Number.isInteger(driftRetries) || !Number.isInteger(maxHops)) {
      throw new TypeError('driftRetries and maxDeprecationHops must be integers')
    }
    if (driftRetries < 0 || maxHops < 0) {
      throw new RangeError('driftRetries and maxDeprecationHops must be >= 0')
    }

    const uri = await this.resolveArc90Uri({
      assetId: args.assetId ?? null,
      metadataUri: args.metadataUri ?? null,
      appId: args.appId ?? null,
    })

    if (uri.assetId === null) throw new RegistryResolutionError('Resolved URI is partial (no asset id)')

    const versions = await this.trustedVersionsFor(args.appId)
    let currentAppId = uri.appId
    const currentAssetId = uri.assetId
    if ((args.metadataUri === undefined || args.metadataUri === null) && versions.length > 1) {
      // Canonical look-up: the oldest trusted version holding the record
      for (const v of versions) {
        if (await this.holdsRecord({ appId: v, assetId: currentAssetId, source, simulate: args.simulate })) {
          currentAppId = v
          break
        }
      }
    }

    for (let hop = 0; hop <= maxHops; hop++) {
      let record: AssetMetadataRecord | null = null
      for (let attempt = 0; attempt <= driftRetries; attempt++) {
        try {
          record = await this.getAssetMetadataOnce({
            appId: currentAppId,
            assetId: currentAssetId,
            source,
            simulate: args.simulate,
          })
          break
        } catch (e) {
          if (!(e instanceof MetadataDriftError) || attempt === driftRetries) throw e
        }
      }
      if (record === null) throw new RegistryResolutionError('Failed to fetch metadata')

      const target = record.header.deprecatedBy
      if (followDep && target !== 0n && target !== currentAppId) {
        if (!versions.includes(target)) {
          throw new RegistryResolutionError(`Deprecated By names untrusted registry ${target}`)
        }
        currentAppId = target
        continue
      }
      return record
    }

    throw new RegistryResolutionError(`Deprecation chain exceeded ${maxHops} hops (last registry ${currentAppId})`)
  }

  private async holdsRecord(args: {
    appId: bigint
    assetId: bigint
    source: MetadataSource
    simulate?: SimulateOptions
  }): Promise<boolean> {
    if (this.algod !== null && args.source !== MetadataSource.AVM) {
      const box = await this.algod.tryGetMetadataBox({
        appId: args.appId,
        assetId: args.assetId,
        params: await this.getParams(),
      })
      return box !== null
    }
    const existence = await this.avm({ appId: args.appId }).arc89CheckMetadataExists({
      assetId: args.assetId,
      simulate: args.simulate,
    })
    return existence.metadataExists
  }

  private async getAssetMetadataOnce(args: {
    appId: bigint
    assetId: bigint
    source: MetadataSource
    simulate?: SimulateOptions
  }): Promise<AssetMetadataRecord> {
    const params = await this.getParams()
    let source = args.source

    if (source === MetadataSource.AUTO) {
      if (this.algod) source = MetadataSource.BOX
      else if (this.avmFactory) source = MetadataSource.AVM
      else throw new RegistryResolutionError('No read source available (need algod or avm)')
    }

    if (source === MetadataSource.BOX) {
      if (!this.algod) throw new Error('BOX source selected but algod is not configured')
      return await this.algod.getAssetMetadataRecord({ appId: args.appId, assetId: args.assetId, params })
    }

    if (source === MetadataSource.AVM) {
      const avm = this.avm({ appId: args.appId })
      const header = await avm.arc89GetMetadataHeader({ assetId: args.assetId, simulate: args.simulate })
      const pagination = await avm.arc89GetMetadataPagination({ assetId: args.assetId, simulate: args.simulate })
      if (pagination.revision !== header.revision) {
        throw new MetadataDriftError('Metadata changed between header and pagination reads')
      }

      // Fetch pages in batches (max 16 tx/group in Algorand; keep a safe default of 10).
      const totalPages = pagination.totalPages
      const batchSize = 10
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
          if (paged.revision !== header.revision) {
            throw new MetadataDriftError('Metadata changed between simulated page reads')
          }
          chunks.push(paged.pageContent)
        }
      }

      const bodyRaw = concatBytes(chunks)
      if (bodyRaw.length !== pagination.metadataSize) {
        throw new MetadataDriftError('Assembled metadata size does not match the pagination size')
      }
      const body = new MetadataBody(bodyRaw)

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

  async arc89GetMetadataPartialUri(args?: { source?: MetadataSource; simulate?: SimulateOptions }): Promise<string> {
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
      const [asaExists, metadataExists] = await (
        await this.boxReader()
      ).arc89CheckMetadataExists({ assetId: args.assetId })
      return new MetadataExistence({ asaExists, metadataExists })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89CheckMetadataExists({
      assetId: args.assetId,
      simulate: args.simulate,
    })
  }

  async arc89IsMetadataImmutable(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<boolean> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (await this.boxReader()).arc89IsMetadataImmutable({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89IsMetadataImmutable({
      assetId: args.assetId,
      simulate: args.simulate,
    })
  }

  async arc89IsMetadataShort(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<readonly [isShort: boolean, revision: bigint]> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (await this.boxReader()).arc89IsMetadataShort({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89IsMetadataShort({
      assetId: args.assetId,
      simulate: args.simulate,
    })
  }

  async arc89GetMetadataHeader(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<MetadataHeader> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (await this.boxReader()).arc89GetMetadataHeader({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataHeader({
      assetId: args.assetId,
      simulate: args.simulate,
    })
  }

  async arc89GetMetadataPagination(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<Pagination> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (await this.boxReader()).arc89GetMetadataPagination({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataPagination({
      assetId: args.assetId,
      simulate: args.simulate,
    })
  }

  async arc89GetMetadata(args: {
    assetId: bigint | number
    page: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<PaginatedMetadata> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (await this.boxReader()).arc89GetMetadata({ assetId: args.assetId, page: args.page })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadata({
      assetId: args.assetId,
      page: args.page,
      simulate: args.simulate,
    })
  }

  async arc89GetMetadataSlice(args: {
    assetId: bigint | number
    offset: number
    size: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<MetadataSlice> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (
        await this.boxReader()
      ).arc89GetMetadataSlice({ assetId: args.assetId, offset: args.offset, size: args.size })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataSlice({
      assetId: args.assetId,
      offset: args.offset,
      size: args.size,
      simulate: args.simulate,
    })
  }

  /** @returns The Metadata Header Hash and the Revision it was computed at. */
  async arc89GetMetadataHeaderHash(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<readonly [hash: Uint8Array, revision: bigint]> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (await this.boxReader()).arc89GetMetadataHeaderHash({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataHeaderHash({
      assetId: args.assetId,
      simulate: args.simulate,
    })
  }

  /** @returns The page hash and the Revision it was computed at. */
  async arc89GetMetadataPageHash(args: {
    assetId: bigint | number
    page: number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<readonly [hash: Uint8Array, revision: bigint]> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (await this.boxReader()).arc89GetMetadataPageHash({ assetId: args.assetId, page: args.page })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataPageHash({
      assetId: args.assetId,
      page: args.page,
      simulate: args.simulate,
    })
  }

  /** @returns The Metadata Hash and the Revision it was computed at. */
  async arc89GetMetadataHash(args: {
    assetId: bigint | number
    source?: MetadataSource
    simulate?: SimulateOptions
  }): Promise<readonly [hash: Uint8Array, revision: bigint]> {
    const source = args.source ?? MetadataSource.AUTO

    if (source === MetadataSource.BOX || (source === MetadataSource.AUTO && this.algod)) {
      return await (await this.boxReader()).arc89GetMetadataHash({ assetId: args.assetId })
    }

    return await this.avm({ appId: this.requireAppId() }).arc89GetMetadataHash({
      assetId: args.assetId,
      simulate: args.simulate,
    })
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

    return await (await this.boxReader()).getStringByKey({ assetId: args.assetId, key: args.key })
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

    return await (await this.boxReader()).getUint64ByKey({ assetId: args.assetId, key: args.key })
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

    return await (await this.boxReader()).getObjectByKey({ assetId: args.assetId, key: args.key })
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

    return await (
      await this.boxReader()
    ).getB64BytesByKey({ assetId: args.assetId, key: args.key, b64Encoding: args.b64Encoding })
  }
}
