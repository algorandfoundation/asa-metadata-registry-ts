/**
 * Extensive tests for src/read/reader module.
 *
 * Tests cover:
 * - AsaMetadataRegistryRead initialization and configuration
 * - MetadataSource enum behavior
 * - Registry resolution and ARC-90 URI handling
 * - High-level getAssetMetadata with various sources
 * - Deprecation following
 * - All dispatcher methods for contract getters
 * - Error handling and edge cases
 * - Integration with box and avm readers
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ALGORAND_ZERO_ADDRESS_STRING, modelsv2 } from 'algosdk'
import {
  AlgodBoxReader,
  type AlgodClientSubset,
  Arc90Uri,
  AsaMetadataRegistryAvmRead,
  AsaMetadataRegistryBoxRead,
  AsaMetadataRegistryRead,
  AsaNotFoundError,
  AssetMetadataRecord,
  B64_STD_ENCODING,
  BoxNotFoundError,
  DEFAULT_SIMULATE_OPTIONS,
  InvalidArc90UriError,
  InvalidPageIndexError,
  InvalidSliceError,
  IrreversibleFlags,
  MAINNET_GH_B64,
  MbrDelta,
  MbrDeltaSign,
  MetadataBody,
  MetadataDriftError,
  MetadataEncodingError,
  MetadataExistence,
  MetadataFlags,
  MetadataHeader,
  MetadataKeyError,
  MetadataSlice,
  MetadataSource,
  MissingAppClientError,
  PAGE_SIZE,
  PaginatedMetadata,
  Pagination,
  RegistryParameters,
  RegistryResolutionError,
  ReversibleFlags,
  SHORT_METADATA_SIZE,
  type SimulateOptions,
  TESTNET_ASA_METADATA_REGISTRY_APP_ID,
  TESTNET_GH_B64,
  b64Decode,
  b64UrlEncode,
  bitmasks,
  getDefaultRegistryParams,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import type { AsaMetadataRegistryClient } from '@/generated'
import { concatBytes } from '@/internal/bytes'

// ================================================================
// Mocks
// ================================================================

/** A mocked algosdk request (e.g. `algod.getAssetByID(id)`), sent with `.do()`. */
type AlgodRequest = { do: () => Promise<unknown> }

const resolvedRequest = (value: unknown): AlgodRequest => ({ do: async () => value })

const rejectedRequest = (error: Error): AlgodRequest => ({
  do: async () => {
    throw error
  },
})

/**
 * Mock of the algosdk `Algodv2` subset wrapped by `AlgodBoxReader`.
 *
 * Like the Python `Mock(spec=AlgodClient)`: box and ASA reads fail unless a test mocks them, and the
 * connected network has no genesis hash (`suggested_params().gh` is not a string) unless a test sets it.
 */
const createMockAlgod = () => ({
  getApplicationBoxByName: vi.fn(
    (_appId: bigint | number, _name: Uint8Array): AlgodRequest =>
      rejectedRequest(new Error('getApplicationBoxByName is not mocked')),
  ),
  getAssetByID: vi.fn(
    (_assetId: bigint | number): AlgodRequest => rejectedRequest(new Error('getAssetByID is not mocked')),
  ),
  getTransactionParams: vi.fn((): AlgodRequest => resolvedRequest({})),
})

/** Factory of mocked AVM readers, cached per registry app id (Python `mock_avm_factory` fixture). */
const createMockAvmFactory = () => {
  const cache = new Map<bigint, AsaMetadataRegistryAvmRead>()

  return vi.fn((appId: bigint): AsaMetadataRegistryAvmRead => {
    let avmReader = cache.get(appId)
    if (avmReader === undefined) {
      avmReader = {
        client: {},
        arc89GetMetadataRegistryParameters: vi.fn(async () => getDefaultRegistryParams()),
        arc89GetMetadataPartialUri: vi.fn(),
        arc89GetMetadataMbrDelta: vi.fn(),
        arc89CheckMetadataExists: vi.fn(),
        arc89IsMetadataImmutable: vi.fn(),
        arc89IsMetadataShort: vi.fn(),
        arc89GetMetadataHeader: vi.fn(),
        arc89GetMetadataPagination: vi.fn(),
        arc89GetMetadata: vi.fn(),
        arc89GetMetadataSlice: vi.fn(),
        arc89GetMetadataHeaderHash: vi.fn(),
        arc89GetMetadataPageHash: vi.fn(),
        arc89GetMetadataHash: vi.fn(),
        arc89GetMetadataStringByKey: vi.fn(),
        arc89GetMetadataUint64ByKey: vi.fn(),
        arc89GetMetadataObjectByKey: vi.fn(),
        arc89GetMetadataB64BytesByKey: vi.fn(),
        simulateMany: vi.fn(),
        simulateOne: vi.fn(),
      } as unknown as AsaMetadataRegistryAvmRead
      cache.set(appId, avmReader)
    }
    return avmReader
  })
}

// ================================================================
// Fixtures
// ================================================================

let algod: ReturnType<typeof createMockAlgod> // MOCK algosdk client
let algodReader: AlgodBoxReader // AlgodBoxReader wrapping the MOCK algod client
let avmFactory: ReturnType<typeof createMockAvmFactory> // MOCK AVM reader factory

beforeEach(() => {
  vi.resetAllMocks()
  algod = createMockAlgod()
  algodReader = new AlgodBoxReader(algod as unknown as AlgodClientSubset)
  avmFactory = createMockAvmFactory()
})

/** The MOCK AVM reader the factory returns for a registry app id. */
const mockAvm = (appId: bigint | number = 123) => vi.mocked(avmFactory(BigInt(appId)))

// ================================================================
// Helpers
// ================================================================

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

const MANAGER_ADDR = '7ZUECA7HFLZTXENRV24SHLU4AVPUTMTTDUFUBNBD64C73F3UHRTHAIOF6Q'

/** Sample metadata header (Python `sample_metadata_header` fixture), with optional overrides. */
const metadataHeader = (
  overrides: Partial<{ identifiers: number; flags: MetadataFlags; deprecatedBy: number; revision: number }> = {},
) =>
  new MetadataHeader({
    identifiers: 0x00,
    flags: MetadataFlags.empty(),
    deprecatedBy: 0,
    revision: 1000,
    metadataHash: new Uint8Array(32),
    ...overrides,
  })

const sampleMetadataHeader = metadataHeader()

const sampleMetadataBody = new MetadataBody(utf8('{"name": "test", "description": "A test asset"}'))

const sampleAssetRecord = new AssetMetadataRecord({
  appId: 123,
  assetId: 456,
  header: sampleMetadataHeader,
  body: sampleMetadataBody,
})

/** Raw box value: serialized header followed by the metadata bytes. */
const boxValue = (header: MetadataHeader, metadata: Uint8Array | string): Uint8Array =>
  concatBytes([header.serialized, typeof metadata === 'string' ? utf8(metadata) : metadata])

/** Algod box response (algosdk `modelsv2.Box`). */
const boxModel = (name: Uint8Array, value: Uint8Array) => new modelsv2.Box({ name, round: 1, value })

type AssetParamsFields = { url?: string; manager?: string }

/** Algod ASA response (algosdk `modelsv2.Asset`); `params: null` omits the Asset Params. */
const assetModel = (assetId: bigint | number, params: AssetParamsFields | null) =>
  new modelsv2.Asset({
    index: assetId,
    params:
      params === null
        ? undefined
        : new modelsv2.AssetParams({ creator: MANAGER_ADDR, decimals: 0, total: 1, ...params }),
  })

/** Helper to mock algod box response (for any registry and box name). */
const mockBoxResponse = (value: Uint8Array) => {
  algod.getApplicationBoxByName.mockImplementation((_appId, name) => resolvedRequest(boxModel(name, value)))
}

/** Helper to mock algod ASA response. */
const mockAssetInfo = (params: AssetParamsFields | null) => {
  algod.getAssetByID.mockImplementation((assetId) => resolvedRequest(assetModel(assetId, params)))
}

