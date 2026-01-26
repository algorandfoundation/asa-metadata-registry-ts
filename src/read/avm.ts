/**
 * ARC-89 AVM reader
 *
 * Ported from Python `asa_metadata_registry/read/avm.py`.
 */

import { AsaMetadataRegistryClient } from '../generated'
import type { RawSimulateOptions, SkipSignaturesSimulateOptions } from '@algorandfoundation/algokit-utils/types/composer'
import { MissingAppClientError } from '../errors'
import { toUint64BigInt } from '../internal/numbers'
import {
  MbrDelta,
  MetadataExistence,
  MetadataFlags,
  MetadataHeader,
  PaginatedMetadata,
  Pagination,
  RegistryParameters,
} from '../models'

/**
 * Options passed through to AlgoKit's `TransactionComposer.simulate()`.
 */
export type SimulateOptions = RawSimulateOptions | SkipSignaturesSimulateOptions

/**
 * Extract `.returns[*].value` from AlgoKit composer results, tolerating minor shape differences.
 */
const returnValues = (results: unknown): unknown[] => {
  if (!results || typeof results !== 'object') return []
  const returns = (results as any).returns
  if (!Array.isArray(returns)) return []
  return returns.map((r: any) => {
    if (r && typeof r === 'object') {
      if ('value' in r) return (r as any).value
      if ('returnValue' in r) return (r as any).returnValue
    }
    return r
  })
}

const toUint8Array = (v: unknown, label: string): Uint8Array => {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (Array.isArray(v)) return Uint8Array.from(v)

  const B = (globalThis as any).Buffer
  if (B && typeof B.isBuffer === 'function' && B.isBuffer(v)) return new Uint8Array(v)

  // TypedArray / DataView
  if (v && typeof v === 'object' && 'buffer' in (v as any) && (v as any).buffer instanceof ArrayBuffer) {
    const view = v as any
    return new Uint8Array(view.buffer, view.byteOffset ?? 0, view.byteLength ?? view.length)
  }

  throw new TypeError(`${label} must be bytes (Uint8Array)`)
}

const toRegistryParameters = (v: unknown): RegistryParameters => {
  if (Array.isArray(v)) return RegistryParameters.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('RegistryParameters must be a tuple or struct')
  const o = v as any
  return new RegistryParameters({
    keySize: Number(o.keySize),
    headerSize: Number(o.headerSize),
    maxMetadataSize: Number(o.maxMetadataSize),
    shortMetadataSize: Number(o.shortMetadataSize),
    pageSize: Number(o.pageSize),
    firstPayloadMaxSize: Number(o.firstPayloadMaxSize),
    extraPayloadMaxSize: Number(o.extraPayloadMaxSize),
    replacePayloadMaxSize: Number(o.replacePayloadMaxSize),
    flatMbr: Number(o.flatMbr),
    byteMbr: Number(o.byteMbr),
  })
}

const toMbrDelta = (v: unknown): MbrDelta => {
  if (Array.isArray(v)) return MbrDelta.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('MbrDelta must be a tuple or struct')
  const o = v as any
  return new MbrDelta({ sign: Number(o.sign), amount: Number(o.amount) })
}

const toMetadataExistence = (v: unknown): MetadataExistence => {
  if (Array.isArray(v)) return MetadataExistence.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('MetadataExistence must be a tuple or struct')
  const o = v as any
  return new MetadataExistence({ asaExists: Boolean(o.asaExists), metadataExists: Boolean(o.metadataExists) })
}

const toMetadataHeader = (v: unknown): MetadataHeader => {
  if (Array.isArray(v)) return MetadataHeader.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('MetadataHeader must be a tuple or struct')
  const o = v as any
  return new MetadataHeader({
    identifiers: Number(o.identifiers),
    flags: MetadataFlags.fromBytes(Number(o.reversibleFlags), Number(o.irreversibleFlags)),
    metadataHash: toUint8Array(o.hash, 'hash'),
    lastModifiedRound: toUint64BigInt(o.lastModifiedRound, 'last_modified_round'),
    deprecatedBy: toUint64BigInt(o.deprecatedBy, 'deprecated_by'),
  })
}

