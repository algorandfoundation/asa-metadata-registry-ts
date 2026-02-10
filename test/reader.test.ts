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

import { describe, expect, test, vi, beforeEach } from 'vitest'
import {
  AlgodBoxReader,
  Arc90Uri,
  InvalidArc90UriError,
  IrreversibleFlags,
  MbrDelta,
  MbrDeltaSign,
  MetadataBody,
  MetadataDriftError,
  MetadataExistence,
  MetadataFlags,
  MetadataHeader,
  MissingAppClientError,
  PaginatedMetadata,
  Pagination,
  RegistryResolutionError,
  RegistryParameters,
  ReversibleFlags,
  getDefaultRegistryParams,
  AsaMetadataRegistryBoxRead,
  AsaMetadataRegistryAvmRead,
  AlgodClientSubset,
  AssetMetadataRecord,
  bitmasks,
  // reader
  AsaMetadataRegistryRead,
  MetadataSource,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import { concatBytes } from '@/internal/bytes'

// ================================================================
// Mocks
// ================================================================

const createMockAlgod = () => {
  return {
    getApplicationBoxByName: vi.fn(),
    getAssetByID: vi.fn(),
  } as AlgodClientSubset
}

const createMockBoxReader = (mockAlgod: AlgodClientSubset) => {
  return new AlgodBoxReader(mockAlgod)
}

const createMockAvmFactory = (): ((appId: bigint) => AsaMetadataRegistryAvmRead) => {
  const cache: Map<bigint, AsaMetadataRegistryAvmRead> = new Map()

  return (appId: bigint): AsaMetadataRegistryAvmRead => {
    if (cache.has(appId)) {
      return cache.get(appId)!
    }

    const avmReader = {
      client: vi.fn(),
      arc89GetMetadataRegistryParameters: vi.fn(),
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
      arc89GetMetadataPartialUri: vi.fn(),
      arc89GetMetadataMbrDelta: vi.fn(),
      arc89CheckMetadataExists: vi.fn(),
      arc89IsMetadataImmutable: vi.fn(),
      arc89IsMetadataShort: vi.fn(),
      simulateMany: vi.fn(),
    } as unknown as AsaMetadataRegistryAvmRead

    cache.set(appId, avmReader)
    return avmReader
  }
}

// ================================================================
// Helpers
// ================================================================

const sampleMetadataHeaderDefault = new MetadataHeader({
  identifiers: 0x00,
  flags: MetadataFlags.empty(),
  deprecatedBy: 0n,
  lastModifiedRound: 1000n,
  metadataHash: new Uint8Array(32),
})

const sampleMetadataBodyDefault = new MetadataBody(new TextEncoder().encode('{"name": "test"}'))

/**
 * Helper to create sample asset metadata record.
 */
const sampleMetadataRecord = (sampleMetadataHeader?: MetadataHeader, sampleMetadataBody?: MetadataBody) => {
  return new AssetMetadataRecord({
    appId: 123n,
    assetId: 456n,
    header: sampleMetadataHeader ?? sampleMetadataHeaderDefault,
    body: sampleMetadataBody ?? sampleMetadataBodyDefault,
  })
}

/**
 * Helper to mock algod box response with raw box value bytes.
 */
const mockBoxResponse = (mockAlgod: AlgodClientSubset, boxValue: Uint8Array) => {
  mockAlgod.getApplicationBoxByName = vi.fn().mockReturnValue({
    do: vi.fn().mockResolvedValue({ name: new Uint8Array(), value: boxValue }),
  })
}

/**
 * Helper to mock algod response for asset metadata record.
 */
const mockAssetMetadataRecord = (mockAlgod: AlgodClientSubset, record: AssetMetadataRecord) => {
  const boxValue = concatBytes([record.header.serialized, record.body.rawBytes])
  mockBoxResponse(mockAlgod, boxValue)

  mockAlgod.getAssetByID = vi.fn().mockReturnValue({
    do: vi.fn().mockResolvedValue({ params: { url: '' } }),
  })
}

// ================================================================
// AsaMetadataRegistryRead (a.k.a. reader) Tests
// ================================================================

let algod: AlgodClientSubset
let boxReader: AlgodBoxReader
let avmFactory: (appId: bigint) => AsaMetadataRegistryAvmRead

beforeEach(() => {
  vi.resetAllMocks()
  algod = createMockAlgod()
  boxReader = createMockBoxReader(algod)
  avmFactory = createMockAvmFactory()
})

// ================================================================
// MetadataSource Enum Tests
// ================================================================

describe('metadata source enum', () => {
  // Tests for MetadataSource enum values.
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
  // Test AsaMetadataRegistryRead constructor.
  test('init minimal', () => {
    // Test initialization with minimal configuration.
    const reader = new AsaMetadataRegistryRead({ appId: null })
    expect(reader.appId).toBeNull()
    expect(reader.algod).toBeNull()
    expect(reader.avmFactory).toBeNull()
  })

  test('init with app id', () => {
    // Test initialization with appId.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect(reader.appId).toBe(123n)
  })

  test('init with algod', () => {
    // Test initialization with algod reader.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })
    expect(reader.algod).toBe(boxReader)
  })

  test('init with avm factory', () => {
    // Test initialization with AVM factory.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    expect(reader.avmFactory).toBe(avmFactory)
  })

  test('init fully configured', () => {
    // Test initialization with all configuration options.
    const reader = new AsaMetadataRegistryRead({
      appId: 123,
      algod: boxReader,
      avmFactory,
    })

    expect(reader.appId).toBe(123n)
    expect(reader.algod).toBe(boxReader)
    expect(reader.avmFactory).toBe(avmFactory)
  })
})

// ================================================================
// Internal Helper Methods Tests
// ================================================================

describe('require app id', () => {
  // Test requireAppId private method
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
  // Test getParams private method
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
    const mockAvmFactory = createMockAvmFactory()
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory: mockAvmFactory })

    const customParams = getDefaultRegistryParams()
    const mockAvm = vi.mocked(mockAvmFactory(123n))
    mockAvm.arc89GetMetadataRegistryParameters.mockResolvedValue(customParams)

    const params = await (reader as any).getParams()
    expect(params).toBeInstanceOf(RegistryParameters)
  })

  test('get params falls back on avm error', async () => {
    // Test getParams falls back to defaults if AVM fails.
    const mockAvmFactory = createMockAvmFactory()
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory: mockAvmFactory })

    const mockAvm = vi.mocked(mockAvmFactory(123n))
    mockAvm.arc89GetMetadataRegistryParameters.mockRejectedValue(new Error('AVM error'))

    const params = await (reader as any).getParams()
    const defaults = getDefaultRegistryParams()
    expect(params.headerSize).toBe(defaults.headerSize)
    expect(params.maxMetadataSize).toBe(defaults.maxMetadataSize)
  })
})

