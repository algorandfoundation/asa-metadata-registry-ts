/**
 * ARC-89 AVM reader
 *
 * Ported from Python `asa_metadata_registry/read/avm.py`.
 */

import { AsaMetadataRegistryClient } from '../generated'
import type { RawSimulateOptions, SkipSignaturesSimulateOptions } from '@algorandfoundation/algokit-utils/types/composer'
import { MissingAppClientError } from '../errors'
import { asNumber, asUint8, asUint64BigInt } from '../internal/numbers'
import { toBytes } from '../internal/bytes'
import {
  MbrDelta,
  MetadataExistence,
  MetadataFlags,
  MetadataHeader,
  PaginatedMetadata,
  Pagination,
  RegistryParameters,
} from '../models'
import * as enums from '../enums'
import { parseMbrDelta, parsePaginatedMetadata, returnValues, withArgs } from '../internal/avm'

/**
 * Options passed through to AlgoKit's `TransactionComposer.simulate()`.
 */
export type SimulateOptions = RawSimulateOptions | SkipSignaturesSimulateOptions

// ------------------------------------------------------------------
// Decode helpers (simulate return values)
// ------------------------------------------------------------------

const parseRegistryParameters = (v: unknown): RegistryParameters => {
  if (Array.isArray(v)) return RegistryParameters.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('RegistryParameters must be a tuple or struct')
  const o = v as any
  return new RegistryParameters({
    keySize: asNumber(o.keySize, 'keySize'),
    headerSize: asNumber(o.headerSize, 'headerSize'),
    maxMetadataSize: asNumber(o.maxMetadataSize, 'maxMetadataSize'),
    shortMetadataSize: asNumber(o.shortMetadataSize, 'shortMetadataSize'),
    pageSize: asNumber(o.pageSize, 'pageSize'),
    firstPayloadMaxSize: asNumber(o.firstPayloadMaxSize, 'firstPayloadMaxSize'),
    extraPayloadMaxSize: asNumber(o.extraPayloadMaxSize, 'extraPayloadMaxSize'),
    replacePayloadMaxSize: asNumber(o.replacePayloadMaxSize, 'replacePayloadMaxSize'),
    flatMbr: asNumber(o.flatMbr, 'flatMbr'),
    byteMbr: asNumber(o.byteMbr, 'byteMbr'),
  })
}

const parseMetadataExistence = (v: unknown): MetadataExistence => {
  if (Array.isArray(v)) return MetadataExistence.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('MetadataExistence must be a tuple or struct')
  const o = v as any
  return new MetadataExistence({ asaExists: Boolean(o.asaExists), metadataExists: Boolean(o.metadataExists) })
}

const parseMetadataHeader = (v: unknown): MetadataHeader => {
  if (Array.isArray(v)) return MetadataHeader.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('MetadataHeader must be a tuple or struct')
  const o = v as any
  return new MetadataHeader({
    identifiers: asUint8(o.identifiers, 'identifiers'),
    flags: MetadataFlags.fromBytes(asUint8(o.reversibleFlags, 'reversibleFlags'), asUint8(o.irreversibleFlags, 'irreversibleFlags')),
    metadataHash: toBytes(o.hash, 'hash'),
    lastModifiedRound: asUint64BigInt(o.lastModifiedRound, 'lastModifiedRound'),
    deprecatedBy: asUint64BigInt(o.deprecatedBy, 'deprecatedBy'),
  })
}