const toPagination = (v: unknown): Pagination => {
  if (Array.isArray(v)) return Pagination.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('Pagination must be a tuple or struct')
  const o = v as any
  return new Pagination({ metadataSize: Number(o.metadataSize), pageSize: Number(o.pageSize), totalPages: Number(o.totalPages) })
}

const toPaginatedMetadata = (v: unknown): PaginatedMetadata => {
  if (Array.isArray(v)) return PaginatedMetadata.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('PaginatedMetadata must be a tuple or struct')
  const o = v as any
  return new PaginatedMetadata({
    hasNextPage: Boolean(o.hasNextPage),
    lastModifiedRound: toUint64BigInt(o.lastModifiedRound, 'last_modified_round'),
    pageContent: toUint8Array(o.pageContent, 'page_content'),
  })
}

const withArgs = (params: unknown | undefined, args: unknown[]) => {
  const p = (params && typeof params === 'object') ? { ...(params as any) } : {}
  ;(p as any).args = args
  return p
}

/**
 * AVM-parity ARC-89 getters via the AlgoKit-generated AppClient.
 *
 * These methods use `simulate()` (not `send()`) to mirror the smart-contract
 * behavior without broadcasting transactions.
 */
export class AsaMetadataRegistryAvmRead {
  public readonly client: AsaMetadataRegistryClient

