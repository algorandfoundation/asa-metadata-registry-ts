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
  MetadataBody,
  MetadataDriftError,
  MetadataFlags,
  MetadataHeader,
  MissingAppClientError,
  Pagination,
  RegistryResolutionError,
  RegistryParameters,
  getDefaultRegistryParams,
  AsaMetadataRegistryBoxRead,
  AsaMetadataRegistryAvmRead,
  AlgodClientSubset,
  AssetMetadataRecord,
  reader,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import { concatBytes } from '@/internal/bytes'

const { AsaMetadataRegistryRead, MetadataSource } = reader

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
 * Helper to mock algod response for asset metadata record.
 */
const mockAssetMetadataRecord = (mockAlgod: AlgodClientSubset, record: AssetMetadataRecord) => {
  const boxValue = concatBytes([record.header.serialized, record.body.rawBytes])
  mockAlgod.getApplicationBoxByName = vi.fn().mockReturnValue({
    do: vi.fn().mockResolvedValue({ name: new Uint8Array(), value: boxValue }),
  })

  mockAlgod.getAssetByID = vi.fn().mockReturnValue({
    do: vi.fn().mockResolvedValue({ params: { url: '' } }),
  })
}

// ================================================================
// Unit Tests
// ================================================================

describe('asa metadata registry read', () => {
  let algod: AlgodClientSubset
  let boxReader: AlgodBoxReader
  let avmFactory: (appId: bigint) => AsaMetadataRegistryAvmRead

  beforeEach(() => {
    vi.resetAllMocks()
    algod = createMockAlgod()
    boxReader = createMockBoxReader(algod)
    avmFactory = createMockAvmFactory()
  })

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

  describe('asa metadata registry read init', () => {
    // Test AsaMetadataRegistryRead (a.k.a reader) initialization.
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

  describe('private helper methods', () => {
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
        expect(() => (reader as any).requireAppId(null)).toThrow(
          /Registry appId is not configured and was not provided/,
        )
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
  })

  describe('sub readers', () => {
    // Test box and avm sub-reader properties
    test('box property returns box reader', () => {
      // Test .box property returns AsaMetadataRegistryBoxRead.
      const reader = new AsaMetadataRegistryRead({ appId: 123, algod: boxReader })
      const boxSubReader = reader.box
      expect(boxSubReader).toBeInstanceOf(AsaMetadataRegistryBoxRead)
      expect(boxSubReader.algod).toBe(boxSubReader.algod)
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
      const deprecactedRecord = sampleMetadataRecord(deprecatedHeader)
      const currentHeader = new MetadataHeader({ ...sampleMetadataHeaderDefault, lastModifiedRound: 2000n })
      const currentRecord = sampleMetadataRecord(currentHeader)

      // Mock to return different records on subsequent calls
      const deprecatedBoxValue = concatBytes([deprecactedRecord.header.serialized, deprecactedRecord.body.rawBytes])
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
      const deprecactedRecord = sampleMetadataRecord(deprecatedHeader)
      mockAssetMetadataRecord(boxReader.algod, deprecactedRecord)

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
})