/** Helper to mock algod response for asset metadata record. */
const mockAssetMetadataRecord = (record: AssetMetadataRecord) => {
  mockBoxResponse(boxValue(record.header, record.body.rawBytes))
  // Also mock the ASA for the canonical look-up (empty URL: the Asset URL is informational)
  mockAssetInfo({ url: '' })
}

/** Helper to mock the genesis hash of the connected network (unset by default). */
const mockGenesisHash = (genesisHash: Uint8Array) => {
  algod.getTransactionParams.mockImplementation(() => resolvedRequest({ genesisHash }))
}

// ================================================================
// MetadataSource Enum Tests
// ================================================================

describe('metadata source enum', () => {
  // Test MetadataSource enum values.
  test('metadata source auto', () => {
    expect(MetadataSource.AUTO).toBe('auto')
  })

  test('metadata source box', () => {
    expect(MetadataSource.BOX).toBe('box')
  })

  test('metadata source avm', () => {
    expect(MetadataSource.AVM).toBe('avm')
  })
})

// ================================================================
// AsaMetadataRegistryRead Initialization Tests
// ================================================================

describe('reader initialization', () => {
  // Test AsaMetadataRegistryRead initialization.
  test('init minimal', () => {
    // Test initialization with minimal configuration.
    const reader = new AsaMetadataRegistryRead({ appId: null })
    expect(reader.appId).toBeNull()
    expect(reader.algod).toBeNull()
    expect(reader.avmFactory).toBeNull()
    expect((reader as any).paramsCache).toBeNull()
  })

  test('init with app id', () => {
    // Test initialization with appId.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect(reader.appId).toBe(123n)
  })

  test('init with algod', () => {
    // Test initialization with algod reader.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    expect(reader.algod).toBe(algodReader)
  })

  test('init with avm factory', () => {
    // Test initialization with AVM factory.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    expect(reader.avmFactory).toBe(avmFactory)
  })

  test('init fully configured', () => {
    // Test initialization with all configuration options.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader, avmFactory })
    expect(reader.appId).toBe(123n)
    expect(reader.algod).toBe(algodReader)
    expect(reader.avmFactory).toBe(avmFactory)
  })

  test('init trusted registry configuration', () => {
    // TS-only: netauth and trustedVersions defaults; app ids are normalized to bigint.
    const minimal = new AsaMetadataRegistryRead({ appId: null })
    expect(minimal.netauth).toBeNull()
    expect(minimal.trustedVersions).toEqual([])

    const reader = new AsaMetadataRegistryRead({ appId: 123, netauth: 'net:testnet', trustedVersions: [789, 999n] })
    expect(reader.netauth).toBe('net:testnet')
    expect(reader.trustedVersions).toEqual([789n, 999n])
  })
})

// ================================================================
// Internal Helper Methods Tests
// ================================================================

describe('require app id', () => {
  // Test requireAppId private method.
  test('require app id from init', () => {
    // Test requireAppId uses appId from initialization.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect((reader as any).requireAppId(null)).toBe(123n)
  })

  test('require app id from parameter', () => {
    // Test requireAppId uses provided parameter.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect((reader as any).requireAppId(456)).toBe(456n)
  })

  test('require app id parameter overrides', () => {
    // Test requireAppId parameter overrides init value.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect((reader as any).requireAppId(789)).toBe(789n)
  })

  test('require app id not configured', () => {
    // Test requireAppId raises when appId not configured.
    const reader = new AsaMetadataRegistryRead({ appId: null })
    expect(() => (reader as any).requireAppId(null)).toThrow(RegistryResolutionError)
    expect(() => (reader as any).requireAppId(null)).toThrow(/Registry appId is not configured and was not provided/)
  })
})

describe('get params', () => {
  // Test getParams private method.
  test('get params returns defaults', async () => {
    // Test getParams returns default parameters.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    const params = await (reader as any).getParams()
    const defaults = getDefaultRegistryParams()
    expect(params.headerSize).toBe(defaults.headerSize)
    expect(params.maxMetadataSize).toBe(defaults.maxMetadataSize)
  })

  test('get params caches result', async () => {
    // Test getParams caches the result.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    const params1 = await (reader as any).getParams()
    const params2 = await (reader as any).getParams()
    expect(params1).toBe(params2)
  })

  test('get params from avm when available', async () => {
    // Test getParams fetches from AVM when available.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const customParams = RegistryParameters.defaults()
    mockAvm(123).arc89GetMetadataRegistryParameters.mockResolvedValue(customParams)

    const params = await (reader as any).getParams()
    expect(params).toBeInstanceOf(RegistryParameters)
    expect(params).toBe(customParams)
  })

  test('get params falls back on avm error', async () => {
    // Test getParams falls back to defaults if AVM fails.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    mockAvm(123).arc89GetMetadataRegistryParameters.mockRejectedValue(new Error('AVM error'))

    const params = await (reader as any).getParams()
    // Should fall back to defaults on error
    const defaults = getDefaultRegistryParams()
    expect(params.headerSize).toBe(defaults.headerSize)
    expect(params.maxMetadataSize).toBe(defaults.maxMetadataSize)
  })

  test('get params retries avm after error', async () => {
    // TS-only: the defaults are not cached after an AVM failure, so later reads retry.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const customParams = RegistryParameters.defaults()
    const getter = mockAvm(123).arc89GetMetadataRegistryParameters
    getter.mockRejectedValueOnce(new Error('AVM error')).mockResolvedValueOnce(customParams)

    expect(await (reader as any).getParams()).toBe(getDefaultRegistryParams())
    expect((reader as any).paramsCache).toBeNull()
    expect(await (reader as any).getParams()).toBe(customParams)
    expect(await (reader as any).getParams()).toBe(customParams)
    expect(getter).toHaveBeenCalledTimes(2)
  })
})

// ================================================================
// Sub-Reader Tests
// ================================================================

describe('sub readers', () => {
  // Test box and avm sub-reader properties.
  test('box property returns box reader', () => {
    // Test .box property returns AsaMetadataRegistryBoxRead.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    const boxReader = reader.box
    expect(boxReader).toBeInstanceOf(AsaMetadataRegistryBoxRead)
    expect(boxReader.algod).toBe(algodReader)
    expect(boxReader.appId).toBe(123n)
  })

  test('box property requires algod', () => {
    // Test .box property raises when algod not configured.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect(() => reader.box).toThrow(/BOX reader requires an algod client/)
  })

  test('box property requires app id', () => {
    // Test .box property raises when appId not configured.
    const reader = new AsaMetadataRegistryRead({ appId: null, algod: algodReader })
    expect(() => reader.box).toThrow(RegistryResolutionError)
    expect(() => reader.box).toThrow(/Registry appId is not configured/)
  })

  test('avm property returns avm reader', () => {
    // Test .avm() method returns AsaMetadataRegistryAvmRead.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    const avmReader = reader.avm()
    expect(avmFactory).toHaveBeenLastCalledWith(123n)
    expect(avmReader).toBe(mockAvm(123))
  })

  test('avm property with override app id', () => {
    // Test .avm() method accepts override appId.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    const avmReader = reader.avm({ appId: 456 })
    expect(avmFactory).toHaveBeenLastCalledWith(456n)
    expect(avmReader).toBe(mockAvm(456))
  })

  test('avm property requires factory', () => {
    // Test .avm() raises when factory not configured.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect(() => reader.avm()).toThrow(MissingAppClientError)
    expect(() => reader.avm()).toThrow(/AVM reader requires a generated AppClient/)
  })

  test('avm property requires app id', () => {
    // Test .avm() raises when appId not configured.
    const reader = new AsaMetadataRegistryRead({ appId: null, avmFactory })
    expect(() => reader.avm()).toThrow(RegistryResolutionError)
    expect(() => reader.avm()).toThrow(/Registry appId is not configured/)
  })
})

// ================================================================
// ARC-90 URI Resolution Tests
// ================================================================

