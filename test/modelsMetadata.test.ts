/**
 * Unit tests for metadata models in src/models.
 *
 * Tests cover:
 * - MetadataBody
 * - MetadataHeader
 * - AssetMetadata
 * - AssetMetadataRecord
 */

import { describe, expect, test } from 'vitest'
import {
  models,
  bitmasks,
  constants,
  validation,
  computeMetadataHash,
  MetadataHashMismatchError,
  MetadataArc3Error,
} from '@algorandfoundation/asa-metadata-registry-sdk'

const {
  MetadataBody,
  MetadataHeader,
  AssetMetadata,
  AssetMetadataRecord,
  MetadataFlags,
  ReversibleFlags,
  IrreversibleFlags,
  getDefaultRegistryParams,
} = models
const { decodeMetadataJson } = validation

describe('metadata body', () => {
  // Tests for MetadataBody dataclass.
  test('empty body', () => {
    // Test empty metadata body.
    const body = MetadataBody.empty()
    expect(body.rawBytes).toEqual(new Uint8Array())
    expect(body.size).toBe(0)
    expect(body.isEmpty).toBe(true)
    expect(body.isShort).toBe(true)
    // Empty bytes decode to empty dict
    expect(decodeMetadataJson(body.rawBytes)).toEqual({})
  })

  test('small body', () => {
    // Test small metadata body.
    const data = new TextEncoder().encode('{"name":"Test"}')
    const body = new MetadataBody(data)
    expect(body.rawBytes).toEqual(data)
    expect(body.size).toBe(data.length)
    expect(body.isEmpty).toBe(false)
    expect(body.isShort).toBe(true)
    // Check JSON decoding
    expect(decodeMetadataJson(body.rawBytes)).toEqual({ name: 'Test' })
  })

  test('short metadata boundary', () => {
    // Test metadata at short size boundary.
    const data = new Uint8Array(constants.SHORT_METADATA_SIZE).fill(120)
    const body = new MetadataBody(data)
    expect(body.size).toBe(constants.SHORT_METADATA_SIZE)
    expect(body.isShort).toBe(true)
  })

  test('just over short size', () => {
    // Test metadata just over short size.
    const data = new Uint8Array(constants.SHORT_METADATA_SIZE + 1).fill(120)
    const body = new MetadataBody(data)
    expect(body.size).toBe(constants.SHORT_METADATA_SIZE + 1)
    expect(body.isShort).toBe(false)
  })

  test('large body', () => {
    // Test large metadata body.
    const data = new Uint8Array(10000).fill(120)
    const body = new MetadataBody(data)
    expect(body.size).toBe(10000)
    expect(body.isEmpty).toBe(false)
    expect(body.isShort).toBe(false)
  })

  test('total pages zero size', () => {
    // Test totalPages for zero-size metadata.
    const body = MetadataBody.empty()
    expect(body.totalPages()).toBe(0)
  })

  test('total pages one page', () => {
    // Test totalPages when metadata fits in one page.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.pageSize - 10).fill(120)
    const body = new MetadataBody(data)
    expect(body.totalPages(params)).toBe(1)
  })

  test('total pages exact page', () => {
    // Test totalPages when metadata exactly fills pages.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.pageSize * 3).fill(120)
    const body = new MetadataBody(data)
    expect(body.totalPages(params)).toBe(3)
  })

  test('total pages partial last page', () => {
    // Test totalPages when last page is partial.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.pageSize * 2 + 100).fill(120)
    const body = new MetadataBody(data)
    expect(body.totalPages(params)).toBe(3)
  })

  test('chunked payload empty', () => {
    // Test chunkedPayload for empty metadata.
    const body = MetadataBody.empty()
    const chunks = body.chunkedPayload()
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toEqual(new Uint8Array())
  })

  test('chunked payload fits in first', () => {
    // Test chunkedPayload when data fits in first chunk.
    const data = new Uint8Array(100).fill(120)
    const body = new MetadataBody(data)
    const chunks = body.chunkedPayload()
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toEqual(data)
  })

  test('chunked payload multiple chunks', () => {
    // Test chunkedPayload with multiple chunks.
    const headSize = constants.FIRST_PAYLOAD_MAX_SIZE
    const extraSize = constants.EXTRA_PAYLOAD_MAX_SIZE
    const data = new Uint8Array(headSize + extraSize + 100).fill(120)
    const body = new MetadataBody(data)
    const chunks = body.chunkedPayload()

    expect(chunks.length).toBe(3)
    expect(chunks[0].length).toBe(headSize)
    expect(chunks[1].length).toBe(extraSize)
    expect(chunks[2].length).toBe(100)
  })

  test('validate size within limit', () => {
    // Test validateSize when metadata is within limit.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.maxMetadataSize - 100).fill(120)
    const body = new MetadataBody(data)
    body.validateSize(params) // Should not raise
  })

  test('validate size at limit', () => {
    // Test validateSize when metadata is at limit.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.maxMetadataSize).fill(120)
    const body = new MetadataBody(data)
    body.validateSize(params) // Should not raise
  })

  test('validate size exceeds limit', () => {
    // Test validateSize when metadata exceeds limit.
    const params = getDefaultRegistryParams()
    const data = new Uint8Array(params.maxMetadataSize + 1).fill(120)
    const body = new MetadataBody(data)
    expect(() => body.validateSize(params)).toThrow(/exceeds max/)
  })

  test('from json simple', () => {
    // Test fromJson with simple object.
    const obj = { name: 'Test', value: 123 }
    const body = MetadataBody.fromJson(obj)

    expect(decodeMetadataJson(body.rawBytes)).toEqual(obj)
    expect(body.size).toBeGreaterThan(0)
  })

  test('from json arc3 compliant valid', () => {
    // Test fromJson with ARC-3 compliant metadata.
    const obj = {
      name: 'My NFT',
      decimals: 0,
      description: 'A test NFT',
    }
    const body = MetadataBody.fromJson(obj, { arc3Compliant: true })

    expect(decodeMetadataJson(body.rawBytes)).toEqual(obj)
  })

  test('from json arc3 compliant invalid raises', () => {
    // Test fromJson with invalid ARC-3 metadata raises.
    const obj = { decimals: 'not an integer' }
    expect(() => MetadataBody.fromJson(obj, { arc3Compliant: true })).toThrow(MetadataArc3Error)
  })
})

