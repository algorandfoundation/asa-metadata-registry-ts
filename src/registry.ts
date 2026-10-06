/**
 * Facade over the ARC-89 read/write APIs.
 *
 * Ported from Python `asa_metadata_registry/registry.py`.
 */

import { AlgodBoxReader, AlgodClientSubset } from './algod'
import { Arc90Uri } from './codec'
import { MissingAppClientError, RegistryResolutionError } from './errors'
import { AsaMetadataRegistryAvmRead } from './read/avm'
import { AsaMetadataRegistryRead } from './read/reader'
import { AsaMetadataRegistryWrite } from './write/writer'
import { AsaMetadataRegistryClient } from './generated'
import { asUint64BigInt } from './internal/numbers'

const asUint64BigIntOrNull = (v: bigint | number | null | undefined, name: string): bigint | null => {
  if (v === null || v === undefined) return null
  const val = asUint64BigInt(v, name)
  return val == 0n ? null : val
}

/**
 * Configuration for an ASA Metadata Registry singleton instance.
 *
 * @property appId - Registry App ID (application id).
 * @property netauth - ARC-90 netauth, e.g. "net:testnet"; null means mainnet/unspecified.
 */
export class RegistryConfig {
  public readonly appId: bigint | null
  public readonly netauth: string | null

  constructor(args?: { appId?: bigint | number | null; netauth?: string | null }) {
    this.appId = asUint64BigIntOrNull(args?.appId, 'appId')
    this.netauth = args?.netauth ?? null
    Object.freeze(this)
  }
}

/**
 * Facade over the ARC-89 read/write APIs.
 *
 * Construct using one of:
 * - `AsaMetadataRegistry.fromAlgod(...)` (read-only, fast box reads)
 * - `AsaMetadataRegistry.fromAppClient(...)` (simulate + writes, optionally with algod for box reads)
 */
export class AsaMetadataRegistry {
  public readonly config: RegistryConfig

  private readonly algodReader: AlgodBoxReader | null
  private readonly baseGeneratedClient: AsaMetadataRegistryClient | null
  private readonly generatedClientFactory: ((appId: bigint) => AsaMetadataRegistryClient) | null
  private readonly avmReaderFactory: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null
  private readonly _write: AsaMetadataRegistryWrite | null

  public readonly read: AsaMetadataRegistryRead

  /**
   * @throws {Error} If `appClient` is bound to an app id other than `config.appId`.
   */
  constructor(args: {
    config: RegistryConfig
    algod?: AlgodClientSubset | null
    appClient?: AsaMetadataRegistryClient | null
  }) {
    this.config = args.config

    this.algodReader = args.algod ? new AlgodBoxReader(args.algod) : null

    this.baseGeneratedClient = args.appClient ?? null

    let generatedClientFactory: ((appId: bigint) => AsaMetadataRegistryClient) | null = null
    let avmReaderFactory: ((appId: bigint) => AsaMetadataRegistryAvmRead) | null = null
    let write: AsaMetadataRegistryWrite | null = null

    if (this.baseGeneratedClient) {
      // Normalize appId from the provided generated client (0 => unbound).
      const clientAppId = asUint64BigIntOrNull(this.baseGeneratedClient.appId, 'appId')

      // Guard against accidental mismatches when callers construct the registry directly
      // with a pinned appId. If callers want to retarget the registry, they can pass an
      // unbound client (appId 0) or rely on the higher-level constructors.
      if (this.config.appId !== null && clientAppId !== null && clientAppId !== this.config.appId) {
        throw new Error(
          `App ID mismatch: provided appClient has appId ${clientAppId}, but config specifies ${this.config.appId}`,
        )
      }

      // Build a factory that can create a generated client for arbitrary registry appId,
      // using the same AlgoKit Algorand client instance.
      const factory = AsaMetadataRegistry.makeGeneratedClientFactory({ baseClient: this.baseGeneratedClient })
      generatedClientFactory = factory
      avmReaderFactory = (appId: bigint) => new AsaMetadataRegistryAvmRead({ client: factory(appId) })

      let writeClient = this.baseGeneratedClient
      if (clientAppId === null && this.config.appId !== null) {
        writeClient = factory(this.config.appId)
      }
      write = new AsaMetadataRegistryWrite({ client: writeClient })
    }

    this.generatedClientFactory = generatedClientFactory
    this.avmReaderFactory = avmReaderFactory
    this._write = write

    this.read = new AsaMetadataRegistryRead({
      appId: this.config.appId,
      algod: this.algodReader,
      avmFactory: this.avmReaderFactory,
    })
  }

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
  static fromAlgod(args: { algod: AlgodClientSubset; appId: bigint | number | null }): AsaMetadataRegistry {
    return new AsaMetadataRegistry({
      config: new RegistryConfig({ appId: args.appId }),
      algod: args.algod,
      appClient: null,
    })
  }

  /**
   * Create a registry facade using the generated AppClient (simulate + writes),
   * optionally also providing Algod for box reads.
   */
  static fromAppClient(
    appClient: AsaMetadataRegistryClient,
    args?: {
      algod?: AlgodClientSubset | null
      appId?: bigint | number | null
      netauth?: string | null
    },
  ): AsaMetadataRegistry {
    // If appId isn't provided, attempt to read it from the generated client's appId.
    let inferredAppId = asUint64BigIntOrNull(args?.appId, 'appId')
    if (inferredAppId === null) {
      inferredAppId = asUint64BigIntOrNull(appClient.appId, 'appId')
    }

    return new AsaMetadataRegistry({
      config: new RegistryConfig({ appId: inferredAppId, netauth: args?.netauth ?? null }),
      algod: args?.algod ?? null,
      appClient: appClient,
    })
  }

  // ------------------------------------------------------------------
  // URI helpers
  // ------------------------------------------------------------------

  /**
   * Build a full ARC-90 URI for an assetId using configured netauth + appId.
   *
   * Note: this is an *off-chain* convenience; if you need the exact string returned by
   * the on-chain method, use `read.arc89GetMetadataPartialUri({ source: MetadataSource.AVM })`.
   */
  arc90Uri(args: { assetId: bigint | number; appId?: bigint | number | null }): Arc90Uri {
    const resolvedAppId = asUint64BigIntOrNull(args?.appId, 'appId') ?? this.config.appId
    if (resolvedAppId === null) {
      throw new RegistryResolutionError('Cannot build ARC-90 URI without appId')
    }
    return new Arc90Uri({ netauth: this.config.netauth, appId: resolvedAppId, boxName: null }).withAssetId(args.assetId)
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Create a function that builds a new generated client instance for a given appId.
   */
  private static makeGeneratedClientFactory(args: {
    baseClient: AsaMetadataRegistryClient
  }): (appId: bigint) => AsaMetadataRegistryClient {
    const base = args.baseClient

    // The generated TS client supports clone(); this keeps the underlying Algorand client
    // and default sender/signer while changing the app id.
    if (typeof base.clone !== 'function') {
      throw new MissingAppClientError('Generated client does not support clone(); cannot create factory')
    }

    return (appId: bigint) => {
      return base.clone({ appId })
    }
  }
}