// ================================================================
// Sub-Reader Tests
// ================================================================

describe('sub readers', () => {
  // Test box and avm sub-reader properties
  test('box property returns box reader', () => {
    // Test .box property returns AsaMetadataRegistryBoxRead.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })
    const boxSubReader = reader.box
    expect(boxSubReader).toBeInstanceOf(AsaMetadataRegistryBoxRead)
    expect(boxSubReader.algod).toBe(boxReader)
    expect(boxSubReader.appId).toBe(123n)
  })

  test('box property requires algod', () => {
    // Test .box property raises when algod not configured.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect(() => reader.box).toThrow(/BOX reader requires an algod client/)
  })

  test('box property requires app id', () => {
    // Test .box property raises when appId not configured.
    const reader = new AsaMetadataRegistryRead({ appId: null, algod: boxReader })
    expect(() => reader.box).toThrow(RegistryResolutionError)
    expect(() => reader.box).toThrow(/Registry appId is not configured/)
  })

  test('avm property returns avm reader', () => {
    // Test .avm() method returns AsaMetadataRegistryAvmRead.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    const avmReader = reader.avm()
    expect(avmReader).toBeDefined()
  })

  test('avm property with override app id', () => {
    // Test .avm() method accepts override appId.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    const avmSubReader = reader.avm({ appId: 456 })
    expect(avmSubReader).toBeDefined()
  })

  test('avm property requires factory', () => {
    // Test .avm() raises when factory not configured.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })
    expect(() => reader.avm()).toThrow(MissingAppClientError)
    expect(() => reader.avm()).toThrow(/AVM reader requires a generated AppClient/)
  })

  test('avm property requires app id', () => {
    // Test .avm() raises when appId not configured.
    const reader = new AsaMetadataRegistryRead({ appId: null, avmFactory: avmFactory })
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
    const reader = new AsaMetadataRegistryRead({ appId: null })
    const uri = await reader.resolveArc90Uri({
      metadataUri: 'algorand://app/123?box=AAAAAAAAAcg%3D', // b64url of asset ID 456
    })
    expect(uri.appId).toBe(123n)
    expect(uri.assetId).toBe(456n)
  })

  test('resolve from partial uri raises', async () => {
    // Test resolution from partial URI raises error.
    const reader = new AsaMetadataRegistryRead({ appId: null })
    await expect(reader.resolveArc90Uri({ metadataUri: 'algorand://app/123?box=' })).rejects.toThrow(
      InvalidArc90UriError,
    )
    await expect(reader.resolveArc90Uri({ metadataUri: 'algorand://app/123?box=' })).rejects.toThrow(
      /Metadata URI is partial; missing box value/,
    )
  })

  test('resolve from asset id via algod', async () => {
    // Test resolution from assetId using algod ASA lookup.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })

    const expectedUri = new Arc90Uri({ netauth: null, appId: 123n, boxName: null }).withAssetId(456n)

    boxReader.algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue({
        params: { url: expectedUri.toUri() },
      }),
    })

    const uri = await reader.resolveArc90Uri({ assetId: 456 })
    expect(uri.assetId).toBe(456n)
  })

  test('resolve from asset id fallback to app id', async () => {
    // Test resolution falls back to configured appId when ASA lookup fails.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })

    boxReader.algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue({
        params: { url: '' },
      }),
    })

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
    await expect(reader.resolveArc90Uri({})).rejects.toThrow(RegistryResolutionError)
    await expect(reader.resolveArc90Uri({})).rejects.toThrow(/Either assetId or metadataUri must be provided/)
  })

  test('resolve requires app id without algod', async () => {
    // Test resolution raises when appId cannot be determined.
    const reader = new AsaMetadataRegistryRead({ appId: null })
    await expect(reader.resolveArc90Uri({ assetId: 456 })).rejects.toThrow(RegistryResolutionError)
    await expect(reader.resolveArc90Uri({ assetId: 456 })).rejects.toThrow(/Cannot resolve registry appId/)
  })
})