  constructor(args: { client: AsaMetadataRegistryClient }) {
    if (!args.client) throw new MissingAppClientError('AVM reader requires a generated AsaMetadataRegistryClient')
    this.client = args.client
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  async simulate_many(buildGroup: (composer: any) => void, args?: { simulate?: SimulateOptions }): Promise<unknown[]> {
    const composer = this.client.newGroup()
    buildGroup(composer)
    const results = args?.simulate
      ? await composer.simulate(args.simulate)
      : await composer.simulate()
    return returnValues(results)
  }

  async simulate_one(buildGroup: (composer: any) => void, args?: { simulate?: SimulateOptions }): Promise<unknown> {
    const values = await this.simulate_many(buildGroup, args)
    return values.length ? values[0] : undefined
  }

  // ------------------------------------------------------------------
  // ARC-89 getters (AVM parity)
  // ------------------------------------------------------------------

  async arc89_get_metadata_registry_parameters(args?: { simulate?: SimulateOptions; params?: unknown }): Promise<RegistryParameters> {
    const value = await this.simulate_one((c) => c.arc89GetMetadataRegistryParameters(withArgs(args?.params, [])), { simulate: args?.simulate })
    return toRegistryParameters(value)
  }

  async arc89_get_metadata_partial_uri(args?: { simulate?: SimulateOptions; params?: unknown }): Promise<string> {
    const value = await this.simulate_one((c) => c.arc89GetMetadataPartialUri(withArgs(args?.params, [])), { simulate: args?.simulate })
    return String(value)
  }

  async arc89_get_metadata_mbr_delta(args: { asset_id: bigint | number; new_size: number; simulate?: SimulateOptions; params?: unknown }): Promise<MbrDelta> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataMbrDelta(withArgs(args.params, [args.asset_id, args.new_size])),
      { simulate: args.simulate },
    )
    return toMbrDelta(value)
  }

  async arc89_check_metadata_exists(args: { asset_id: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<MetadataExistence> {
    const value = await this.simulate_one(
      (c) => c.arc89CheckMetadataExists(withArgs(args.params, [args.asset_id])),
      { simulate: args.simulate },
    )
    return toMetadataExistence(value)
  }

  async arc89_is_metadata_immutable(args: { asset_id: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<boolean> {
    const value = await this.simulate_one(
      (c) => c.arc89IsMetadataImmutable(withArgs(args.params, [args.asset_id])),
      { simulate: args.simulate },
    )
    return Boolean(value)
  }

  async arc89_is_metadata_short(args: { asset_id: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<readonly [boolean, bigint]> {
    const value = await this.simulate_one(
      (c) => c.arc89IsMetadataShort(withArgs(args.params, [args.asset_id])),
      { simulate: args.simulate },
    )

    // Generated client returns either a tuple or struct; normalize to (bool, uint64).
    if (Array.isArray(value)) {
      return [Boolean(value[0]), toUint64BigInt(value[1], 'last_modified_round')]
    }
    if (value && typeof value === 'object' && 'lastModifiedRound' in (value as any) && 'flag' in (value as any)) {
      // This would be MutableFlag shape; tolerate it defensively.
      const o = value as any
      return [Boolean(o.flag), toUint64BigInt(o.lastModifiedRound, 'last_modified_round')]
    }
    if (value && typeof value === 'object' && '0' in (value as any) && '1' in (value as any)) {
      const o = value as any
      return [Boolean(o[0]), toUint64BigInt(o[1], 'last_modified_round')]
    }
    throw new TypeError('Unexpected return type for arc89_is_metadata_short')
  }

  async arc89_get_metadata_header(args: { asset_id: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<MetadataHeader> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataHeader(withArgs(args.params, [args.asset_id])),
      { simulate: args.simulate },
    )
    return toMetadataHeader(value)
  }

  async arc89_get_metadata_pagination(args: { asset_id: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<Pagination> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataPagination(withArgs(args.params, [args.asset_id])),
      { simulate: args.simulate },
    )
    return toPagination(value)
  }

  async arc89_get_metadata(args: { asset_id: bigint | number; page: number; simulate?: SimulateOptions; params?: unknown }): Promise<PaginatedMetadata> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadata(withArgs(args.params, [args.asset_id, args.page])),
      { simulate: args.simulate },
    )
    return toPaginatedMetadata(value)
  }

  async arc89_get_metadata_slice(args: { asset_id: bigint | number; offset: number; size: number; simulate?: SimulateOptions; params?: unknown }): Promise<Uint8Array> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataSlice(withArgs(args.params, [args.asset_id, args.offset, args.size])),
      { simulate: args.simulate },
    )
    return toUint8Array(value, 'metadata_slice')
  }

  async arc89_get_metadata_header_hash(args: { asset_id: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<Uint8Array> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataHeaderHash(withArgs(args.params, [args.asset_id])),
      { simulate: args.simulate },
    )
    return toUint8Array(value, 'header_hash')
  }

  async arc89_get_metadata_page_hash(args: { asset_id: bigint | number; page: number; simulate?: SimulateOptions; params?: unknown }): Promise<Uint8Array> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataPageHash(withArgs(args.params, [args.asset_id, args.page])),
      { simulate: args.simulate },
    )
    return toUint8Array(value, 'page_hash')
  }

  async arc89_get_metadata_hash(args: { asset_id: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<Uint8Array> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataHash(withArgs(args.params, [args.asset_id])),
      { simulate: args.simulate },
    )
    return toUint8Array(value, 'metadata_hash')
  }

  async arc89_get_metadata_string_by_key(args: { asset_id: bigint | number; key: string; simulate?: SimulateOptions; params?: unknown }): Promise<string> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataStringByKey(withArgs(args.params, [args.asset_id, args.key])),
      { simulate: args.simulate },
    )
    return String(value)
  }

  async arc89_get_metadata_uint64_by_key(args: { asset_id: bigint | number; key: string; simulate?: SimulateOptions; params?: unknown }): Promise<bigint> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataUint64ByKey(withArgs(args.params, [args.asset_id, args.key])),
      { simulate: args.simulate },
    )
    return toUint64BigInt(value, 'uint64')
  }

  async arc89_get_metadata_object_by_key(args: { asset_id: bigint | number; key: string; simulate?: SimulateOptions; params?: unknown }): Promise<string> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataObjectByKey(withArgs(args.params, [args.asset_id, args.key])),
      { simulate: args.simulate },
    )
    return String(value)
  }

  async arc89_get_metadata_b64_bytes_by_key(args: {
    asset_id: bigint | number
    key: string
    b64_encoding: number
    simulate?: SimulateOptions
    params?: unknown
  }): Promise<Uint8Array> {
    const value = await this.simulate_one(
      (c) => c.arc89GetMetadataB64BytesByKey(withArgs(args.params, [args.asset_id, args.key, args.b64_encoding])),
      { simulate: args.simulate },
    )
    return toUint8Array(value, 'b64_bytes')
  }
}
