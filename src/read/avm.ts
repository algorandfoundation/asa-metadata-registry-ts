/**
 * AVM-parity ARC-89 getters via the AlgoKit-generated AppClient.
 *
 * Ported from Python `asa_metadata_registry/read/avm.py`.
 *
 * These methods use `simulate()` (not `send()`) to mirror the smart-contract
 * behavior without broadcasting transactions.
 */

import { AsaMetadataRegistryClient } from '../generated'
import { MissingAppClientError } from '../errors'
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
 *
 * For DX parity with Python, both snake_case and camelCase spellings are accepted.
 */
export interface SimulateOptions {
  allow_more_logs?: boolean | null
  allowMoreLogs?: boolean | null

  allow_empty_signatures?: boolean | null
  allowEmptySignatures?: boolean | null

  allow_unnamed_resources?: boolean | null
  allowUnnamedResources?: boolean | null

  extra_opcode_budget?: number | null
  extraOpcodeBudget?: number | null

  exec_trace_config?: unknown | null
  execTraceConfig?: unknown | null

  simulation_round?: number | null
  simulationRound?: number | null

  skip_signatures?: boolean | null
  skipSignatures?: boolean | null
}

const coalesce = <T>(...values: Array<T | null | undefined>): T | undefined => {
  for (const v of values) if (v !== null && v !== undefined) return v
  return undefined
}

const normalizeSimulateOptions = (opts?: SimulateOptions) => {
  const allowEmptySignatures = coalesce(opts?.allowEmptySignatures, opts?.allow_empty_signatures, true)
  const skipSignatures = coalesce(opts?.skipSignatures, opts?.skip_signatures, true)

  return {
    allowMoreLogs: coalesce(opts?.allowMoreLogs, opts?.allow_more_logs),
    allowEmptySignatures,
    allowUnnamedResources: coalesce(opts?.allowUnnamedResources, opts?.allow_unnamed_resources),
    extraOpcodeBudget: coalesce(opts?.extraOpcodeBudget, opts?.extra_opcode_budget),
    execTraceConfig: coalesce(opts?.execTraceConfig, opts?.exec_trace_config),
    simulationRound: coalesce(opts?.simulationRound, opts?.simulation_round),
    skipSignatures,
  }
}

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
    lastModifiedRound: toBigInt(o.lastModifiedRound, 'last_modified_round'),
    deprecatedBy: toBigInt(o.deprecatedBy, 'deprecated_by'),
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
    lastModifiedRound: toBigInt(o.lastModifiedRound, 'last_modified_round'),
    pageContent: toUint8Array(o.pageContent, 'page_content'),
  })
}

const withArgs = (params: unknown | undefined, args: unknown[]) => {
  const p = (params && typeof params === 'object') ? { ...(params as any) } : {}
  ;(p as any).args = args
  return p
}

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
    const results = await composer.simulate(normalizeSimulateOptions(args?.simulate))
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
      return [Boolean(value[0]), toBigInt(value[1], 'last_modified_round')]
    }
    if (value && typeof value === 'object' && 'lastModifiedRound' in (value as any) && 'flag' in (value as any)) {
      // This would be MutableFlag shape; tolerate it defensively.
      const o = value as any
      return [Boolean(o.flag), toBigInt(o.lastModifiedRound, 'last_modified_round')]
    }
    if (value && typeof value === 'object' && '0' in (value as any) && '1' in (value as any)) {
      const o = value as any
      return [Boolean(o[0]), toBigInt(o[1], 'last_modified_round')]
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
    return toBigInt(value, 'uint64')
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