describe('resolve arc90 uri', () => {
  // Test resolveArc90Uri method.
  test('explicit uri without trusted registry raises', async () => {
    // An explicit URI is never its own trust anchor.
    const reader = new AsaMetadataRegistryRead({ appId: null })
    const promise = reader.resolveArc90Uri({ metadataUri: 'algorand://app/123?box=AAAAAAAAAcg' })
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/No trusted registry/)
  })

  test('resolve from explicit uri', async () => {
    // Test resolution from explicit metadataUri parameter.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    const uri = await reader.resolveArc90Uri({
      metadataUri: 'algorand://app/123?box=AAAAAAAAAcg', // b64url of asset ID 456
    })
    expect(uri.appId).toBe(123n)
    expect(uri.assetId).toBe(456n)
  })

  test('resolve from partial uri raises', async () => {
    // Test resolution from partial URI raises error.
    const reader = new AsaMetadataRegistryRead({ appId: null })
    const promise = reader.resolveArc90Uri({ metadataUri: 'algorand://app/123?box=' })
    await expect(promise).rejects.toThrow(InvalidArc90UriError)
    await expect(promise).rejects.toThrow(/Metadata URI is partial; missing box value/)
  })

  test('resolve from asset id via algod', async () => {
    // Test resolution from assetId using algod ASA lookup.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    const expectedUri = new Arc90Uri({ netauth: null, appId: 123, boxName: null }).withAssetId(456)

    // Mock the method on the algod client, not the reader
    mockAssetInfo({ url: expectedUri.toUri() })

    const uri = await reader.resolveArc90Uri({ assetId: 456 })
    expect(uri.assetId).toBe(456n)
    expect(algod.getAssetByID).toHaveBeenCalledWith(456n)
  })

  test('resolve from asset id fallback to app id', async () => {
    // Test resolution falls back to configured appId when ASA lookup fails.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    // Mock the ASA with no URL
    mockAssetInfo({ url: '' })

    const uri = await reader.resolveArc90Uri({ assetId: 456 })
    expect(uri.appId).toBe(123n)
    expect(uri.assetId).toBe(456n)
  })

  test('resolve from asset id with override app id', async () => {
    // Test resolution uses override appId parameter.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    const uri = await reader.resolveArc90Uri({ assetId: 456, appId: 789 })
    expect(uri.appId).toBe(789n)
    expect(uri.assetId).toBe(456n)
  })

  test('resolve requires asset id or uri', async () => {
    // Test resolution raises when neither assetId nor metadataUri provided.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    const promise = reader.resolveArc90Uri({})
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/Either assetId or metadataUri must be provided/)
  })

  test('resolve requires app id without algod', async () => {
    // Test resolution raises when appId cannot be determined.
    const reader = new AsaMetadataRegistryRead({ appId: null })
    const promise = reader.resolveArc90Uri({ assetId: 456 })
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/Cannot resolve registry appId/)
  })
})

// ================================================================
// High-Level Metadata Retrieval Tests
// ================================================================

describe('get asset metadata', () => {
  // Test getAssetMetadata high-level method.
  test('auto prefers box', async () => {
    // Test AUTO source prefers BOX when algod available.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    mockAssetMetadataRecord(sampleAssetRecord)

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AUTO })

    expect(result).toEqual(sampleAssetRecord)
  })

  test('avm source explicit', async () => {
    // Test explicit AVM source when algod not available.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const avm = mockAvm(123)
    avm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)
    avm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 50, pageSize: 100, totalPages: 1, revision: 1000 }),
    )
    avm.simulateMany.mockResolvedValue([
      [false, 1000n, concatBytes([utf8('{"name": "test"}'), new Uint8Array(34)])], // Pad to 50 bytes
    ])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.assetId).toBe(456n)
  })

  test('box source', async () => {
    // Test explicit BOX source.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    mockAssetMetadataRecord(sampleAssetRecord)

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.BOX })

    expect(result).toEqual(sampleAssetRecord)
  })

  test('avm source single page', async () => {
    // Test AVM source with single-page metadata.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const avm = mockAvm(123)
    avm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)
    avm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 20, pageSize: 100, totalPages: 1, revision: 1000 }),
    )
    avm.simulateMany.mockResolvedValue([
      [false, 1000n, concatBytes([utf8('{"name": "test"}'), new Uint8Array(4)])], // Pad to 20 bytes
    ])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.assetId).toBe(456n)
    expect(result.appId).toBe(123n)
  })

  test('avm source multi page', async () => {
    // Test AVM source with multi-page metadata.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const avm = mockAvm(123)
    avm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)
    avm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 150, pageSize: 100, totalPages: 2, revision: 1000 }),
    )
    // Simulate two pages
    avm.simulateMany.mockResolvedValue([
      [false, 1000n, new Uint8Array(100).fill(0x41)],
      [false, 1000n, new Uint8Array(50).fill(0x42)],
    ])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.assetId).toBe(456n)
    expect(result.body.rawBytes.length).toBe(150)
  })

  test('avm detects drift', async () => {
    // Test AVM source detects metadata drift between pages.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const avm = mockAvm(123)
    avm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)
    avm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 150, pageSize: 100, totalPages: 2, revision: 1000 }),
    )
    // Different revision indicates drift
    avm.simulateMany.mockResolvedValue([
      [false, 1000n, utf8('page1')],
      [false, 1001n, utf8('page2')], // Different revision
    ])

    const promise = reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    await expect(promise).rejects.toThrow(MetadataDriftError)
    await expect(promise).rejects.toThrow(/Metadata changed between simulated page reads/)
  })

  test('avm detects pagination drift', async () => {
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    const avm = mockAvm(123)
    avm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)
    avm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 150, pageSize: 100, totalPages: 2, revision: 1001 }),
    )

    const promise = reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    await expect(promise).rejects.toThrow(MetadataDriftError)
    await expect(promise).rejects.toThrow(/Metadata changed between header and pagination reads/)
  })

  test('follows deprecation', async () => {
    // Test metadata follows deprecation chain.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader, trustedVersions: [789] })

    // First record points to deprecatedBy=789
    const deprecatedRecord = new AssetMetadataRecord({
      appId: 123,
      assetId: 456,
      header: metadataHeader({ deprecatedBy: 789, revision: 1000 }),
      body: new MetadataBody(utf8('{"old": "metadata"}')),
    })

    // Second record is the current one
    const currentRecord = new AssetMetadataRecord({
      appId: 789,
      assetId: 456,
      header: metadataHeader({ deprecatedBy: 0, revision: 2000 }),
      body: new MetadataBody(utf8('{"new": "metadata"}')),
    })

    // Mock returns the record of the requested registry
    algod.getApplicationBoxByName.mockImplementation((appId, name) => {
      const record = BigInt(appId) === 123n ? deprecatedRecord : currentRecord
      return resolvedRequest(boxModel(name, boxValue(record.header, record.body.rawBytes)))
    })
    mockAssetInfo({ url: '' })

    const result = await reader.getAssetMetadata({ assetId: 456, followDeprecation: true })

    expect(result.appId).toBe(789n)
    expect(result.header.revision).toBe(2000n)
  })

  test('stops deprecation loop', async () => {
    // Test deprecation following stops after max hops.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader, trustedVersions: [999] })

    // Circular deprecation: 123 -> 999 -> 123 -> ...
    algod.getApplicationBoxByName.mockImplementation((appId, name) => {
      const header = metadataHeader({ deprecatedBy: BigInt(appId) === 123n ? 999 : 123, revision: 1000 })
      return resolvedRequest(boxModel(name, boxValue(header, '{"loop": true}')))
    })
    mockAssetInfo({ url: '' })

    const promise = reader.getAssetMetadata({ assetId: 456, followDeprecation: true, maxDeprecationHops: 3 })
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/exceeded 3 hops/)
  })

  test('untrusted deprecation raises', async () => {
    // A Deprecated By pointer outside the trusted versions is never followed.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    mockBoxResponse(boxValue(metadataHeader({ deprecatedBy: 789, revision: 1000 }), '{}'))
    mockAssetInfo({})

    const promise = reader.getAssetMetadata({ assetId: 456, followDeprecation: true })
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/untrusted registry 789/)
  })

  test('searches trusted versions', async () => {
    // Absent from the oldest trusted version, the record is found in a newer one.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader, trustedVersions: [789] })
    const header = metadataHeader({ deprecatedBy: 0, revision: 7 })

    algod.getApplicationBoxByName.mockImplementation((appId, name) => {
      if (BigInt(appId) === 123n) return rejectedRequest(new Error('HTTP 404: box not found'))
      return resolvedRequest(boxModel(name, boxValue(header, '{"v": 2}')))
    })
    mockAssetInfo({})

    expect((await reader.getAssetMetadata({ assetId: 456 })).appId).toBe(789n)
  })

  test.each([{ driftRetries: -1 }, { maxDeprecationHops: -1 }])('rejects negative limits %o', async (limits) => {
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    const promise = reader.getAssetMetadata({ assetId: 456, ...limits })
    await expect(promise).rejects.toThrow(RangeError)
    await expect(promise).rejects.toThrow(/>= 0/)
  })

  test('no deprecation follow', async () => {
    // Test metadata doesn't follow deprecation when disabled.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    const deprecatedRecord = new AssetMetadataRecord({
      appId: 123,
      assetId: 456,
      header: metadataHeader({ deprecatedBy: 789, revision: 1000 }),
      body: new MetadataBody(utf8('{"old": "metadata"}')),
    })

    mockAssetMetadataRecord(deprecatedRecord)

    const result = await reader.getAssetMetadata({ assetId: 456, followDeprecation: false })

    expect(result.appId).toBe(123n)
    expect(result.header.deprecatedBy).toBe(789n)
  })

  test('auto no source available', async () => {
    // Test AUTO source raises when neither algod nor avm available.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })

    const promise = reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AUTO })
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/No read source available/)
  })

  test('box source not configured', async () => {
    // Test BOX source raises when algod not configured.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })

    await expect(reader.getAssetMetadata({ assetId: 456, source: MetadataSource.BOX })).rejects.toThrow(
      /BOX source selected but algod is not configured/,
    )
  })
})