describe('metadata header', () => {
  // Tests for MetadataHeader dataclass.
  test('basic header', () => {
    // Test basic metadata header.
    const flags = MetadataFlags.empty()
    const header = new MetadataHeader({
      identifiers: 0,
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.identifiers).toBe(0)
    expect(header.flags).toBe(flags)
    expect(header.metadataHash).toEqual(new Uint8Array(32))
    expect(header.lastModifiedRound).toBe(1000n)
    expect(header.deprecatedBy).toBe(0n)
  })

  test('is short false', () => {
    // Test isShort property when not short.
    const flags = MetadataFlags.empty()
    const header = new MetadataHeader({
      identifiers: 0, // Short bit not set
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.isShort).toBe(false)
  })

  test('is short true', () => {
    // Test isShort property when short.
    const flags = MetadataFlags.empty()
    const header = new MetadataHeader({
      identifiers: bitmasks.MASK_ID_SHORT,
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.isShort).toBe(true)
  })

  test('is immutable false', () => {
    // Test isImmutable property when not immutable.
    const flags = MetadataFlags.empty()
    const header = new MetadataHeader({
      identifiers: 0,
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.isImmutable).toBe(false)
  })

  test('is immutable true', () => {
    // Test isImmutable property when immutable.
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ immutable: true }),
    })
    const header = new MetadataHeader({
      identifiers: 0,
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.isImmutable).toBe(true)
  })

  test('is arc3 compliant', () => {
    // Test isArc3Compliant property.
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc3: true }),
    })
    const header = new MetadataHeader({
      identifiers: 0,
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.isArc3Compliant).toBe(true)
  })

  test('is arc89 native', () => {
    // Test isArc89Native property.
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc89Native: true }),
    })
    const header = new MetadataHeader({
      identifiers: 0,
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.isArc89Native).toBe(true)
  })

  test('is arc20 smart asa', () => {
    // Test isArc20SmartAsa property.
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc20: true }),
      irreversible: IrreversibleFlags.empty(),
    })
    const header = new MetadataHeader({
      identifiers: 0,
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.isArc20SmartAsa).toBe(true)
  })

  test('is arc62 circulating supply', () => {
    // Test isArc62CirculatingSupply property.
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc62: true }),
      irreversible: IrreversibleFlags.empty(),
    })
    const header = new MetadataHeader({
      identifiers: 0,
      flags,
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    expect(header.isArc62CirculatingSupply).toBe(true)
  })

  test('from tuple', () => {
    // Test fromTuple parsing.
    const tupleData = [
      10, // identifiers
      5, // reversible flags
      3, // irreversible flags
      new Uint8Array(32).fill(0xaa), // hash
      2000, // lastModifiedRound
      100, // deprecatedBy
    ]
    const header = MetadataHeader.fromTuple(tupleData)

    expect(header.identifiers).toBe(10)
    expect(header.flags.reversibleByte).toBe(5)
    expect(header.flags.irreversibleByte).toBe(3)
    expect(header.metadataHash).toEqual(new Uint8Array(32).fill(0xaa))
    expect(header.lastModifiedRound).toBe(2000n)
    expect(header.deprecatedBy).toBe(100n)
  })

  test('from tuple invalid length', () => {
    // Test fromTuple with wrong number of elements.
    expect(() => MetadataHeader.fromTuple([1, 2, 3])).toThrow(/Expected 6-tuple/)
  })
})

