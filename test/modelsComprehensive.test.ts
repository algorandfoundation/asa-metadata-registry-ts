/**
 * Comprehensive tests for uncovered functionality in src/models.
 *
 * This test file focuses on edge cases and paths that weren't covered by existing tests:
 * - MetadataHeader.serialized property
 * - MetadataHeader.expectedIdentifiers
 * - MetadataHeader.fromTuple error cases
 * - MetadataBody.getPage error cases
 * - MetadataBody.json property
 * - AssetMetadataRecord hash validation methods
 * - AssetMetadata convenience properties
 * - AssetMetadata hash computation with asaAm
 * - AssetMetadata.fromBytes
 * - AssetMetadata.computeHeaderHash
 * - AssetMetadata.computePageHash
 */

import { describe, expect, test } from 'vitest'
import {
  models,
  bitmasks,
  constants,
  computeMetadataHash,
  MetadataArc3Error,
} from '@algorandfoundation/asa-metadata-registry-sdk'

const {
  MetadataHeader,
  MetadataBody,
  MetadataFlags,
  ReversibleFlags,
  IrreversibleFlags,
  AssetMetadataRecord,
  AssetMetadata,
  getDefaultRegistryParams,
} = models

describe('metadata header advanced', () => {
  // Advanced tests for MetadataHeader.
  test('serialized property', () => {
    // Test serialized property produces correct bytes.
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc20: true }),
      irreversible: new IrreversibleFlags({ arc3: true, immutable: true }),
    })
    const header = new MetadataHeader({
      identifiers: bitmasks.MASK_ID_SHORT,
      flags,
      metadataHash: new Uint8Array(32).fill(0xaa),
      lastModifiedRound: 12345n,
      deprecatedBy: 67890n,
    })
    const serialized = header.serialized

    expect(serialized.length).toBe(constants.HEADER_SIZE)
    expect(serialized[0]).toBe(bitmasks.MASK_ID_SHORT)
    expect(serialized[1]).toBe(flags.reversibleByte)
    expect(serialized[2]).toBe(flags.irreversibleByte)
    expect(serialized.slice(3, 35)).toEqual(new Uint8Array(32).fill(0xaa))
    // Check uint64 encoding
    const lmrView = new DataView(serialized.buffer, serialized.byteOffset + 35, 8)
    expect(lmrView.getBigUint64(0, false)).toBe(12345n)
    const dbView = new DataView(serialized.buffer, serialized.byteOffset + 43, 8)
    expect(dbView.getBigUint64(0, false)).toBe(67890n)
  })

  test('expected identifiers short body', () => {
    // Test expectedIdentifiers with short body.
    const header = new MetadataHeader({
      identifiers: 0, // Not set initially
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 0n,
      deprecatedBy: 0n,
    })
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const expected = header.expectedIdentifiers({ body })
    expect(expected & bitmasks.MASK_ID_SHORT).toBe(bitmasks.MASK_ID_SHORT)
  })

  test('expected identifiers long body', () => {
    // Test expectedIdentifiers with long body.
    const header = new MetadataHeader({
      identifiers: bitmasks.MASK_ID_SHORT, // Set initially
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 0n,
      deprecatedBy: 0n,
    })
    // Create body larger than SHORT_METADATA_SIZE
    const body = new MetadataBody(new Uint8Array(constants.SHORT_METADATA_SIZE + 1).fill(120))
    const expected = header.expectedIdentifiers({ body })
    expect(expected & bitmasks.MASK_ID_SHORT).toBe(0)
  })

  test('expected identifiers preserves reserved bits', () => {
    // Test expectedIdentifiers preserves reserved bits.
    // Set some reserved bits
    const header = new MetadataHeader({
      identifiers: 0b11110000, // Reserved bits set
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 0n,
      deprecatedBy: 0n,
    })
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const expected = header.expectedIdentifiers({ body })
    // Should preserve reserved bits and set short bit
    expect(expected & 0b11110000).toBe(0b11110000)
    expect(expected & bitmasks.MASK_ID_SHORT).toBe(bitmasks.MASK_ID_SHORT)
  })

  test('from tuple invalid identifiers type', () => {
    // Test fromTuple with non-int identifiers.
    expect(() => MetadataHeader.fromTuple(['not int' as any, 0, 0, new Uint8Array(32), 0, 0])).toThrow(
      /identifiers.*must be.*int/,
    )
  })

  test('from tuple identifiers out of range', () => {
    // Test fromTuple with identifiers out of uint8 range.
    expect(() => MetadataHeader.fromTuple([256, 0, 0, new Uint8Array(32), 0, 0])).toThrow(
      /identifiers.*must fit.*uint8/,
    )
  })

  test('from tuple invalid reversible flags type', () => {
    // Test fromTuple with non-int reversible flags.
    expect(() => MetadataHeader.fromTuple([0, 'not int' as any, 0, new Uint8Array(32), 0, 0])).toThrow(
      /reversibleFlags.*must be.*number/,
    )
  })

  test('from tuple invalid irreversible flags type', () => {
    // Test fromTuple with non-int irreversible flags.
    expect(() => MetadataHeader.fromTuple([0, 0, 'not int' as any, new Uint8Array(32), 0, 0])).toThrow(
      /irreversibleFlags.*must be.*number/,
    )
  })

  test('from tuple invalid hash length', () => {
    // Test fromTuple with wrong hash length.
    expect(() => MetadataHeader.fromTuple([0, 0, 0, new Uint8Array(31), 0, 0])).toThrow(/metadataHash must be 32 bytes/)
  })

  test('from tuple hash as list', () => {
    // Test fromTuple with hash as list of ints.
    const hashList = Array(32).fill(0)
    const header = MetadataHeader.fromTuple([0, 0, 0, hashList, 100, 200])
    expect(header.metadataHash).toEqual(new Uint8Array(32))
  })

  test('from tuple invalid last modified round type', () => {
    // Test fromTuple with non-int lastModifiedRound.
    expect(() => MetadataHeader.fromTuple([0, 0, 0, new Uint8Array(32), 'not int' as any, 0])).toThrow(
      /lastModifiedRound.*must be.*integer/,
    )
  })

  test('from tuple invalid deprecated by type', () => {
    // Test fromTuple with non-int deprecatedBy.
    expect(() => MetadataHeader.fromTuple([0, 0, 0, new Uint8Array(32), 0, 'not int' as any])).toThrow(
      /deprecatedBy.*must be.*integer/,
    )
  })

  test('is deprecated property', () => {
    // Test isDeprecated property.
    const headerNotDeprecated = new MetadataHeader({
      identifiers: 0,
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 0n,
      deprecatedBy: 0n,
    })
    expect(headerNotDeprecated.isDeprecated).toBe(false)

    const headerDeprecated = new MetadataHeader({
      identifiers: 0,
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 0n,
      deprecatedBy: 5000n,
    })
    expect(headerDeprecated.isDeprecated).toBe(true)
  })
})