// ================================================================
// Dispatcher Methods Tests
// ================================================================

describe('dispatcher methods', () => {
  let reader: AsaMetadataRegistryRead
  let readerAvmConfig: AsaMetadataRegistryRead
  let readerBoxConfig: AsaMetadataRegistryRead

  beforeEach(() => {
    reader = new AsaMetadataRegistryRead({ appId: 123 })
    readerAvmConfig = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    readerBoxConfig = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
  })

  describe('get registry parameters', () => {
    // Test arc89GetMetadataRegistryParameters dispatcher.
    test('uses avm when available', async () => {
      // Test dispatcher uses AVM when available.
      const customParams = RegistryParameters.defaults()
      mockAvm(123).arc89GetMetadataRegistryParameters.mockResolvedValue(customParams)

      // Call with explicit AVM source
      const result = await readerAvmConfig.arc89GetMetadataRegistryParameters({ source: MetadataSource.AVM })
      expect(result).toBeInstanceOf(RegistryParameters)
      expect(result).toBe(customParams)
    })

    test('falls back to defaults', async () => {
      // Test dispatcher falls back to defaults when AVM not available.
      const result = await reader.arc89GetMetadataRegistryParameters()
      const defaults = getDefaultRegistryParams()
      expect(result.headerSize).toBe(defaults.headerSize)
    })
  })

  describe('get partial uri', () => {
    // Test arc89GetMetadataPartialUri dispatcher.
    test('requires avm', async () => {
      // Test dispatcher requires AVM access.
      const promise = reader.arc89GetMetadataPartialUri()
      await expect(promise).rejects.toThrow(MissingAppClientError)
      await expect(promise).rejects.toThrow(/getMetadataPartialUri requires AVM access/)
    })

    test('uses avm when available', async () => {
      // Test dispatcher uses AVM.
      const avm = mockAvm(123)
      avm.arc89GetMetadataPartialUri.mockResolvedValue('algorand://app/123')

      await readerAvmConfig.arc89GetMetadataPartialUri({ source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataPartialUri).toHaveBeenCalledOnce()
    })
  })

  describe('get mbr delta', () => {
    // Test arc89GetMetadataMbrDelta dispatcher.
    test('requires avm source', async () => {
      // Test MBR delta getter requires AVM source.
      await expect(
        reader.arc89GetMetadataMbrDelta({ assetId: 456, newSize: 100, source: MetadataSource.BOX }),
      ).rejects.toThrow(/MBR delta getter is AVM-only/)
    })

    test('uses avm', async () => {
      // Test dispatcher uses AVM.
      const delta = new MbrDelta({ sign: MbrDeltaSign.POS, amount: 5000 })
      const avm = mockAvm(123)
      avm.arc89GetMetadataMbrDelta.mockResolvedValue(delta)

      await readerAvmConfig.arc89GetMetadataMbrDelta({ assetId: 456, newSize: 100 })
      expect(avm.arc89GetMetadataMbrDelta).toHaveBeenCalledOnce()
    })
  })

  describe('check metadata exists', () => {
    // Test arc89CheckMetadataExists dispatcher.
    test('auto prefers box', async () => {
      // Test AUTO source prefers BOX.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"test": "data"}'))
      mockAssetInfo(null)

      const result = await readerBoxConfig.arc89CheckMetadataExists({ assetId: 456 })
      expect(result.asaExists).toBe(true)
      expect(result.metadataExists).toBe(true)
    })

    test('uses avm when box unavailable', async () => {
      // Test uses AVM when BOX not available.
      const avm = mockAvm(123)
      avm.arc89CheckMetadataExists.mockResolvedValue(new MetadataExistence({ asaExists: true, metadataExists: false }))

      await readerAvmConfig.arc89CheckMetadataExists({ assetId: 456, source: MetadataSource.AVM })
      expect(avm.arc89CheckMetadataExists).toHaveBeenCalledOnce()
    })
  })

  describe('is metadata immutable', () => {
    // Test arc89IsMetadataImmutable dispatcher.
    test('auto prefers box', async () => {
      // Test AUTO source prefers BOX.
      const flags = new MetadataFlags({
        reversible: ReversibleFlags.empty(),
        irreversible: new IrreversibleFlags({ immutable: true, arc3: false, arc89Native: false }),
      })
      mockBoxResponse(boxValue(metadataHeader({ flags, deprecatedBy: 0, revision: 1000 }), '{"test": "data"}'))

      const result = await readerBoxConfig.arc89IsMetadataImmutable({ assetId: 456, source: MetadataSource.BOX })
      expect(result).toBe(true)
    })

    test.each([
      { label: 'manager set', params: { manager: MANAGER_ADDR }, expected: false },
      { label: 'no manager', params: {}, expected: true },
      { label: 'zero address manager', params: { manager: ALGORAND_ZERO_ADDRESS_STRING }, expected: true },
    ])('box applies manager rule: $label', async ({ params, expected }) => {
      // A mutable record is immutable once the ASA Manager Address is cleared.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{}'))
      mockAssetInfo(params)
      expect(await readerBoxConfig.arc89IsMetadataImmutable({ assetId: 456, source: MetadataSource.BOX })).toBe(
        expected,
      )
    })

    test('uses avm fallback', async () => {
      // Test uses AVM when BOX not available.
      const avm = mockAvm(123)
      avm.arc89IsMetadataImmutable.mockResolvedValue(false)

      await readerAvmConfig.arc89IsMetadataImmutable({ assetId: 456, source: MetadataSource.AVM })
      expect(avm.arc89IsMetadataImmutable).toHaveBeenCalledOnce()
    })
  })

  describe('is metadata short', () => {
    // Test arc89IsMetadataShort dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const header = metadataHeader({ identifiers: bitmasks.MASK_ID_SHORT, deprecatedBy: 0, revision: 1000 })
      mockBoxResponse(boxValue(header, '{"small": "data"}'))

      const [isShort, revision] = await readerBoxConfig.arc89IsMetadataShort({
        assetId: 456,
        source: MetadataSource.BOX,
      })
      expect(isShort).toBe(true)
      expect(revision).toBe(1000n)
    })

    test('avm source', async () => {
      // Test AVM source.
      const avm = mockAvm(123)
      avm.arc89IsMetadataShort.mockResolvedValue([false, 2000n] as const)

      await readerAvmConfig.arc89IsMetadataShort({ assetId: 456, source: MetadataSource.AVM })
      expect(avm.arc89IsMetadataShort).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata header', () => {
    // Test arc89GetMetadataHeader dispatcher.
    test('box source', async () => {
      // Test BOX source.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"test": "data"}'))

      const result = await readerBoxConfig.arc89GetMetadataHeader({ assetId: 456, source: MetadataSource.BOX })
      expect(result.revision).toBe(sampleMetadataHeader.revision)
    })

    test('avm source', async () => {
      // Test AVM source.
      mockAvm(123).arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)

      const result = await readerAvmConfig.arc89GetMetadataHeader({ assetId: 456, source: MetadataSource.AVM })
      expect(result).toEqual(sampleMetadataHeader)
    })
  })

  describe('get metadata pagination', () => {
    // Test arc89GetMetadataPagination dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const metadataContent = utf8('{"test": "data"}'.repeat(10)) // 160 bytes
      mockBoxResponse(boxValue(sampleMetadataHeader, metadataContent))

      const result = await readerBoxConfig.arc89GetMetadataPagination({ assetId: 456, source: MetadataSource.BOX })
      expect(result.metadataSize).toBe(metadataContent.length)
      expect(result.revision).toBe(sampleMetadataHeader.revision)
      expect(result.deprecatedBy).toBe(sampleMetadataHeader.deprecatedBy)
    })

    test('box source uses on chain registry parameters', async () => {
      // Python's `box` property resolves the registry parameters (on-chain via AVM when available).
      const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader, avmFactory })
      const onChainParams = new RegistryParameters({ ...getDefaultRegistryParams(), pageSize: 100 })
      const getter = mockAvm(123).arc89GetMetadataRegistryParameters
      getter.mockResolvedValue(onChainParams)
      const metadataContent = utf8('{"test": "data"}'.repeat(10)) // 160 bytes
      mockBoxResponse(boxValue(sampleMetadataHeader, metadataContent))

      const result = await reader.arc89GetMetadataPagination({ assetId: 456, source: MetadataSource.BOX })
      expect(result.pageSize).toBe(100)
      expect(result.totalPages).toBe(2)
      await reader.arc89GetMetadataHeader({ assetId: 456, source: MetadataSource.BOX })
      expect(getter).toHaveBeenCalledOnce() // cached
    })

    test('avm source', async () => {
      // Test AVM source.
      const pagination = new Pagination({
        deprecatedBy: 0,
        metadataSize: 150,
        pageSize: 100,
        totalPages: 2,
        revision: 1000,
      })
      const avm = mockAvm(123)
      avm.arc89GetMetadataPagination.mockResolvedValue(pagination)

      await readerAvmConfig.arc89GetMetadataPagination({ assetId: 456, source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataPagination).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata (paginated)', () => {
    // Test arc89GetMetadata (paginated) dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const pageContent = utf8('{"page": 0}')
      mockBoxResponse(boxValue(sampleMetadataHeader, pageContent))

      const result = await readerBoxConfig.arc89GetMetadata({ assetId: 456, page: 0, source: MetadataSource.BOX })
      expect(result.pageContent).toEqual(pageContent)
    })

    test('avm source', async () => {
      // Test AVM source.
      const pageData = new PaginatedMetadata({ hasNextPage: false, revision: 2000, pageContent: utf8('page1') })
      const avm = mockAvm(123)
      avm.arc89GetMetadata.mockResolvedValue(pageData)

      await readerAvmConfig.arc89GetMetadata({ assetId: 456, page: 1, source: MetadataSource.AVM })
      expect(avm.arc89GetMetadata).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata slice', () => {
    // Test arc89GetMetadataSlice dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const metadataContent = utf8('0123456789'.repeat(10))
      mockBoxResponse(boxValue(sampleMetadataHeader, metadataContent))

      const result = await readerBoxConfig.arc89GetMetadataSlice({
        assetId: 456,
        offset: 10,
        size: 20,
        source: MetadataSource.BOX,
      })
      expect(result.revision).toBe(sampleMetadataHeader.revision)
      expect(result.content).toEqual(metadataContent.slice(10, 30))
    })

    test('avm source', async () => {
      // Test AVM source.
      const avm = mockAvm(123)
      avm.arc89GetMetadataSlice.mockResolvedValue(new MetadataSlice({ revision: 1000, content: utf8('avm_slice') }))

      await readerAvmConfig.arc89GetMetadataSlice({ assetId: 456, offset: 5, size: 15, source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataSlice).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata header hash', () => {
    // Test arc89GetMetadataHeaderHash dispatcher.
    test('box source', async () => {
      // Test BOX source.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"test": "data"}'))

      const result = await readerBoxConfig.arc89GetMetadataHeaderHash({ assetId: 456, source: MetadataSource.BOX })
      expect(result[0].length).toBe(32)
      expect(result[1]).toBe(sampleMetadataHeader.revision)
    })

    test('avm source', async () => {
      // Test AVM source.
      const headerHash = new Uint8Array(32).fill(0x02)
      const avm = mockAvm(123)
      avm.arc89GetMetadataHeaderHash.mockResolvedValue([headerHash, 1000n] as const)

      await readerAvmConfig.arc89GetMetadataHeaderHash({ assetId: 456, source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataHeaderHash).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata page hash', () => {
    // Test arc89GetMetadataPageHash dispatcher.
    test('box source', async () => {
      // Test BOX source.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"page": "data"}'))

      const result = await readerBoxConfig.arc89GetMetadataPageHash({
        assetId: 456,
        page: 0,
        source: MetadataSource.BOX,
      })
      expect(result[0].length).toBe(32)
      expect(result[1]).toBe(sampleMetadataHeader.revision)
    })

    test('avm source', async () => {
      // Test AVM source.
      const pageHash = new Uint8Array(32).fill(0x04)
      const avm = mockAvm(123)
      avm.arc89GetMetadataPageHash.mockResolvedValue([pageHash, 1000n] as const)

      await readerAvmConfig.arc89GetMetadataPageHash({ assetId: 456, page: 1, source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataPageHash).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata hash', () => {
    // Test arc89GetMetadataHash dispatcher.
    test('box source', async () => {
      // Test BOX source.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"metadata": "test"}'))

      const result = await readerBoxConfig.arc89GetMetadataHash({ assetId: 456, source: MetadataSource.BOX })
      expect(result[0].length).toBe(32)
      expect(result[1]).toBe(sampleMetadataHeader.revision)
    })

    test('avm source', async () => {
      // Test AVM source.
      const metadataHash = new Uint8Array(32).fill(0x06)
      const avm = mockAvm(123)
      avm.arc89GetMetadataHash.mockResolvedValue([metadataHash, 1000n] as const)

      await readerAvmConfig.arc89GetMetadataHash({ assetId: 456, source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataHash).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata string by key', () => {
    // Test arc89GetMetadataStringByKey dispatcher.
    test('auto prefers avm', async () => {
      // Test AUTO source prefers AVM for parity.
      const avm = mockAvm(123)
      avm.arc89GetMetadataStringByKey.mockResolvedValue('test_value')

      await readerAvmConfig.arc89GetMetadataStringByKey({ assetId: 456, key: 'name', source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataStringByKey).toHaveBeenCalledOnce()
    })

    test('falls back to box', async () => {
      // Test falls back to BOX when AVM not available.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"name": "box_value"}'))

      const result = await readerBoxConfig.arc89GetMetadataStringByKey({
        assetId: 456,
        key: 'name',
        source: MetadataSource.BOX,
      })
      expect(result).toBe('box_value')
    })
  })

  describe('get metadata uint64 by key', () => {
    // Test arc89GetMetadataUint64ByKey dispatcher.
    test('auto prefers avm', async () => {
      // Test AUTO source prefers AVM.
      const avm = mockAvm(123)
      avm.arc89GetMetadataUint64ByKey.mockResolvedValue(42n)

      await readerAvmConfig.arc89GetMetadataUint64ByKey({ assetId: 456, key: 'value', source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataUint64ByKey).toHaveBeenCalledOnce()
    })

    test('falls back to box', async () => {
      // Test falls back to BOX when AVM not available.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"count": 100}'))

      const result = await readerBoxConfig.arc89GetMetadataUint64ByKey({
        assetId: 456,
        key: 'count',
        source: MetadataSource.BOX,
      })
      expect(result).toBe(100n)
    })

    test.each(['1.0', '1e3', '-1', 'true', '18446744073709551616'])('box rejects non uint64 %s', async (value) => {
      // JSON Uint64 is an integer literal in 0..2^64-1, as json_ref extracts it.
      mockBoxResponse(boxValue(sampleMetadataHeader, `{"count": ${value}}`))
      await expect(
        readerBoxConfig.arc89GetMetadataUint64ByKey({ assetId: 456, key: 'count', source: MetadataSource.BOX }),
      ).rejects.toThrow(MetadataKeyError)
    })
  })

  describe('get metadata object by key', () => {
    // Test arc89GetMetadataObjectByKey dispatcher.
    test('avm source', async () => {
      // Test AVM source.
      const avm = mockAvm(123)
      avm.arc89GetMetadataObjectByKey.mockResolvedValue('{"nested": true}')

      await readerAvmConfig.arc89GetMetadataObjectByKey({ assetId: 456, key: 'data', source: MetadataSource.AVM })
      expect(avm.arc89GetMetadataObjectByKey).toHaveBeenCalledOnce()
    })

    test('box fallback', async () => {
      // Test BOX fallback.
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"config": {"box": "object"}}'))

      const result = await readerBoxConfig.arc89GetMetadataObjectByKey({
        assetId: 456,
        key: 'config',
        source: MetadataSource.BOX,
      })
      // Should return serialized object
      const obj = JSON.parse(result)
      expect(obj).toHaveProperty('box')
    })
  })

  describe('get metadata b64 bytes by key', () => {
    // Test arc89GetMetadataB64BytesByKey dispatcher.
    test('avm source', async () => {
      // Test AVM source.
      const avm = mockAvm(123)
      avm.arc89GetMetadataB64BytesByKey.mockResolvedValue(utf8('decoded_bytes'))

      await readerAvmConfig.arc89GetMetadataB64BytesByKey({
        assetId: 456,
        key: 'image',
        b64Encoding: 0,
        source: MetadataSource.AVM,
      })
      expect(avm.arc89GetMetadataB64BytesByKey).toHaveBeenCalledOnce()
    })

    test('box fallback', async () => {
      // Test BOX fallback.
      // Base64 standard encoding of "hello"
      mockBoxResponse(boxValue(sampleMetadataHeader, '{"data": "aGVsbG8="}'))

      const result = await readerBoxConfig.arc89GetMetadataB64BytesByKey({
        assetId: 456,
        key: 'data',
        b64Encoding: B64_STD_ENCODING,
        source: MetadataSource.BOX,
      })
      expect(result).toEqual(utf8('hello'))
    })
  })
})

// ================================================================
// Edge Cases and Error Handling Tests
// ================================================================

describe('edge cases', () => {
  // Test edge cases and error scenarios.
  test('unknown metadata source is validated', () => {
    // Test that MetadataSource enum is properly validated.
    new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    // Test that we can use valid enum values
    // (The actual dispatching logic handles all valid enum values)
    // This test verifies the enum is properly defined
    expect(Object.values(MetadataSource)).toContain(MetadataSource.AUTO)
    expect(Object.values(MetadataSource)).toContain(MetadataSource.BOX)
    expect(Object.values(MetadataSource)).toContain(MetadataSource.AVM)
  })

  test('empty metadata pagination', async () => {
    // Test AVM read with zero-size metadata.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const avm = mockAvm(123)
    avm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)
    // Zero pages
    avm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 0, pageSize: 100, totalPages: 0, revision: 1000 }),
    )
    avm.simulateMany.mockResolvedValue([])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.body.rawBytes.length).toBe(0)
  })

  test('simulate options passed through', async () => {
    // Test that SimulateOptions are passed through to AVM calls.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const avm = mockAvm(123)
    avm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)

    const simulateOpts: SimulateOptions = { extraOpcodeBudget: 1000 }

    await reader.arc89GetMetadataHeader({ assetId: 456, source: MetadataSource.AVM, simulate: simulateOpts })
    expect(avm.arc89GetMetadataHeader).toHaveBeenCalledOnce()
    expect(avm.arc89GetMetadataHeader).toHaveBeenCalledWith({ assetId: 456, simulate: simulateOpts })
  })

  test('simulate options merged over the defaults', async () => {
    // Test that custom SimulateOptions keep the default AVM read options.
    const simulate = vi.fn().mockResolvedValue({ returns: [] })
    const composer = { arc89GetMetadataPartialUri: vi.fn(), simulate }
    const avm = new AsaMetadataRegistryAvmRead({
      client: { newGroup: () => composer } as unknown as AsaMetadataRegistryClient,
    })

    await avm.arc89GetMetadataPartialUri({ simulate: { extraOpcodeBudget: 1000 } })
    expect(simulate).toHaveBeenCalledWith({ ...DEFAULT_SIMULATE_OPTIONS, extraOpcodeBudget: 1000 })
  })

  test('deprecation self reference stops', async () => {
    // Test that self-referencing deprecatedBy doesn't loop.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    // deprecatedBy equals current appId (self-reference)
    const record = new AssetMetadataRecord({
      appId: 123,
      assetId: 456,
      header: metadataHeader({ deprecatedBy: 123, revision: 1000 }), // Same as appId
      body: new MetadataBody(utf8('{"self": "ref"}')),
    })

    mockAssetMetadataRecord(record)

    const result = await reader.getAssetMetadata({ assetId: 456, followDeprecation: true })

    // Should stop immediately since deprecatedBy == current appId
    expect(result.appId).toBe(123n)
  })

  test('metadata uri takes precedence over asset id', async () => {
    // Test that explicit metadataUri takes precedence.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    // Even if assetId is provided, URI should be used
    const uri = await reader.resolveArc90Uri({
      assetId: 999, // This should be ignored
      metadataUri: 'algorand://app/123?box=AAAAAAAAAcg', // b64url of asset ID 456
    })

    expect(uri.appId).toBe(123n)
    expect(uri.assetId).toBe(456n)
  })

  test('metadata uri naming another registry raises', async () => {
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    const promise = reader.resolveArc90Uri({ metadataUri: 'algorand://app/789?box=AAAAAAAAAcg' })
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/trusted registry is 123/)
  })

  test.each([
    'algorand://app/4242?box=#arc89', // another registry
    'algorand://app/123?box=AAAAAAAAMDk#arc89', // pre-filled box
    'algorand://app/123?box=#arc89', // another network
    'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi#arc3',
  ])('asset url is informational %j', async (url) => {
    // Discovery is the look-up on the trusted registry; the Asset URL is never followed.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader, netauth: 'net:testnet' })
    mockAssetInfo({ url })
    const uri = await reader.resolveArc90Uri({ assetId: 999 })
    expect([uri.netauth, uri.appId, uri.assetId]).toEqual(['net:testnet', 123n, 999n])
  })

  test('resolve from held asset url', async () => {
    // A held native Asset URL is completed and trust-checked without fetching the ASA.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    const uri = await reader.resolveArc90UriFromAssetUrl({ assetId: 999, assetUrl: 'algorand://app/123?box=#arc89' })
    expect(uri).not.toBeNull()
    expect([uri!.appId, uri!.assetId]).toEqual([123n, 999n])
    expect(algod.getAssetByID).not.toHaveBeenCalled()
  })

  test.each([
    'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi#arc3',
    'algorand://app/123?box=AAAAAAAAMDk#arc89', // pre-filled box
    '',
  ])('held asset url not arc89 returns null %j', async (url) => {
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect(await reader.resolveArc90UriFromAssetUrl({ assetId: 999, assetUrl: url })).toBeNull()
  })

  test('held asset url naming another registry raises', async () => {
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    const promise = reader.resolveArc90UriFromAssetUrl({ assetId: 999, assetUrl: 'algorand://app/4242?box=#arc89' })
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/trusted registry is 123/)
  })

  test('missing asa raises', async () => {
    // A record of a destroyed or unknown ASA is not discovered.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    algod.getAssetByID.mockImplementation(() => rejectedRequest(new Error('asset does not exist')))
    await expect(reader.resolveArc90Uri({ assetId: 999 })).rejects.toThrow(AsaNotFoundError)
  })
})

// ================================================================
// TS-only: Trusted Registry Resolution Tests
// ================================================================

describe('trusted registry resolution', () => {
  // Network-dependent resolution (the default MOCK algod has no genesis hash).
  test('canonical look-up uses the deployment of the connected network', async () => {
    mockGenesisHash(b64Decode(TESTNET_GH_B64))
    mockAssetInfo({})
    const reader = new AsaMetadataRegistryRead({ appId: null, algod: algodReader })

    const uri = await reader.resolveArc90Uri({ assetId: 456 })
    expect([uri.netauth, uri.appId, uri.assetId]).toEqual([
      'net:testnet',
      BigInt(TESTNET_ASA_METADATA_REGISTRY_APP_ID),
      456n,
    ])
  })

  test('canonical look-up on an unknown network derives a gh netauth', async () => {
    const genesisHash = new Uint8Array(32).fill(0x01)
    mockGenesisHash(genesisHash)
    mockAssetInfo({})
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    const uri = await reader.resolveArc90Uri({ assetId: 456 })
    expect([uri.netauth, uri.appId, uri.assetId]).toEqual([`gh:${b64UrlEncode(genesisHash)}`, 123n, 456n])
  })

  test.each([
    { label: 'MainNet (registry app id TBD)', genesisHash: b64Decode(MAINNET_GH_B64) },
    { label: 'unknown network', genesisHash: new Uint8Array(32).fill(0x01) },
  ])('no trusted registry on $label', async ({ genesisHash }) => {
    mockGenesisHash(genesisHash)
    mockAssetInfo({})
    const reader = new AsaMetadataRegistryRead({ appId: null, algod: algodReader })

    await expect(reader.resolveArc90Uri({ assetId: 456 })).rejects.toThrow(/Cannot resolve registry appId/)
    await expect(reader.resolveArc90Uri({ metadataUri: 'algorand://app/123?box=AAAAAAAAAcg' })).rejects.toThrow(
      /No trusted registry/,
    )
  })

  test('explicit uri must denote the connected network', async () => {
    mockGenesisHash(b64Decode(TESTNET_GH_B64))
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    const uriFor = (netauth: string | null) =>
      new Arc90Uri({ netauth, appId: 123, boxName: null }).withAssetId(456).toUri()

    for (const netauth of ['net:testnet', `gh:${b64UrlEncode(b64Decode(TESTNET_GH_B64))}`]) {
      expect((await reader.resolveArc90Uri({ metadataUri: uriFor(netauth) })).netauth).toBe(netauth)
    }
    for (const netauth of [null, 'net:localnet']) {
      const promise = reader.resolveArc90Uri({ metadataUri: uriFor(netauth) })
      await expect(promise).rejects.toThrow(RegistryResolutionError)
      await expect(promise).rejects.toThrow(/does not denote the connected network/)
    }
  })

  test('explicit uri must match the configured netauth', async () => {
    const reader = new AsaMetadataRegistryRead({ appId: 123, netauth: 'net:testnet' })

    const uri = await reader.resolveArc90UriFromAssetUrl({
      assetId: 999,
      assetUrl: 'algorand://net:testnet/app/123?box=#arc89',
    })
    expect(uri?.netauth).toBe('net:testnet')

    const promise = reader.resolveArc90Uri({ metadataUri: 'algorand://app/123?box=AAAAAAAAAcg' })
    await expect(promise).rejects.toThrow(RegistryResolutionError)
    await expect(promise).rejects.toThrow(/does not match/)
  })

  test('canonical look-up via avm picks the oldest trusted version holding the record', async () => {
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory, trustedVersions: [789] })
    mockAvm(123).arc89CheckMetadataExists.mockResolvedValue(
      new MetadataExistence({ asaExists: true, metadataExists: false }),
    )
    const avm789 = mockAvm(789)
    avm789.arc89CheckMetadataExists.mockResolvedValue(new MetadataExistence({ asaExists: true, metadataExists: true }))
    avm789.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)
    avm789.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 0, pageSize: 100, totalPages: 0, revision: 1000 }),
    )

    const result = await reader.getAssetMetadata({ assetId: 456 })
    expect(result.appId).toBe(789n)
    expect(mockAvm(123).arc89GetMetadataHeader).not.toHaveBeenCalled()
  })
})