describe('asset metadata', () => {
  // Tests for AssetMetadata dataclass.
  test('basic metadata', () => {
    // Test basic asset metadata.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = MetadataFlags.empty()
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    expect(metadata.assetId).toBe(123n)
    expect(metadata.body).toBe(body)
    expect(metadata.flags).toBe(flags)
    expect(metadata.deprecatedBy).toBe(0n)
  })

  test('compute metadata hash', () => {
    // Test computeMetadataHash method.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = MetadataFlags.empty()
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    const params = getDefaultRegistryParams()
    const hashResult = metadata.computeMetadataHash()

    expect(hashResult).toBeInstanceOf(Uint8Array)
    expect(hashResult.length).toBe(32)

    // Verify hash is correct by comparing to the standalone hash function
    const expectedHash = computeMetadataHash({
      assetId: metadata.assetId,
      metadataIdentifiers: metadata.identifiersByte,
      reversibleFlags: metadata.flags.reversibleByte,
      irreversibleFlags: metadata.flags.irreversibleByte,
      metadata: metadata.body.rawBytes,
      pageSize: params.pageSize,
    })
    expect(hashResult).toEqual(expectedHash)
  })

  test('compute metadata hash short metadata', () => {
    // Test computeMetadataHash with short metadata (identifiers should be set).
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Short"}'))
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc20: true }),
      irreversible: new IrreversibleFlags({ arc3: true }),
    })
    const metadata = new AssetMetadata({
      assetId: 456n,
      body,
      flags,
      deprecatedBy: 0,
    })
    const params = getDefaultRegistryParams()

    // Verify it's marked as short
    expect(body.isShort).toBe(true)
    expect(metadata.identifiersByte).toBe(bitmasks.MASK_ID_SHORT)

    const hashResult = metadata.computeMetadataHash()

    // Verify hash matches expected value
    const expectedHash = computeMetadataHash({
      assetId: 456n,
      metadataIdentifiers: bitmasks.MASK_ID_SHORT,
      reversibleFlags: flags.reversibleByte,
      irreversibleFlags: flags.irreversibleByte,
      metadata: body.rawBytes,
      pageSize: params.pageSize,
    })
    expect(hashResult).toEqual(expectedHash)
  })

  test('compute metadata hash long metadata', () => {
    // Test computeMetadataHash with long metadata (identifiers should be 0).
    const largeData = new Uint8Array(constants.SHORT_METADATA_SIZE + 100).fill(120)
    const body = new MetadataBody(largeData)
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc62: true }),
      irreversible: new IrreversibleFlags({ immutable: true }),
    })
    const metadata = new AssetMetadata({
      assetId: 789n,
      body,
      flags,
      deprecatedBy: 0,
    })
    const params = getDefaultRegistryParams()

    // Verify it's NOT marked as short
    expect(body.isShort).toBe(false)
    expect(metadata.identifiersByte).toBe(0)

    const hashResult = metadata.computeMetadataHash()

    // Verify hash matches expected value
    const expectedHash = computeMetadataHash({
      assetId: 789n,
      metadataIdentifiers: 0,
      reversibleFlags: flags.reversibleByte,
      irreversibleFlags: flags.irreversibleByte,
      metadata: largeData,
      pageSize: params.pageSize,
    })
    expect(hashResult).toEqual(expectedHash)
  })

  test('get mbr delta creation', () => {
    // Test getMbrDelta for creation.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = MetadataFlags.empty()
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    const delta = metadata.getMbrDelta()

    expect(delta.isPositive).toBe(true)
    expect(delta.amount).toBeGreaterThan(0)
  })

  test('get mbr delta update', () => {
    // Test getMbrDelta for update.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test","extra":"data"}'))
    const flags = MetadataFlags.empty()
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    const oldSize = 50
    const delta = metadata.getMbrDelta({ oldSize })

    // Delta depends on size difference
    expect(delta).toBeDefined()
  })

  test('get delete mbr delta', () => {
    // Test getDeleteMbrDelta.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = MetadataFlags.empty()
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    const delta = metadata.getDeleteMbrDelta()

    expect(delta.isNegative).toBe(true)
    expect(delta.amount).toBeGreaterThan(0)
  })

  test('from json simple', () => {
    // Test fromJson with simple JSON object.
    const obj = { name: 'My Token', value: 42 }
    const metadata = AssetMetadata.fromJson({
      assetId: 456n,
      jsonObj: obj,
    })
    expect(metadata.assetId).toBe(456n)

    expect(decodeMetadataJson(metadata.body.rawBytes)).toEqual(obj)
    expect(metadata.flags.reversibleByte).toBe(0)
    expect(metadata.flags.irreversibleByte).toBe(0)
    expect(metadata.deprecatedBy).toBe(0n)
  })

  test('from json with flags', () => {
    // Test fromJson with flags.
    const obj = { name: 'My Token' }
    const metadata = AssetMetadata.fromJson({
      assetId: 789n,
      jsonObj: obj,
      flags: new MetadataFlags({
        reversible: new ReversibleFlags({ arc20: true }),
        irreversible: new IrreversibleFlags({ arc3: true }),
      }),
    })
    expect(metadata.assetId).toBe(789n)
    expect(metadata.flags.reversible.arc20).toBe(true)
    expect(metadata.flags.irreversible.arc3).toBe(true)
  })

  test('from json with deprecated by', () => {
    // Test fromJson with deprecatedBy.
    const obj = { name: 'My Token' }
    const metadata = AssetMetadata.fromJson({
      assetId: 999n,
      jsonObj: obj,
      deprecatedBy: 5000,
    })
    expect(metadata.deprecatedBy).toBe(5000n)
  })

  test('from json arc3 compliant valid', () => {
    // Test fromJson with valid ARC-3 metadata.
    const obj = {
      name: 'My NFT',
      decimals: 0,
      description: 'Test',
    }
    const metadata = AssetMetadata.fromJson({
      assetId: 111n,
      jsonObj: obj,
      arc3Compliant: true,
    })

    expect(decodeMetadataJson(metadata.body.rawBytes)).toEqual(obj)
    expect(metadata.flags.irreversible.arc3).toBe(true)
  })

  test('from json arc3 compliant invalid raises', () => {
    // Test fromJson with invalid ARC-3 metadata raises.
    const obj = { decimals: 'invalid' }
    expect(() =>
      AssetMetadata.fromJson({
        assetId: 222n,
        jsonObj: obj,
        arc3Compliant: true,
      }),
    ).toThrow(MetadataArc3Error)
  })

  test('compute metadata hash arc89 native no arc3 mismatch raises', () => {
    // Test that MetadataHashMismatchError is raised when ARC89 native, not ARC3, and am doesn't match.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc89Native: true, immutable: true }),
    })
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    // Create a non-matching hash
    const wrongHash = new Uint8Array([...new TextEncoder().encode('WRONG_HASH_THAT_WONT_MATCH__'), 0, 0, 0, 0])
    expect(wrongHash.length).toBe(32)

    expect(() => metadata.computeMetadataHash({ asaAm: wrongHash })).toThrow(MetadataHashMismatchError)
  })

  test('compute metadata hash arc89 native no arc3 match succeeds', () => {
    // Test that matching hash succeeds for ARC89 native without ARC3.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc89Native: true, immutable: true }),
    })
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    // Get the correct hash
    const correctHash = metadata.computeArc89MetadataHash()

    // This should succeed
    const result = metadata.computeMetadataHash({ asaAm: correctHash })
    expect(result).toEqual(correctHash)
  })

  test('compute metadata hash arc89 native with arc3 bypasses check', () => {
    // Test that ARC3 flag bypasses the hash matching check for ARC89 native.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test","decimals":0}'))
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({
        arc89Native: true,
        arc3: true,
        immutable: true,
      }),
    })
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    // Create a non-matching hash (would fail without ARC3 bypass)
    const arbitraryHash = new Uint8Array([...new TextEncoder().encode('ARC3_HASH_THAT_DIFFERS_OK___'), 0, 0, 0, 0])
    expect(arbitraryHash.length).toBe(32)

    // This should succeed because ARC3 is set
    const result = metadata.computeMetadataHash({ asaAm: arbitraryHash })
    expect(result).toEqual(arbitraryHash)
  })

  test('compute metadata hash no arc89 native allows any hash', () => {
    // Test that without ARC89 native, any hash is accepted.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ immutable: true }), // No arc89Native
    })
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    // Create a non-matching hash
    const arbitraryHash = new Uint8Array([...new TextEncoder().encode('ANY_HASH_WITHOUT_ARC89_OK___'), 0, 0, 0, 0])
    expect(arbitraryHash.length).toBe(32)

    // This should succeed because arc89Native is not set
    const result = metadata.computeMetadataHash({ asaAm: arbitraryHash })
    expect(result).toEqual(arbitraryHash)
  })

  test('compute metadata hash arc89 native enforce disabled', () => {
    // Test that enforceArc89NativeHashMatch=false disables the check.
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc89Native: true, immutable: true }),
    })
    const metadata = new AssetMetadata({
      assetId: 123n,
      body,
      flags,
      deprecatedBy: 0,
    })
    // Create a non-matching hash
    const wrongHash = new Uint8Array([...new TextEncoder().encode('WRONG_HASH_BUT_CHECK_DISABLED_'), 0, 0])
    expect(wrongHash.length).toBe(32)

    // This should succeed because enforcement is disabled
    const result = metadata.computeMetadataHash({
      asaAm: wrongHash,
      enforceArc89NativeHashMatch: false,
    })
    expect(result).toEqual(wrongHash)
  })
})