describe('metadata body advanced', () => {
  // Advanced tests for MetadataBody.
  test('json property', () => {
    // Test json property decodes correctly.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test","value":123}'))
    expect(body.json).toEqual({ name: 'Test', value: 123 })
  })

  test('json property empty', () => {
    // Test json property with empty body.
    const body = MetadataBody.empty()
    expect(body.json).toEqual({})
  })

  test('get page negative index raises', () => {
    // Test getPage with negative index.
    const body = new MetadataBody(new Uint8Array(1000).fill(120))
    expect(() => body.getPage(-1)).toThrow(/pageIndex must be non-negative/)
  })

  test('get page index out of range raises', () => {
    // Test getPage with index beyond total pages.
    const body = new MetadataBody(new Uint8Array(1000).fill(120))
    expect(() => body.getPage(100)).toThrow(/out of range/)
  })

  test('get page first page', () => {
    // Test getPage for first page.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.pageSize * 2).fill(120)
    const body = new MetadataBody(data)
    const page = body.getPage(0, params)
    expect(page.length).toBe(params.pageSize)
    expect(page).toEqual(new Uint8Array(params.pageSize).fill(120))
  })

  test('get page middle page', () => {
    // Test getPage for middle page.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.pageSize * 3).fill(120)
    const body = new MetadataBody(data)
    const page = body.getPage(1, params)
    expect(page.length).toBe(params.pageSize)
    expect(page).toEqual(new Uint8Array(params.pageSize).fill(120))
  })

  test('get page last page full', () => {
    // Test getPage for last page when it's full.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.pageSize * 2).fill(120)
    const body = new MetadataBody(data)
    const page = body.getPage(1, params)
    expect(page.length).toBe(params.pageSize)
  })

  test('get page last page partial', () => {
    // Test getPage for partial last page.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.pageSize + 100).fill(120)
    const body = new MetadataBody(data)
    const page = body.getPage(1, params)
    expect(page.length).toBe(100)
  })
})