// ================================================================
// TS-only: Drift Retries Tests
// ================================================================

describe('drift retries', () => {
  // Non-atomic AVM reads observing a Revision change are retried up to `driftRetries` times.
  const pageA = new Uint8Array(100).fill(0x41)
  const pageB = new Uint8Array(50).fill(0x42)

  const mockTwoPageAvm = () => {
    const avm = mockAvm(123)
    avm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeader)
    avm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 150, pageSize: 100, totalPages: 2, revision: 1000 }),
    )
    return avm
  }

  test('drifting avm read is retried until consistent', async () => {
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    const avm = mockTwoPageAvm()
    avm.simulateMany
      .mockResolvedValueOnce([
        [true, 1000n, pageA],
        [false, 1001n, pageB],
      ])
      .mockResolvedValueOnce([
        [true, 1000n, pageA],
        [false, 1000n, pageB],
      ])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.body.rawBytes).toEqual(concatBytes([pageA, pageB]))
    expect(avm.simulateMany).toHaveBeenCalledTimes(2)
  })

  test.each([
    { label: 'default 2 retries', driftRetries: undefined, attempts: 3 },
    { label: 'no retries', driftRetries: 0, attempts: 1 },
    { label: '1 retry', driftRetries: 1, attempts: 2 },
  ])('drifting avm read is attempted driftRetries + 1 times: $label', async ({ driftRetries, attempts }) => {
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    const avm = mockTwoPageAvm()
    avm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ deprecatedBy: 0, metadataSize: 150, pageSize: 100, totalPages: 2, revision: 1001 }),
    )

    await expect(reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM, driftRetries })).rejects.toThrow(
      MetadataDriftError,
    )
    expect(avm.arc89GetMetadataHeader).toHaveBeenCalledTimes(attempts)
  })

  test('avm read detects assembled size mismatch', async () => {
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    const avm = mockTwoPageAvm()
    avm.simulateMany.mockResolvedValue([[false, 1000n, pageA]])

    const promise = reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    await expect(promise).rejects.toThrow(MetadataDriftError)
    await expect(promise).rejects.toThrow(/Assembled metadata size does not match the pagination size/)
  })

  test('other errors are not retried', async () => {
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    algod.getApplicationBoxByName.mockImplementation(() => rejectedRequest(new Error('HTTP 404: box not found')))
    mockAssetInfo({})

    await expect(reader.getAssetMetadata({ assetId: 456 })).rejects.toThrow(BoxNotFoundError)
    expect(algod.getApplicationBoxByName).toHaveBeenCalledOnce()
  })
})