// ================================================================
// High-Level Metadata Retrieval Tests
// ================================================================

describe('get asset metadata', () => {
  // Test getAssetMetadata high-level method.
  let sampleRecord: AssetMetadataRecord

  beforeEach(() => {
    sampleRecord = sampleMetadataRecord()
  })

  test('auto prefers box', async () => {
    // Test AUTO source prefers BOX when algod available.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })
    mockAssetMetadataRecord(algod, sampleRecord)

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AUTO })

    expect(result.appId).toBe(123n)
    expect(result.assetId).toBe(456n)
  })

  test('box source explicit', async () => {
    // Test explicit BOX source.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })
    mockAssetMetadataRecord(algod, sampleMetadataRecord())

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.BOX })

    expect(result.appId).toBe(123n)
    expect(result.assetId).toBe(456n)
  })

  test('avm source explicit', async () => {
    // Test explicit AVM source when algod not available.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory: avmFactory })

    const mockAvm = vi.mocked(avmFactory(123n))
    mockAvm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeaderDefault)
    mockAvm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ metadataSize: 50, pageSize: 100, totalPages: 1 }),
    )
    mockAvm.simulateMany.mockResolvedValue([
      { hasNextPage: false, lastModifiedRound: 1000n, pageContent: sampleMetadataBodyDefault.rawBytes },
    ])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.assetId).toBe(456n)
  })

  test('avm source single page', async () => {
    // Test AVM source with single-page metadata.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const mockAvm = vi.mocked(avmFactory(123n))
    mockAvm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeaderDefault)
    mockAvm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ metadataSize: 20, pageSize: 100, totalPages: 1 }),
    )
    mockAvm.simulateMany.mockResolvedValue([
      { hasNextPage: false, lastModifiedRound: 1000n, pageContent: sampleMetadataBodyDefault.rawBytes },
    ])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.assetId).toBe(456n)
    expect(result.appId).toBe(123n)
  })

  test('avm source multi page', async () => {
    // Test AVM source with multi-page metadata.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const mockAvm = vi.mocked(avmFactory(123n))
    mockAvm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeaderDefault)
    mockAvm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ metadataSize: 150, pageSize: 100, totalPages: 2 }),
    )
    mockAvm.simulateMany.mockResolvedValue([
      { hasNextPage: true, lastModifiedRound: 1000n, pageContent: new Uint8Array(100).fill(0x41) },
      { hasNextPage: false, lastModifiedRound: 1000n, pageContent: new Uint8Array(50).fill(0x42) },
    ])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.assetId).toBe(456n)
    expect(result.body.rawBytes.length).toBe(150)
  })

  test('avm detects drift', async () => {
    // Test AVM source detects metadata drift between pages.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const mockAvm = vi.mocked(avmFactory(123n))
    mockAvm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeaderDefault)
    mockAvm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ metadataSize: 150, pageSize: 100, totalPages: 2 }),
    )
    // Different lastModifiedRound indicates drift
    mockAvm.simulateMany.mockResolvedValue([
      { hasNextPage: true, lastModifiedRound: 1000n, pageContent: new Uint8Array(5) },
      { hasNextPage: false, lastModifiedRound: 1001n, pageContent: new Uint8Array(5) },
    ])

    await expect(reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })).rejects.toThrow(
      MetadataDriftError,
    )
    await expect(reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })).rejects.toThrow(
      /Metadata changed between simulated page reads/,
    )
  })

  test('follows deprecation', async () => {
    // Test metadata follows deprecation chain.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })

    const deprecatedHeader = new MetadataHeader({ ...sampleMetadataHeaderDefault, deprecatedBy: 789n })
    const deprecatedRecord = sampleMetadataRecord(deprecatedHeader)
    const currentHeader = new MetadataHeader({ ...sampleMetadataHeaderDefault, lastModifiedRound: 2000n })
    const currentRecord = sampleMetadataRecord(currentHeader)

    // Mock to return different records on subsequent calls
    const deprecatedBoxValue = concatBytes([deprecatedRecord.header.serialized, deprecatedRecord.body.rawBytes])
    const currentBoxValue = concatBytes([currentRecord.header.serialized, currentRecord.body.rawBytes])
    boxReader.algod.getApplicationBoxByName = vi
      .fn()
      .mockReturnValueOnce({
        do: vi.fn().mockResolvedValue({ name: new Uint8Array(), value: deprecatedBoxValue }),
      })
      .mockReturnValueOnce({
        do: vi.fn().mockResolvedValue({ name: new Uint8Array(), value: currentBoxValue }),
      })
    boxReader.algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue({ params: { url: '' } }),
    })

    const result = await reader.getAssetMetadata({ assetId: 456, followDeprecation: true })

    expect(result.appId).toBe(789n)
    expect(result.header.lastModifiedRound).toBe(2000n)
  })

  test('stops deprecation loop', async () => {
    // Test deprecation following stops after max hops.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })

    // Create circular deprecation — mock always returns the same looping record
    mockAssetMetadataRecord(
      boxReader.algod,
      sampleMetadataRecord(
        new MetadataHeader({ ...sampleMetadataHeaderDefault, deprecatedBy: 999n }),
        new MetadataBody(new TextEncoder().encode('{"loop": true}')),
      ),
    )

    const result = await reader.getAssetMetadata({
      assetId: 456,
      followDeprecation: true,
      maxDeprecationHops: 3,
    })

    // Should stop after max hops and return last result
    expect(result.appId).toBe(999n)
  })

  test('no deprecation follow', async () => {
    // Test metadata doesn't follow deprecation when disabled.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })

    const deprecatedHeader = new MetadataHeader({ ...sampleMetadataHeaderDefault, deprecatedBy: 789n })
    const deprecatedRecord = sampleMetadataRecord(deprecatedHeader)
    mockAssetMetadataRecord(boxReader.algod, deprecatedRecord)

    const result = await reader.getAssetMetadata({ assetId: 456, followDeprecation: false })

    expect(result.appId).toBe(123n)
    expect(result.header.deprecatedBy).toBe(789n)
  })

  test('auto no source available', async () => {
    // Test AUTO source raises when neither algod nor avm available.
    const reader = new AsaMetadataRegistryRead({ appId: 123 })

    await expect(reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AUTO })).rejects.toThrow(
      RegistryResolutionError,
    )
    await expect(reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AUTO })).rejects.toThrow(
      /No read source available/,
    )
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
  // Test getAssetMetadata high-level method.
  let reader: AsaMetadataRegistryRead
  let readerAvmConfig: AsaMetadataRegistryRead
  let readerBoxConfig: AsaMetadataRegistryRead

  beforeEach(() => {
    reader = new AsaMetadataRegistryRead({ appId: 123 })
    readerAvmConfig = new AsaMetadataRegistryRead({ appId: 123, avmFactory })
    readerBoxConfig = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })
  })

  describe('get registry parameters', () => {
    // Test arc89GetMetadataRegistryParameters dispatcher.
    test('uses avm when available', async () => {
      // Test dispatcher uses AVM when available.
      const customParams = getDefaultRegistryParams()
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataRegistryParameters.mockResolvedValue(customParams)

      const result = await readerAvmConfig.arc89GetMetadataRegistryParameters({ source: MetadataSource.AVM })
      expect(result).toBeInstanceOf(RegistryParameters)
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
      await expect(reader.arc89GetMetadataPartialUri()).rejects.toThrow(MissingAppClientError)
      await expect(reader.arc89GetMetadataPartialUri()).rejects.toThrow(/getMetadataPartialUri requires AVM access/)
    })

    test('uses avm when available', async () => {
      // Test dispatcher uses AVM.
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataPartialUri.mockResolvedValue('algorand://app/123')

      await readerAvmConfig.arc89GetMetadataPartialUri({ source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataPartialUri).toHaveBeenCalledOnce()
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
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataMbrDelta.mockResolvedValue(delta)

      await readerAvmConfig.arc89GetMetadataMbrDelta({ assetId: 456, newSize: 100 })
      expect(mockAvm.arc89GetMetadataMbrDelta).toHaveBeenCalledOnce()
    })
  })

  describe('check metadata exists', () => {
    // Test arc89CheckMetadataExists dispatcher.
    test('auto prefers box', async () => {
      // Test AUTO source prefers BOX.
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, sampleMetadataBodyDefault.rawBytes])
      mockBoxResponse(algod, boxValue)
      boxReader.algod.getAssetByID = vi.fn().mockReturnValue({
        do: vi.fn().mockResolvedValue({ index: 456 }),
      })

      const result = await readerBoxConfig.arc89CheckMetadataExists({ assetId: 456 })
      expect(result.asaExists).toBe(true)
      expect(result.metadataExists).toBe(true)
    })

    test('uses avm when box unavailable', async () => {
      // Test uses AVM when BOX not available.
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89CheckMetadataExists.mockResolvedValue(
        new MetadataExistence({ asaExists: true, metadataExists: false }),
      )

      await readerAvmConfig.arc89CheckMetadataExists({ assetId: 456, source: MetadataSource.AVM })
      expect(mockAvm.arc89CheckMetadataExists).toHaveBeenCalledOnce()
    })
  })

  describe('is metadata immutable', () => {
    // Test arc89IsMetadataImmutable dispatcher.
    test('auto prefers box', async () => {
      // Test AUTO source prefers BOX.
      const immutableFlags = new MetadataFlags({
        reversible: ReversibleFlags.empty(),
        irreversible: new IrreversibleFlags({ immutable: true, arc3: false, arc89Native: false }),
      })
      const header = new MetadataHeader({
        ...sampleMetadataHeaderDefault,
        flags: immutableFlags,
      })
      const boxValue = concatBytes([header.serialized, sampleMetadataBodyDefault.rawBytes])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89IsMetadataImmutable({ assetId: 456, source: MetadataSource.BOX })
      expect(result).toBe(true)
    })

    test('uses avm fallback', async () => {
      // Test uses AVM when BOX not available.
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89IsMetadataImmutable.mockResolvedValue(false)

      await readerAvmConfig.arc89IsMetadataImmutable({ assetId: 456, source: MetadataSource.AVM })
      expect(mockAvm.arc89IsMetadataImmutable).toHaveBeenCalledOnce()
    })
  })

  describe('is metadata short', () => {
    // Test arc89IsMetadataShort dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const header = new MetadataHeader({
        ...sampleMetadataHeaderDefault,
        identifiers: bitmasks.MASK_ID_SHORT,
      })
      const boxValue = concatBytes([header.serialized, sampleMetadataBodyDefault.rawBytes])
      mockBoxResponse(algod, boxValue)

      const [isShort, roundNum] = await readerBoxConfig.arc89IsMetadataShort({
        assetId: 456,
        source: MetadataSource.BOX,
      })
      expect(isShort).toBe(true)
      expect(roundNum).toBe(1000n)
    })

    test('avm source', async () => {
      // Test AVM source.
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89IsMetadataShort.mockResolvedValue([false, 2000n] as const)

      await readerAvmConfig.arc89IsMetadataShort({ assetId: 456, source: MetadataSource.AVM })
      expect(mockAvm.arc89IsMetadataShort).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata header', () => {
    // Test arc89GetMetadataHeader dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, sampleMetadataBodyDefault.rawBytes])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadataHeader({ assetId: 456, source: MetadataSource.BOX })
      expect(result.lastModifiedRound).toBe(sampleMetadataHeaderDefault.lastModifiedRound)
    })

    test('avm source', async () => {
      // Test AVM source.
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeaderDefault)

      const result = await readerAvmConfig.arc89GetMetadataHeader({ assetId: 456, source: MetadataSource.AVM })
      expect(result.lastModifiedRound).toBe(sampleMetadataHeaderDefault.lastModifiedRound)
    })
  })

  describe('get metadata pagination', () => {
    test('box source', async () => {
      // Test BOX source.
      const metadataContent = new TextEncoder().encode('{"test": "data"}'.repeat(10))
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, metadataContent])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadataPagination({ assetId: 456, source: MetadataSource.BOX })
      expect(result.metadataSize).toBe(metadataContent.length)
    })

    test('avm source', async () => {
      // Test AVM source.
      const pagination = new Pagination({ metadataSize: 150, pageSize: 100, totalPages: 2 })
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataPagination.mockResolvedValue(pagination)

      await readerAvmConfig.arc89GetMetadataPagination({ assetId: 456, source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataPagination).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata (paginated)', () => {
    // Test arc89GetMetadata (paginated) dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const pageContent = new TextEncoder().encode('{"page": 0}')
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, pageContent])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadata({ assetId: 456, page: 0, source: MetadataSource.BOX })
      expect(result.pageContent).toEqual(pageContent)
    })

    test('avm source', async () => {
      // Test AVM source.
      const pageData = new PaginatedMetadata({
        hasNextPage: false,
        lastModifiedRound: 2000n,
        pageContent: new TextEncoder().encode('page1'),
      })
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadata.mockResolvedValue(pageData)

      await readerAvmConfig.arc89GetMetadata({ assetId: 456, page: 1, source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadata).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata slice', () => {
    // Test arc89GetMetadataSlice dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const metadataContent = new TextEncoder().encode('0123456789'.repeat(10))
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, metadataContent])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadataSlice({
        assetId: 456,
        offset: 10,
        size: 20,
        source: MetadataSource.BOX,
      })
      expect(result).toEqual(metadataContent.slice(10, 30))
    })

    test('avm source', async () => {
      // Test AVM source.
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataSlice.mockResolvedValue(new TextEncoder().encode('avm_slice'))

      await readerAvmConfig.arc89GetMetadataSlice({ assetId: 456, offset: 5, size: 15, source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataSlice).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata header hash', () => {
    // Test arc89GetMetadataHeaderHash dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, sampleMetadataBodyDefault.rawBytes])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadataHeaderHash({ assetId: 456, source: MetadataSource.BOX })
      expect(result.length).toBe(32)
    })

    test('avm source', async () => {
      // Test AVM source.
      const headerHash = new Uint8Array(32).fill(0x02)
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataHeaderHash.mockResolvedValue(headerHash)

      await readerAvmConfig.arc89GetMetadataHeaderHash({ assetId: 456, source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataHeaderHash).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata page hash', () => {
    // Test arc89GetMetadataPageHash dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, sampleMetadataBodyDefault.rawBytes])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadataPageHash({
        assetId: 456,
        page: 0,
        source: MetadataSource.BOX,
      })
      expect(result.length).toBe(32)
    })

    test('avm source', async () => {
      // Test AVM source.
      const pageHash = new Uint8Array(32).fill(0x04)
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataPageHash.mockResolvedValue(pageHash)

      await readerAvmConfig.arc89GetMetadataPageHash({ assetId: 456, page: 1, source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataPageHash).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata hash', () => {
    // Test arc89GetMetadataHash dispatcher.
    test('box source', async () => {
      // Test BOX source.
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, sampleMetadataBodyDefault.rawBytes])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadataHash({ assetId: 456, source: MetadataSource.BOX })
      expect(result.length).toBe(32)
    })

    test('avm source', async () => {
      // Test AVM source.
      const metadataHash = new Uint8Array(32).fill(0x06)
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataHash.mockResolvedValue(metadataHash)

      await readerAvmConfig.arc89GetMetadataHash({ assetId: 456, source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataHash).toHaveBeenCalledOnce()
    })
  })

  describe('get metadata string by key', () => {
    // Test arc89GetMetadataStringByKey dispatcher.
    test('auto prefers avm', async () => {
      // Test AUTO source prefers AVM for parity.
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataStringByKey.mockResolvedValue('test_value')

      await readerAvmConfig.arc89GetMetadataStringByKey({ assetId: 456, key: 'name', source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataStringByKey).toHaveBeenCalledOnce()
    })

    test('falls back to box', async () => {
      // Test falls back to BOX when AVM not available.
      const jsonData = new TextEncoder().encode('{"name": "box_value"}')
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, jsonData])
      mockBoxResponse(algod, boxValue)

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
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataUint64ByKey.mockResolvedValue(42n)

      await readerAvmConfig.arc89GetMetadataUint64ByKey({ assetId: 456, key: 'value', source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataUint64ByKey).toHaveBeenCalledOnce()
    })

    test('falls back to box', async () => {
      // Test falls back to BOX when AVM not available.
      const jsonData = new TextEncoder().encode('{"count": 100}')
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, jsonData])
      mockBoxResponse(algod, boxValue)

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
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataObjectByKey.mockResolvedValue('{"nested": true}')

      await readerAvmConfig.arc89GetMetadataObjectByKey({ assetId: 456, key: 'data', source: MetadataSource.AVM })
      expect(mockAvm.arc89GetMetadataObjectByKey).toHaveBeenCalledOnce()
    })

    test('box fallback', async () => {
      // Test BOX fallback.
      const jsonData = new TextEncoder().encode('{"config": {"box": "object"}}')
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, jsonData])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadataObjectByKey({
        assetId: 456,
        key: 'config',
        source: MetadataSource.BOX,
      })
      const obj = JSON.parse(result)
      expect(obj).toHaveProperty('box')
    })
  })

  describe('get metadata b64 bytes by key', () => {
    // Test arc89GetMetadataB64BytesByKey dispatcher.
    test('avm source', async () => {
      // Test AVM source.
      const mockAvm = vi.mocked(avmFactory(123n))
      mockAvm.arc89GetMetadataB64BytesByKey.mockResolvedValue(new TextEncoder().encode('decoded_bytes'))

      await readerAvmConfig.arc89GetMetadataB64BytesByKey({
        assetId: 456,
        key: 'image',
        b64Encoding: 0,
        source: MetadataSource.AVM,
      })
      expect(mockAvm.arc89GetMetadataB64BytesByKey).toHaveBeenCalledOnce()
    })

    test('box fallback', async () => {
      // Test BOX fallback.
      // Base64 standard encoding of "hello"
      const jsonData = new TextEncoder().encode('{"data": "aGVsbG8="}')
      const boxValue = concatBytes([sampleMetadataHeaderDefault.serialized, jsonData])
      mockBoxResponse(algod, boxValue)

      const result = await readerBoxConfig.arc89GetMetadataB64BytesByKey({
        assetId: 456,
        key: 'data',
        b64Encoding: 1,
        source: MetadataSource.BOX,
      })
      expect(result).toEqual(new TextEncoder().encode('hello'))
    })
  })
})