describe('asset metadata record advanced', () => {
  // Advanced tests for AssetMetadataRecord hash validation methods.
  test('expected metadata hash', () => {
    // Test expectedMetadataHash delegates to AssetMetadataBox.
    const header = new MetadataHeader({
      identifiers: bitmasks.MASK_ID_SHORT,
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 0n,
      deprecatedBy: 0n,
    })
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const record = new AssetMetadataRecord({
      appId: 100n,
      assetId: 200n,
      header,
      body,
    })

    const expected = record.expectedMetadataHash()
    expect(expected.length).toBe(32)
  })

  test('hash matches', () => {
    // Test hashMatches delegates to AssetMetadataBox.
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const params = getDefaultRegistryParams()

    const correctHash = computeMetadataHash({
      assetId: 200n,
      metadataIdentifiers: bitmasks.MASK_ID_SHORT,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata,
      pageSize: params.pageSize,
    })

    const header = new MetadataHeader({
      identifiers: bitmasks.MASK_ID_SHORT,
      flags: MetadataFlags.empty(),
      metadataHash: correctHash,
      lastModifiedRound: 0n,
      deprecatedBy: 0n,
    })
    const body = new MetadataBody(metadata)
    const record = new AssetMetadataRecord({
      appId: 100n,
      assetId: 200n,
      header,
      body,
    })

    expect(record.hashMatches()).toBe(true)
  })

  test('json property', () => {
    // Test json property on AssetMetadataRecord.
    const header = new MetadataHeader({
      identifiers: 0,
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 0n,
      deprecatedBy: 0n,
    })
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test","count":42}'))
    const record = new AssetMetadataRecord({
      appId: 100n,
      assetId: 200n,
      header,
      body,
    })

    expect(record.json).toEqual({ name: 'Test', count: 42 })
  })
})