// ================================================================
// TS-only: Box Reader Strictness Tests
// ================================================================

describe('box reader strictness', () => {
  // The BOX getters fail like their AVM counterparts.
  let reader: AsaMetadataRegistryRead

  beforeEach(() => {
    reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
  })

  test('check metadata exists maps not found errors', async () => {
    algod.getApplicationBoxByName.mockImplementation(() => rejectedRequest(new Error('HTTP 404: box not found')))
    algod.getAssetByID.mockImplementation(() => rejectedRequest(new Error('asset does not exist')))

    const result = await reader.arc89CheckMetadataExists({ assetId: 456, source: MetadataSource.BOX })
    expect([result.asaExists, result.metadataExists]).toEqual([false, false])
  })

  test('check metadata exists propagates other algod errors', async () => {
    algod.getApplicationBoxByName.mockImplementation(() => rejectedRequest(new Error('connection refused')))
    mockAssetInfo({})

    await expect(reader.arc89CheckMetadataExists({ assetId: 456, source: MetadataSource.BOX })).rejects.toThrow(
      /connection refused/,
    )
  })

  test('get metadata page bounds', async () => {
    mockBoxResponse(boxValue(sampleMetadataHeader, '{"page": 0}'))
    for (const page of [-1, 1]) {
      await expect(reader.arc89GetMetadata({ assetId: 456, page, source: MetadataSource.BOX })).rejects.toThrow(
        InvalidPageIndexError,
      )
      await expect(reader.arc89GetMetadataPageHash({ assetId: 456, page, source: MetadataSource.BOX })).rejects.toThrow(
        InvalidPageIndexError,
      )
    }

    // Page 0 of empty Metadata is valid, but it has no page hash
    mockBoxResponse(boxValue(sampleMetadataHeader, ''))
    const empty = await reader.arc89GetMetadata({ assetId: 456, page: 0, source: MetadataSource.BOX })
    expect([empty.hasNextPage, empty.revision, empty.pageContent]).toEqual([false, 1000n, new Uint8Array()])
    await expect(
      reader.arc89GetMetadataPageHash({ assetId: 456, page: 0, source: MetadataSource.BOX }),
    ).rejects.toThrow(InvalidPageIndexError)
  })

  test.each([
    { label: 'negative offset', offset: -1, size: 1, message: /Slice size must be within \[0, PAGE_SIZE\]/ },
    { label: 'negative size', offset: 0, size: -1, message: /Slice size must be within \[0, PAGE_SIZE\]/ },
    { label: 'size over PAGE_SIZE', offset: 0, size: PAGE_SIZE + 1, message: /Slice size must be within/ },
    { label: 'past the Metadata end', offset: 91, size: 10, message: /Slice exceeds the Metadata size/ },
  ])('get metadata slice rejects $label', async ({ offset, size, message }) => {
    mockBoxResponse(boxValue(sampleMetadataHeader, '0123456789'.repeat(10)))

    const promise = reader.arc89GetMetadataSlice({ assetId: 456, offset, size, source: MetadataSource.BOX })
    await expect(promise).rejects.toThrow(InvalidSliceError)
    await expect(promise).rejects.toThrow(message)
  })

  const jsonGetters = {
    string: (r: AsaMetadataRegistryRead, key: string) =>
      r.arc89GetMetadataStringByKey({ assetId: 456, key, source: MetadataSource.BOX }),
    uint64: (r: AsaMetadataRegistryRead, key: string) =>
      r.arc89GetMetadataUint64ByKey({ assetId: 456, key, source: MetadataSource.BOX }),
    object: (r: AsaMetadataRegistryRead, key: string) =>
      r.arc89GetMetadataObjectByKey({ assetId: 456, key, source: MetadataSource.BOX }),
    b64: (r: AsaMetadataRegistryRead, key: string) =>
      r.arc89GetMetadataB64BytesByKey({ assetId: 456, key, b64Encoding: B64_STD_ENCODING, source: MetadataSource.BOX }),
  }

  test.each([
    {
      label: 'not short metadata',
      json: `{"name": "${'x'.repeat(SHORT_METADATA_SIZE)}"}`,
      getter: 'string' as const,
      key: 'name',
      error: MetadataEncodingError,
      message: /JSON getters require short Metadata/,
    },
    {
      label: 'missing key',
      json: '{"other": "value"}',
      getter: 'uint64' as const,
      key: 'name',
      error: MetadataKeyError,
      message: /^name$/,
    },
    {
      label: 'not a JSON String',
      json: '{"name": 1}',
      getter: 'string' as const,
      key: 'name',
      error: MetadataKeyError,
      message: /name: not a JSON String/,
    },
    {
      label: 'not a JSON Object',
      json: '{"config": [1]}',
      getter: 'object' as const,
      key: 'config',
      error: MetadataKeyError,
      message: /config: not a JSON Object/,
    },
    {
      label: 'value exceeds PAGE_SIZE',
      json: `{"name": "${'x'.repeat(PAGE_SIZE + 1)}"}`,
      getter: 'string' as const,
      key: 'name',
      error: MetadataEncodingError,
      message: /JSON value exceeds PAGE_SIZE/,
    },
    {
      label: 'stored object value exceeds PAGE_SIZE',
      json: `{"config": {"a": 1${' '.repeat(PAGE_SIZE)}}}`,
      getter: 'object' as const,
      key: 'config',
      error: MetadataEncodingError,
      message: /JSON value exceeds PAGE_SIZE/,
    },
    {
      label: 'invalid base64',
      json: '{"data": "not base64!"}',
      getter: 'b64' as const,
      key: 'data',
      error: MetadataEncodingError,
      message: /data: invalid base64 value/,
    },
    {
      label: 'decoded base64 value exceeds PAGE_SIZE',
      json: `{"data": "${Buffer.alloc(PAGE_SIZE + 1).toString('base64')}"}`,
      getter: 'b64' as const,
      key: 'data',
      error: MetadataEncodingError,
      message: /JSON value exceeds PAGE_SIZE/,
    },
    {
      label: 'number outside the float64 range',
      json: '{"name": "x", "v": [1, {"w": -1e400}]}',
      getter: 'string' as const,
      key: 'name',
      error: MetadataEncodingError,
      message: /JSON getters reject numbers outside the float64 range/,
    },
    {
      label: 'uint64 value -0',
      json: '{"count": -0}',
      getter: 'uint64' as const,
      key: 'count',
      error: MetadataKeyError,
      message: /count: not a JSON Uint64/,
    },
  ])('json getter rejects $label', async ({ json, getter, key, error, message }) => {
    mockBoxResponse(boxValue(sampleMetadataHeader, json))

    const promise = jsonGetters[getter](reader, key)
    await expect(promise).rejects.toThrow(error)
    await expect(promise).rejects.toThrow(message)
  })

  test('base64 getter checks the decoded size, not the base64 text', async () => {
    const decoded = new Uint8Array(PAGE_SIZE).fill(7)
    mockBoxResponse(boxValue(sampleMetadataHeader, `{"data": "${Buffer.from(decoded).toString('base64')}"}`))

    await expect(jsonGetters.b64(reader, 'data')).resolves.toEqual(decoded)
  })

  test('json getters accept numbers within the float64 range', async () => {
    const values = '1.7976931348623157e308, 1e-400, 18446744073709551616, -0'
    mockBoxResponse(boxValue(sampleMetadataHeader, `{"name": "x", "v": [${values}]}`))

    await expect(jsonGetters.string(reader, 'name')).resolves.toBe('x')
  })

  test('object getter returns the raw value text', async () => {
    const raw = '{"b" : 1, "2": 2, "big": 12345678901234567890, "s": "\\u00e9"}'
    mockBoxResponse(boxValue(sampleMetadataHeader, `{"config":  ${raw}  }`))

    await expect(jsonGetters.object(reader, 'config')).resolves.toBe(raw)
  })
})
