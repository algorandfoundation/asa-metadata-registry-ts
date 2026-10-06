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
import { modelsv2 } from 'algosdk'
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
  InvalidArc90UriError,
  IrreversibleFlags,
  MbrDelta,
  MbrDeltaSign,
  MetadataBody,
  MetadataDriftError,
  MetadataExistence,
  MetadataFlags,
  MetadataHeader,
  MetadataSlice,
  MetadataSource,
  MissingAppClientError,
  PaginatedMetadata,
  Pagination,
  RegistryParameters,
  RegistryResolutionError,
  ReversibleFlags,
  type SimulateOptions,
  bitmasks,
  getDefaultRegistryParams,
} from '@algorandfoundation/asa-metadata-registry-sdk'
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
 * Like the Python `Mock(spec=AlgodClient)`: box and ASA reads fail unless a test mocks them.
 */
const createMockAlgod = () => ({
  getApplicationBoxByName: vi.fn(
    (_appId: bigint | number, _name: Uint8Array): AlgodRequest =>
      rejectedRequest(new Error('getApplicationBoxByName is not mocked')),
  ),
  getAssetByID: vi.fn(
    (_assetId: bigint | number): AlgodRequest => rejectedRequest(new Error('getAssetByID is not mocked')),
  ),
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
  // Also mock the ASA (empty URL: the URI resolves to the configured registry)
  mockAssetInfo({ url: '' })
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

  test('follows deprecation', async () => {
    // Test metadata follows deprecation chain.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

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
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })

    // Circular deprecation: 123 -> 999 -> 123 -> ...
    algod.getApplicationBoxByName.mockImplementation((appId, name) => {
      const header = metadataHeader({ deprecatedBy: BigInt(appId) === 123n ? 999 : 123, revision: 1000 })
      return resolvedRequest(boxModel(name, boxValue(header, '{"loop": true}')))
    })
    mockAssetInfo({ url: '' })

    const result = await reader.getAssetMetadata({ assetId: 456, followDeprecation: true, maxDeprecationHops: 3 })

    // Should stop after max hops and return the last result
    expect(result.appId).toBe(999n)
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

  test('missing asa raises', async () => {
    // A record of a destroyed or unknown ASA is not discovered.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: algodReader })
    algod.getAssetByID.mockImplementation(() => rejectedRequest(new Error('asset does not exist')))
    await expect(reader.resolveArc90Uri({ assetId: 999 })).rejects.toThrow(AsaNotFoundError)
  })
})
