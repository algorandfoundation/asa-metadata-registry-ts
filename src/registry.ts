/**
 * Facade over the ARC-89 read/write APIs.
 *
 * Ported from Python `asa_metadata_registry/registry.py`.
 *
 * Construct using one of:
 * - `AsaMetadataRegistry.from_algod(...)` (read-only, fast box reads)
 * - `AsaMetadataRegistry.from_app_client(...)` (simulate + writes, optionally with algod for box reads)
 */

import { AlgodBoxReader, type AlgodClientLike } from './algod'
import { Arc90Uri } from './codec'
import { MissingAppClientError, RegistryResolutionError } from './errors'
import { AsaMetadataRegistryAvmRead } from './read/avm'
import { AsaMetadataRegistryRead } from './read/reader'
import { AsaMetadataRegistryWrite } from './write/writer'
import { AsaMetadataRegistryClient } from './generated'

const asBigIntOrNull = (v: bigint | number | null | undefined): bigint | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  throw new TypeError('app_id must be bigint | number | null')
}

/**
 * Configuration for an ASA Metadata Registry singleton instance.
 */
export class RegistryConfig {
  /** Registry App ID (application id). */
  public readonly app_id: bigint | null
  /** ARC-90 netauth, e.g. "net:testnet"; null means mainnet/unspecified. */
  public readonly netauth: string | null

  constructor(args?: {
    // snake_case (Python parity)
    app_id?: bigint | number | null
    netauth?: string | null

    // camelCase (TS ergonomics)
    appId?: bigint | number | null
  }) {
    const appId = args?.app_id ?? args?.appId
    this.app_id = asBigIntOrNull(appId)
    this.netauth = args?.netauth ?? null
  }
}

/**
 * Facade over the ARC-89 read/write APIs.
 */
export class AsaMetadataRegistry {
  public readonly config: RegistryConfig

  private readonly _algod_reader: AlgodBoxReader | null
  private readonly _base_generated_client: AsaMetadataRegistryClient | null
  private readonly _generated_client_factory: ((appId: bigint) => AsaMetadataRegistryClient) | null
  private readonly _avm_reader_factory: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null
  private readonly _write: AsaMetadataRegistryWrite | null

  public readonly read: AsaMetadataRegistryRead

  constructor(args: {
    config: RegistryConfig
    algod?: AlgodClientLike | null
    app_client?: AsaMetadataRegistryClient | null
  }) {
    this.config = args.config

    this._algod_reader = args.algod ? new AlgodBoxReader(args.algod) : null

    this._base_generated_client = args.app_client ?? null
    this._generated_client_factory = this._base_generated_client
      ? AsaMetadataRegistry._make_generated_client_factory({ base_client: this._base_generated_client })
      : null

    this._avm_reader_factory = this._generated_client_factory
      ? (appId: bigint) => new AsaMetadataRegistryAvmRead(this._generated_client_factory!(appId))
      : null

    this._write = this._base_generated_client ? new AsaMetadataRegistryWrite(this._base_generated_client) : null

    this.read = new AsaMetadataRegistryRead({
      appId: this.config.app_id,
      algod: this._algod_reader,
      avmFactory: this._avm_reader_factory,
    })
  }

  /** Write API (requires a generated AppClient). */
  get write(): AsaMetadataRegistryWrite {
    if (!this._write) {
      throw new MissingAppClientError('Write operations require a generated AppClient')
    }
    return this._write
  }

  // ------------------------------------------------------------------
  // Constructors
  // ------------------------------------------------------------------

  /**
   * Create a registry facade using only Algod (box reads).
   */
  static from_algod(args: { algod: AlgodClientLike; app_id: bigint | number | null }): AsaMetadataRegistry {
    return new AsaMetadataRegistry({
      config: new RegistryConfig({ app_id: args.app_id }),
      algod: args.algod,
      app_client: null,
    })
  }

  /**
   * Create a registry facade using the generated AppClient (simulate + writes),
   * optionally also providing Algod for box reads.
   */
  static from_app_client(
    app_client: AsaMetadataRegistryClient,
    args?: {
      algod?: AlgodClientLike | null
      app_id?: bigint | number | null
      netauth?: string | null

      // camelCase
      appId?: bigint | number | null
    },
  ): AsaMetadataRegistry {
    const inferred = args?.app_id ?? args?.appId
    const appId = inferred === undefined || inferred === null ? asBigIntOrNull(app_client.appId as any) : asBigIntOrNull(inferred)

    return new AsaMetadataRegistry({
      config: new RegistryConfig({ app_id: appId, netauth: args?.netauth ?? null }),
      algod: args?.algod ?? null,
      app_client,
    })
  }

  // ------------------------------------------------------------------
  // URI helpers
  // ------------------------------------------------------------------

  /**
   * Build a full ARC-90 URI for an asset_id using configured netauth + app_id.
   *
   * Note: this is an *off-chain* convenience; if you need the exact string returned by
   * the on-chain method, use `read.arc89_get_metadata_partial_uri(source: AVM)`.
   */
  arc90_uri(args: { asset_id: bigint | number; app_id?: bigint | number | null }): Arc90Uri {
    const resolved_app_id = asBigIntOrNull(args.app_id) ?? this.config.app_id
    if (resolved_app_id === null) {
      throw new RegistryResolutionError('Cannot build ARC-90 URI without app_id')
    }
    return new Arc90Uri({ netauth: this.config.netauth, appId: resolved_app_id, boxName: null }).withAssetId(args.asset_id)
  }

  /** camelCase alias for TS ergonomics. */
  arc90Uri(args: { assetId: bigint | number; appId?: bigint | number | null }): Arc90Uri {
    return this.arc90_uri({ asset_id: args.assetId, app_id: args.appId })
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private static _make_generated_client_factory(args: {
    base_client: AsaMetadataRegistryClient
  }): (appId: bigint) => AsaMetadataRegistryClient {
    const base = args.base_client

    // The generated TS client supports clone(); this keeps the underlying Algorand client
    // and default sender/signer while changing the app id.
    if (typeof (base as any).clone !== 'function') {
      throw new MissingAppClientError('Generated client does not support clone(); cannot create factory')
    }

    return (appId: bigint) => {
      const id = Number(appId)
      return (base as any).clone({ appId: id }) as AsaMetadataRegistryClient
    }
  }
}