const parsePagination = (v: unknown): Pagination => {
  if (Array.isArray(v)) return Pagination.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('Pagination must be a tuple or struct')
  const o = v as any
  return new Pagination({
    metadataSize: asNumber(o.metadataSize, 'metadataSize'),
    pageSize: asNumber(o.pageSize, 'pageSize'),
    totalPages: asUint8(o.totalPages, 'totalPages'),
  })
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

  async simulateMany(buildGroup: (composer: any) => void, args?: { simulate?: SimulateOptions }): Promise<unknown[]> {
    const composer = this.client.newGroup()
    buildGroup(composer)
    const results = args?.simulate
      ? await composer.simulate(args.simulate)
      : await composer.simulate()
    return returnValues(results)
  }

  async simulateOne(buildGroup: (composer: any) => void, args?: { simulate?: SimulateOptions }): Promise<unknown> {
    const values = await this.simulateMany(buildGroup, args)
    return values.length ? values[0] : undefined
  }

  // ------------------------------------------------------------------
  // ARC-89 getters (AVM parity)
  // ------------------------------------------------------------------

  async arc89GetMetadataRegistryParameters(args?: { simulate?: SimulateOptions; params?: unknown }): Promise<RegistryParameters> {
    const value = await this.simulateOne((c) => c.arc89GetMetadataRegistryParameters(withArgs(args?.params, [])), { simulate: args?.simulate })
    return parseRegistryParameters(value)
  }

  async arc89GetMetadataPartialUri(args?: { simulate?: SimulateOptions; params?: unknown }): Promise<string> {
    const value = await this.simulateOne((c) => c.arc89GetMetadataPartialUri(withArgs(args?.params, [])), { simulate: args?.simulate })
    return String(value)
  }

  async arc89GetMetadataMbrDelta(args: { assetId: bigint | number; newSize: number; simulate?: SimulateOptions; params?: unknown }): Promise<MbrDelta> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataMbrDelta(withArgs(args.params, [args.assetId, args.newSize])),
      { simulate: args.simulate },
    )
    return parseMbrDelta(value)
  }

  async arc89CheckMetadataExists(args: { assetId: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<MetadataExistence> {
    const value = await this.simulateOne(
      (c) => c.arc89CheckMetadataExists(withArgs(args.params, [args.assetId])),
      { simulate: args.simulate },
    )
    return parseMetadataExistence(value)
  }

  async arc89IsMetadataImmutable(args: { assetId: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<boolean> {
    const value = await this.simulateOne(
      (c) => c.arc89IsMetadataImmutable(withArgs(args.params, [args.assetId])),
      { simulate: args.simulate },
    )
    return Boolean(value)
  }

  async arc89IsMetadataShort(args: { assetId: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<readonly [boolean, bigint]> {
    const value = await this.simulateOne(
      (c) => c.arc89IsMetadataShort(withArgs(args.params, [args.assetId])),
      { simulate: args.simulate },
    )

    // Generated client returns either a tuple or struct; normalize to (bool, uint64).
    if (Array.isArray(value)) {
      return [Boolean(value[0]), asUint64BigInt(value[1], 'lastModifiedRound')]
    }
    if (value && typeof value === 'object' && 'lastModifiedRound' in (value as any) && 'flag' in (value as any)) {
      // This would be MutableFlag shape; tolerate it defensively.
      const o = value as any
      return [Boolean(o.flag), asUint64BigInt(o.lastModifiedRound, 'lastModifiedRound')]
    }
    if (value && typeof value === 'object' && '0' in (value as any) && '1' in (value as any)) {
      const o = value as any
      return [Boolean(o[0]), asUint64BigInt(o[1], 'lastModifiedRound')]
    }
    throw new TypeError('Unexpected return type for arc89IsMetadataShort')
  }

  async arc89GetMetadataHeader(args: { assetId: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<MetadataHeader> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataHeader(withArgs(args.params, [args.assetId])),
      { simulate: args.simulate },
    )
    return parseMetadataHeader(value)
  }

  async arc89GetMetadataPagination(args: { assetId: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<Pagination> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataPagination(withArgs(args.params, [args.assetId])),
      { simulate: args.simulate },
    )
    return parsePagination(value)
  }

  async arc89GetMetadata(args: { assetId: bigint | number; page: number; simulate?: SimulateOptions; params?: unknown }): Promise<PaginatedMetadata> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadata(withArgs(args.params, [args.assetId, args.page])),
      { simulate: args.simulate },
    )
    return parsePaginatedMetadata(value)
  }

  async arc89GetMetadataSlice(args: { assetId: bigint | number; offset: number; size: number; simulate?: SimulateOptions; params?: unknown }): Promise<Uint8Array> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataSlice(withArgs(args.params, [args.assetId, args.offset, args.size])),
      { simulate: args.simulate },
    )
    return toBytes(value, 'metadataSlice')
  }

  async arc89GetMetadataHeaderHash(args: { assetId: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<Uint8Array> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataHeaderHash(withArgs(args.params, [args.assetId])),
      { simulate: args.simulate },
    )
    return toBytes(value, 'headerHash')
  }

  async arc89GetMetadataPageHash(args: { assetId: bigint | number; page: number; simulate?: SimulateOptions; params?: unknown }): Promise<Uint8Array> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataPageHash(withArgs(args.params, [args.assetId, args.page])),
      { simulate: args.simulate },
    )
    return toBytes(value, 'pageHash')
  }

  async arc89GetMetadataHash(args: { assetId: bigint | number; simulate?: SimulateOptions; params?: unknown }): Promise<Uint8Array> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataHash(withArgs(args.params, [args.assetId])),
      { simulate: args.simulate },
    )
    return toBytes(value, 'metadataHash')
  }

  async arc89GetMetadataStringByKey(args: { assetId: bigint | number; key: string; simulate?: SimulateOptions; params?: unknown }): Promise<string> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataStringByKey(withArgs(args.params, [args.assetId, args.key])),
      { simulate: args.simulate },
    )
    return String(value)
  }

  async arc89GetMetadataUint64ByKey(args: { assetId: bigint | number; key: string; simulate?: SimulateOptions; params?: unknown }): Promise<bigint> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataUint64ByKey(withArgs(args.params, [args.assetId, args.key])),
      { simulate: args.simulate },
    )
    return asUint64BigInt(value, 'uint64')
  }

  async arc89GetMetadataObjectByKey(args: { assetId: bigint | number; key: string; simulate?: SimulateOptions; params?: unknown }): Promise<string> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataObjectByKey(withArgs(args.params, [args.assetId, args.key])),
      { simulate: args.simulate },
    )
    return String(value)
  }

  async arc89GetMetadataB64BytesByKey(args: {
    assetId: bigint | number
    key: string
    b64Encoding: typeof enums.B64_STD_ENCODING | typeof enums.B64_URL_ENCODING
    simulate?: SimulateOptions
    params?: unknown
  }): Promise<Uint8Array> {
    const value = await this.simulateOne(
      (c) => c.arc89GetMetadataB64BytesByKey(withArgs(args.params, [args.assetId, args.key, args.b64Encoding])),
      { simulate: args.simulate },
    )
    return toBytes(value, 'b64Bytes')
  }
}