describe('asset metadata advanced', () => {
  // Advanced tests for AssetMetadata.
  test('convenience properties', () => {
    // Test all convenience properties.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc20: true, arc62: true }),
      irreversible: new IrreversibleFlags({
        arc3: true,
        arc89Native: true,
        immutable: true,
      }),
    })
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 5000n,
    })

    expect(metadata.isEmpty).toBe(false)
    expect(metadata.isShort).toBe(true)
    expect(metadata.size).toBe(body.rawBytes.length)
    expect(metadata.isImmutable).toBe(true)
    expect(metadata.isArc3Compliant).toBe(true)
    expect(metadata.isArc89Native).toBe(true)
    expect(metadata.isArc20SmartAsa).toBe(true)
    expect(metadata.isArc62CirculatingSupply).toBe(true)
    expect(metadata.isDeprecated).toBe(true)
  })

  test('compute header hash', () => {
    // Test computeHeaderHash.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags: MetadataFlags.empty(),
      deprecatedBy: 0n,
    })

    const headerHash = metadata.computeHeaderHash()
    expect(headerHash.length).toBe(32)
    expect(headerHash).not.toEqual(new Uint8Array(32))
  })

  test('compute page hash', () => {
    // Test computePageHash.
    const params = getDefaultRegistryParams()
    const body = new MetadataBody(new Uint8Array(params.pageSize * 2).fill(120))
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags: MetadataFlags.empty(),
      deprecatedBy: 0n,
    })

    const pageHash0 = metadata.computePageHash({ pageIndex: 0 })
    const pageHash1 = metadata.computePageHash({ pageIndex: 1 })

    expect(pageHash0.length).toBe(32)
    expect(pageHash1.length).toBe(32)
    // Different pages should have different hashes
    expect(pageHash0).not.toEqual(pageHash1)
  })

  test('compute metadata hash with asa am', () => {
    // Test computeMetadataHash with asaAm override.
    const asaAm = new Uint8Array(32).fill(0xaa)
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags: new MetadataFlags({
        reversible: ReversibleFlags.empty(),
        irreversible: new IrreversibleFlags({ immutable: true }),
      }),
      deprecatedBy: 0n,
    })

    // With asaAm, should return asaAm directly
    const result = metadata.computeMetadataHash({ asaAm })
    expect(result).toEqual(asaAm)
  })

  test('compute metadata hash asa am invalid length', () => {
    // Test computeMetadataHash with asaAm of wrong length.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags: MetadataFlags.empty(),
      deprecatedBy: 0n,
    })

    expect(() => metadata.computeMetadataHash({ asaAm: new Uint8Array(31).fill(0xaa) })).toThrow(
      /must be exactly 32 bytes/,
    )
  })

  test('compute metadata hash asa am requires immutable', () => {
    // Test computeMetadataHash with asaAm requires immutable flag.
    const asaAm = new Uint8Array(32).fill(0xaa)
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags: MetadataFlags.empty(), // NOT immutable
      deprecatedBy: 0n,
    })

    expect(() => metadata.computeMetadataHash({ asaAm })).toThrow(/ASA `am` override requires immutable/)
  })

  test('compute metadata hash asa am all zeros ignored', () => {
    // Test computeMetadataHash with all-zero asaAm.
    const asaAm = new Uint8Array(32)
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags: MetadataFlags.empty(),
      deprecatedBy: 0n,
    })

    // All-zero asaAm should be ignored
    const result = metadata.computeMetadataHash({ asaAm })
    expect(result).not.toEqual(asaAm)
  })

  test('from bytes simple', () => {
    // Test fromBytes with simple metadata.
    const metadataBytes = new TextEncoder().encode('{"name":"Test"}')
    const metadata = AssetMetadata.fromBytes({
      assetId: 123n,
      metadataBytes,
    })

    expect(metadata.assetId).toBe(123n)
    expect(metadata.body.rawBytes).toEqual(metadataBytes)
    expect(metadata.flags.reversibleByte).toBe(0)
    expect(metadata.flags.irreversibleByte).toBe(0)
  })

  test('from bytes with flags', () => {
    // Test fromBytes with custom flags.
    const metadataBytes = new TextEncoder().encode('{"name":"Test"}')
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc20: true }),
      irreversible: new IrreversibleFlags({ arc3: true }),
    })
    const metadata = AssetMetadata.fromBytes({
      assetId: 456n,
      metadataBytes,
      flags,
    })

    expect(metadata.flags.reversible.arc20).toBe(true)
    expect(metadata.flags.irreversible.arc3).toBe(true)
  })

  test('from bytes with deprecated by', () => {
    // Test fromBytes with deprecatedBy.
    const metadataBytes = new TextEncoder().encode('{"name":"Test"}')
    const metadata = AssetMetadata.fromBytes({
      assetId: 789n,
      metadataBytes,
      deprecatedBy: 5000n,
    })

    expect(metadata.deprecatedBy).toBe(5000n)
  })

  test('from bytes validate json false', () => {
    // Test fromBytes with validateJsonObject=false.
    // Invalid JSON, but validation disabled
    const metadataBytes = new TextEncoder().encode('not valid json')
    const metadata = AssetMetadata.fromBytes({
      assetId: 123n,
      metadataBytes,
      validateJsonObject: false,
    })

    expect(metadata.body.rawBytes).toEqual(metadataBytes)
  })

  test('from bytes arc3 compliant', () => {
    // Test fromBytes with arc3Compliant=true.
    const metadataBytes = new TextEncoder().encode('{"name":"Test","decimals":0}')
    const metadata = AssetMetadata.fromBytes({
      assetId: 123n,
      metadataBytes,
      arc3Compliant: true,
    })

    expect(metadata.body.rawBytes).toEqual(metadataBytes)
  })

  test('from bytes arc3 compliant invalid raises', () => {
    // Test fromBytes with arc3Compliant=true and invalid metadata.
    const metadataBytes = new TextEncoder().encode('{"decimals":"not int"}')

    expect(() =>
      AssetMetadata.fromBytes({
        assetId: 123n,
        metadataBytes,
        arc3Compliant: true,
      }),
    ).toThrow(MetadataArc3Error)
  })
})