describe('asset metadata record', () => {
  // Tests for AssetMetadataRecord dataclass.
  test('basic record', () => {
    // Test basic metadata record.
    const header = new MetadataHeader({
      identifiers: 0,
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const record = new AssetMetadataRecord({
      appId: 100n,
      assetId: 200n,
      header,
      body,
    })
    expect(record.appId).toBe(100n)
    expect(record.assetId).toBe(200n)
    expect(record.header).toBe(header)
    expect(record.body).toBe(body)
  })

  test('json property', () => {
    // Test json property.
    const header = new MetadataHeader({
      identifiers: 0,
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test","value":123}'))
    const record = new AssetMetadataRecord({
      appId: 100n,
      assetId: 200n,
      header,
      body,
    })

    // Ensure the record's json getter decodes correctly
    expect(record.json).toEqual({
      name: 'Test',
      value: 123,
    })
    // Also validate decoding directly against the raw bytes
    expect(decodeMetadataJson(record.body.rawBytes)).toEqual({
      name: 'Test',
      value: 123,
    })
  })

  test('as asset metadata', () => {
    // Test asAssetMetadata conversion.
    const header = new MetadataHeader({
      identifiers: 0,
      flags: MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 500,
    })
    const body = new MetadataBody(new TextEncoder().encode('{"name":"Test"}'))
    const record = new AssetMetadataRecord({
      appId: 100n,
      assetId: 200n,
      header,
      body,
    })

    const metadata = record.asAssetMetadata()
    expect(metadata).toBeInstanceOf(AssetMetadata)
    expect(metadata.assetId).toBe(200n)
    expect(metadata.body).toBe(body)
    expect(metadata.flags).toBe(header.flags)
    expect(metadata.deprecatedBy).toBe(500n)
  })
})