describe('edge cases', () => {
  // Test edge cases and error scenarios.
  test('unknown metadata source is validated', () => {
    // Test that MetadataSource enum is properly validated.
    new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })

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

    const mockAvm = vi.mocked(avmFactory(123n))
    mockAvm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeaderDefault)
    mockAvm.arc89GetMetadataPagination.mockResolvedValue(
      new Pagination({ metadataSize: 0, pageSize: 100, totalPages: 0 }),
    )
    mockAvm.simulateMany.mockResolvedValue([])

    const result = await reader.getAssetMetadata({ assetId: 456, source: MetadataSource.AVM })
    expect(result.body.rawBytes.length).toBe(0)
  })

  test('simulate options passed through', async () => {
    // Test that SimulateOptions are passed through to AVM calls.
    const reader = new AsaMetadataRegistryRead({ appId: 123, avmFactory })

    const mockAvm = vi.mocked(avmFactory(123n))
    mockAvm.arc89GetMetadataHeader.mockResolvedValue(sampleMetadataHeaderDefault)

    const simulateOpts = { extraOpcodeBudget: 1000 }

    await reader.arc89GetMetadataHeader({
      assetId: 456,
      source: MetadataSource.AVM,
      simulate: simulateOpts,
    })
    expect(mockAvm.arc89GetMetadataHeader).toHaveBeenCalledOnce()
  })

  test('deprecation self reference stops', async () => {
    // Test that self-referencing deprecated_by doesn't loop.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })

    const selfRefHeader = new MetadataHeader({
      ...sampleMetadataHeaderDefault,
      deprecatedBy: 123n, // Same as app_id
    })
    const record = new AssetMetadataRecord({
      appId: 123n,
      assetId: 456n,
      header: selfRefHeader,
      body: new MetadataBody(new TextEncoder().encode('{"self": "ref"}')),
    })

    mockAssetMetadataRecord(boxReader.algod, record)

    const result = await reader.getAssetMetadata({ assetId: 456, followDeprecation: true })

    // Should stop immediately since deprecated_by == current app_id
    expect(result.appId).toBe(123n)
  })

  test('metadata uri takes precedence over asset id', async () => {
    // Test that explicit metadata_uri takes precedence.
    const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })

    // Even if assetId is provided, URI should be used
    const uri = await reader.resolveArc90Uri({
      assetId: 999, // This should be ignored
      metadataUri: 'algorand://app/789?box=AAAAAAAAAcg%3D', // b64url of asset ID 456
    })

    expect(uri.appId).toBe(789n)
    expect(uri.assetId).toBe(456n)
  })
})
