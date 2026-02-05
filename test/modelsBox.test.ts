/**
 * Unit tests for AssetMetadataBox parsing in src/models.
 *
 * Tests cover:
 * - AssetMetadataBox.parse() method
 * - Box value parsing and validation
 */

import { describe, expect, test } from 'vitest'
import {
  models,
  bitmasks,
  constants,
  computeMetadataHash,
  validation,
  BoxParseError,
} from '@algorandfoundation/asa-metadata-registry-sdk'

const { AssetMetadataBox, AssetMetadata, RegistryParameters, getDefaultRegistryParams } = models
const { decodeMetadataJson } = validation

/**
 * Helper to create a valid box value.
 */
const createMinimalBoxValue = (args?: {
  identifiers?: number
  revFlags?: number
  irrFlags?: number
  metadataHash?: Uint8Array
  lastModifiedRound?: number | bigint
  deprecatedBy?: number | bigint
  metadata?: Uint8Array
}): Uint8Array => {
  const identifiers = args?.identifiers ?? 0
  const revFlags = args?.revFlags ?? 0
  const irrFlags = args?.irrFlags ?? 0
  const metadataHash = args?.metadataHash ?? new Uint8Array(32)
  const lastModifiedRound = BigInt(args?.lastModifiedRound ?? 0)
  const deprecatedBy = BigInt(args?.deprecatedBy ?? 0)
  const metadata = args?.metadata ?? new Uint8Array()

  const result = new Uint8Array(51 + metadata.length)
  result[0] = identifiers
  result[1] = revFlags
  result[2] = irrFlags
  result.set(metadataHash, 3)

  // Write uint64 big-endian
  const lmrView = new DataView(result.buffer, result.byteOffset + 35, 8)
  lmrView.setBigUint64(0, lastModifiedRound, false)

  const dbView = new DataView(result.buffer, result.byteOffset + 43, 8)
  dbView.setBigUint64(0, deprecatedBy, false)

  result.set(metadata, 51)
  return result
}

describe('asset metadata box parse', () => {
  // Tests for AssetMetadataBox.parse() method.
  test('parse minimal box', () => {
    // Test parsing minimal valid box (header only, no metadata).
    const boxValue = createMinimalBoxValue()
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    expect(box.assetId).toBe(123n)
    expect(box.header.identifiers).toBe(0)
    expect(box.header.flags.reversibleByte).toBe(0)
    expect(box.header.flags.irreversibleByte).toBe(0)
    expect(box.header.metadataHash).toEqual(new Uint8Array(32))
    expect(box.header.lastModifiedRound).toBe(0n)
    expect(box.header.deprecatedBy).toBe(0n)
    expect(box.body.rawBytes).toEqual(new Uint8Array())
    expect(box.body.isEmpty).toBe(true)
  })

  test('parse box with metadata', () => {
    // Test parsing box with metadata.
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 456n, value: boxValue })

    expect(box.assetId).toBe(456n)
    expect(box.body.rawBytes).toEqual(metadata)
    expect(decodeMetadataJson(box.body.rawBytes)).toEqual({ name: 'Test' })
  })

  test('parse box with flags', () => {
    // Test parsing box with flags set.
    const boxValue = createMinimalBoxValue({
      revFlags: bitmasks.MASK_REV_ARC20,
      irrFlags: bitmasks.MASK_IRR_ARC3 | bitmasks.MASK_IRR_IMMUTABLE,
    })
    const box = AssetMetadataBox.parse({ assetId: 789n, value: boxValue })

    expect(box.header.flags.reversible.arc20).toBe(true)
    expect(box.header.flags.irreversible.arc3).toBe(true)
    expect(box.header.flags.irreversible.immutable).toBe(true)
    expect(box.header.isArc3Compliant).toBe(true)
    expect(box.header.isImmutable).toBe(true)
  })

  test('parse box with short identifier', () => {
    // Test parsing box with short identifier set.
    const boxValue = createMinimalBoxValue({
      identifiers: bitmasks.MASK_ID_SHORT,
    })
    const box = AssetMetadataBox.parse({ assetId: 111n, value: boxValue })

    expect(box.header.identifiers).toBe(bitmasks.MASK_ID_SHORT)
    expect(box.header.isShort).toBe(true)
  })

  test('parse box with rounds', () => {
    // Test parsing box with round values.
    const boxValue = createMinimalBoxValue({
      lastModifiedRound: 12345,
      deprecatedBy: 67890,
    })
    const box = AssetMetadataBox.parse({ assetId: 222n, value: boxValue })

    expect(box.header.lastModifiedRound).toBe(12345n)
    expect(box.header.deprecatedBy).toBe(67890n)
  })

  test('parse box with rounds and metadata', () => {
    // Test parsing box with round values AND metadata.
    // This test catches a bug where deprecated_by was parsed with value[43:]
    // instead of value[43:51], which would include metadata bytes when present.
    const metadata = new TextEncoder().encode('{"name":"Test Asset"}')
    const boxValue = createMinimalBoxValue({
      lastModifiedRound: 12345,
      deprecatedBy: 67890,
      metadata,
    })
    const box = AssetMetadataBox.parse({ assetId: 222n, value: boxValue })

    // These would fail with the buggy implementation that used value[43:]
    expect(box.header.lastModifiedRound).toBe(12345n)
    expect(box.header.deprecatedBy).toBe(67890n)
    expect(box.body.rawBytes).toEqual(metadata)
  })

  test('parse box with custom hash', () => {
    // Test parsing box with custom metadata hash.
    const customHash = new Uint8Array(32).fill(0xaa)
    const boxValue = createMinimalBoxValue({ metadataHash: customHash })
    const box = AssetMetadataBox.parse({ assetId: 333n, value: boxValue })

    expect(box.header.metadataHash).toEqual(customHash)
  })

  test('parse box with large metadata', () => {
    // Test parsing box with large metadata.
    const metadata = new Uint8Array(10000).fill(120)
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 444n, value: boxValue })

    expect(box.body.rawBytes).toEqual(metadata)
    expect(box.body.size).toBe(10000)
    expect(box.body.isShort).toBe(false)
  })

  test('parse box too small raises', () => {
    // Test that box value smaller than header size raises.
    // Header is 51 bytes, provide only 50
    const boxValue = new Uint8Array(50)
    expect(() => AssetMetadataBox.parse({ assetId: 555n, value: boxValue })).toThrow(BoxParseError)
    expect(() => AssetMetadataBox.parse({ assetId: 555n, value: boxValue })).toThrow(/Box value too small/)
  })

  test('parse box empty raises', () => {
    // Test that empty box value raises.
    expect(() => AssetMetadataBox.parse({ assetId: 666n, value: new Uint8Array() })).toThrow(BoxParseError)
    expect(() => AssetMetadataBox.parse({ assetId: 666n, value: new Uint8Array() })).toThrow(/Box value too small/)
  })

  test('parse box invalid hash length raises', () => {
    // Test that invalid metadata hash length raises.
    // Create box with wrong hash length (should be 32 bytes)
    // The box is 50 bytes (3 + 31 + 8 + 8) which is less than header_size (51)
    // So it will fail with "Box value too small" before checking hash length
    const boxValue = new Uint8Array(50)
    boxValue[0] = 0 // identifiers
    boxValue[1] = 0 // rev_flags
    boxValue[2] = 0 // irr_flags
    // Only 31 bytes for hash (wrong)
    expect(() => AssetMetadataBox.parse({ assetId: 777n, value: boxValue })).toThrow(/Box value too small/)
  })

  test('parse box metadata exceeds max raises', () => {
    // Test that metadata exceeding max size raises.
    // Create metadata larger than max
    const metadata = new Uint8Array(constants.MAX_METADATA_SIZE + 1).fill(120)
    const boxValue = createMinimalBoxValue({ metadata })

    expect(() => AssetMetadataBox.parse({ assetId: 888n, value: boxValue })).toThrow(BoxParseError)
    expect(() => AssetMetadataBox.parse({ assetId: 888n, value: boxValue })).toThrow(/exceeds maxMetadataSize/)
  })

  test('parse box with custom header size', () => {
    // Test parsing with custom header size.
    // Since the actual header parsing expects specific structure,
    // we need to create a properly formatted header even with custom size
    const customHeaderSize = 60 // Larger than default 51
    const metadata = new TextEncoder().encode('{"name":"Test"}')

    // Create a valid header first
    const baseBox = createMinimalBoxValue({ metadata })

    // Extend it to custom header size by adding padding
    const boxValue = new Uint8Array(customHeaderSize + metadata.length)
    boxValue.set(baseBox.slice(0, 51), 0) // Copy original header
    // Add padding between header and metadata
    boxValue.set(metadata, customHeaderSize)

    const box = AssetMetadataBox.parse({
      assetId: 999n,
      value: boxValue,
      headerSize: customHeaderSize,
    })

    // The body should start at customHeaderSize
    expect(box.body.rawBytes).toEqual(metadata)
  })

  test('parse box with custom max metadata size', () => {
    // Test parsing with custom max metadata size.
    const metadata = new Uint8Array(100).fill(120)
    const boxValue = createMinimalBoxValue({ metadata })

    // Set max to less than metadata size - should raise
    expect(() =>
      AssetMetadataBox.parse({
        assetId: 1111n,
        value: boxValue,
        maxMetadataSize: 50,
      }),
    ).toThrow(/exceeds maxMetadataSize/)
  })

  test('parse box max uint64 rounds', () => {
    // Test parsing box with maximum uint64 round values.
    const maxUint64 = 2n ** 64n - 1n
    const boxValue = createMinimalBoxValue({
      lastModifiedRound: maxUint64,
      deprecatedBy: maxUint64,
    })
    const box = AssetMetadataBox.parse({ assetId: 2222n, value: boxValue })

    expect(box.header.lastModifiedRound).toBe(maxUint64)
    expect(box.header.deprecatedBy).toBe(maxUint64)
  })

  test('parse box all flags set', () => {
    // Test parsing box with all flags set.
    const boxValue = createMinimalBoxValue({
      identifiers: 0xff,
      revFlags: 0xff,
      irrFlags: 0xff,
    })
    const box = AssetMetadataBox.parse({ assetId: 3333n, value: boxValue })

    expect(box.header.identifiers).toBe(0xff)
    expect(box.header.flags.reversibleByte).toBe(0xff)
    expect(box.header.flags.irreversibleByte).toBe(0xff)
  })

  test('parse box unicode metadata', () => {
    // Test parsing box with Unicode metadata.
    const metadata = new TextEncoder().encode('{"emoji":"🎉","text":"你好"}')
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 4444n, value: boxValue })

    expect(box.body.rawBytes).toEqual(metadata)
    expect(decodeMetadataJson(box.body.rawBytes)).toEqual({
      emoji: '🎉',
      text: '你好',
    })
  })

  test('parse preserves exact bytes', () => {
    // Test that parsing preserves exact byte representation of metadata.
    // Use specific JSON formatting
    const metadata = new TextEncoder().encode('{"a":1,"b":2}')
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 5555n, value: boxValue })

    // The exact bytes should be preserved
    expect(box.body.rawBytes).toEqual(metadata)
  })

  test('parse box at max size', () => {
    // Test parsing box with metadata at exactly max size.
    const metadata = new Uint8Array(constants.MAX_METADATA_SIZE).fill(120)
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 6666n, value: boxValue })

    expect(box.body.size).toBe(constants.MAX_METADATA_SIZE)
  })

  test('parse box short boundary', () => {
    // Test parsing box at short metadata size boundary.
    // At exactly SHORT_METADATA_SIZE
    const metadata = new Uint8Array(constants.SHORT_METADATA_SIZE).fill(120)
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 7777n, value: boxValue })

    expect(box.body.size).toBe(constants.SHORT_METADATA_SIZE)
    expect(box.body.isShort).toBe(true)

    // One byte over
    const metadataOver = new Uint8Array(constants.SHORT_METADATA_SIZE + 1).fill(120)
    const boxValueOver = createMinimalBoxValue({ metadata: metadataOver })
    const boxOver = AssetMetadataBox.parse({ assetId: 7778n, value: boxValueOver })

    expect(boxOver.body.size).toBe(constants.SHORT_METADATA_SIZE + 1)
    expect(boxOver.body.isShort).toBe(false)
  })

  test('parse realistic arc3 metadata', () => {
    // Test parsing box with realistic ARC-3 metadata.
    const metadataObj = {
      name: 'My NFT',
      decimals: 0,
      description: 'A test NFT',
      image: 'https://example.com/image.png',
      properties: {
        trait1: 'value1',
        trait2: 'value2',
      },
    }
    const metadata = new TextEncoder().encode(JSON.stringify(metadataObj))

    const boxValue = createMinimalBoxValue({
      revFlags: 0,
      irrFlags: bitmasks.MASK_IRR_ARC3,
      metadata,
    })
    const box = AssetMetadataBox.parse({ assetId: 8888n, value: boxValue })

    expect(box.header.isArc3Compliant).toBe(true)
    const decoded = decodeMetadataJson(box.body.rawBytes)
    expect(decoded.name).toBe('My NFT')
    expect(decoded.decimals).toBe(0)
    expect((decoded.properties as any).trait1).toBe('value1')
  })
})

describe('asset metadata box advanced', () => {
  // Advanced tests for AssetMetadataBox hash validation methods.
  test('expected metadata hash without asa am', () => {
    // Test expected_metadata_hash without ASA am override.
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    // Should compute from metadata
    const expectedHash = box.expectedMetadataHash()
    expect(expectedHash.length).toBe(32)
    expect(expectedHash).not.toEqual(new Uint8Array(32))
  })

  test('expected metadata hash with asa am override', () => {
    // Test expected_metadata_hash with ASA am override.
    const asaAm = new Uint8Array(32).fill(0xaa)
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const boxValue = createMinimalBoxValue({
      metadata,
      irrFlags: bitmasks.MASK_IRR_IMMUTABLE, // Required for override
    })
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    // Should return asa_am directly
    const expectedHash = box.expectedMetadataHash({ asaAm })
    expect(expectedHash).toEqual(asaAm)
  })

  test('expected metadata hash asa am requires immutable', () => {
    // Test expected_metadata_hash with asa_am requires immutable flag.
    const asaAm = new Uint8Array(32).fill(0xaa)
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const boxValue = createMinimalBoxValue({
      metadata,
      irrFlags: 0, // NOT immutable
    })
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    expect(() => box.expectedMetadataHash({ asaAm })).toThrow(/ASA `am` override requires immutable/)
  })

  test('expected metadata hash asa am all zeros ignored', () => {
    // Test expected_metadata_hash with all-zero asa_am (should be ignored).
    const asaAm = new Uint8Array(32)
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    // All-zero asa_am should be ignored, compute from metadata
    const expectedHash = box.expectedMetadataHash({ asaAm })
    expect(expectedHash).not.toEqual(asaAm)
  })

  test('hash matches true', () => {
    // Test hash_matches when hashes match.
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const params = getDefaultRegistryParams()

    // Compute correct hash
    const correctHash = computeMetadataHash({
      assetId: 123n,
      metadataIdentifiers: bitmasks.MASK_ID_SHORT,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata,
      pageSize: params.pageSize,
    })

    const boxValue = createMinimalBoxValue({
      identifiers: bitmasks.MASK_ID_SHORT,
      metadata,
      metadataHash: correctHash,
    })
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    expect(box.hashMatches()).toBe(true)
  })

  test('hash matches false', () => {
    // Test hash_matches when hashes don't match.
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const wrongHash = new Uint8Array(32).fill(0xff)

    const boxValue = createMinimalBoxValue({
      identifiers: bitmasks.MASK_ID_SHORT,
      metadata,
      metadataHash: wrongHash,
    })
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    expect(box.hashMatches()).toBe(false)
  })

  test('hash matches with asa am skip validation', () => {
    // Test hash_matches with asa_am and skip_validation=True.
    const asaAm = new Uint8Array(32).fill(0xaa)
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const wrongHash = new Uint8Array(32).fill(0xff)

    const boxValue = createMinimalBoxValue({
      metadata,
      metadataHash: wrongHash,
    })
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    // With skip_validation=True and non-zero asa_am, should return True
    expect(box.hashMatches({ asaAm, skipValidationOnOverride: true })).toBe(true)
  })

  test('json property', () => {
    // Test json property on AssetMetadataBox.
    const metadata = new TextEncoder().encode('{"name":"Test","value":42}')
    const boxValue = createMinimalBoxValue({ metadata })
    const box = AssetMetadataBox.parse({ assetId: 123n, value: boxValue })

    expect(box.json).toEqual({ name: 'Test', value: 42 })
  })

  test('as asset metadata', () => {
    // Test as_asset_metadata conversion.
    const metadata = new TextEncoder().encode('{"name":"Test"}')
    const boxValue = createMinimalBoxValue({
      metadata,
      revFlags: bitmasks.MASK_REV_ARC20,
      irrFlags: bitmasks.MASK_IRR_ARC3,
      deprecatedBy: 5000,
    })
    const box = AssetMetadataBox.parse({ assetId: 456n, value: boxValue })

    const assetMetadata = box.asAssetMetadata()
    expect(assetMetadata).toBeInstanceOf(AssetMetadata)
    expect(assetMetadata.assetId).toBe(456n)
    expect(assetMetadata.body.rawBytes).toEqual(metadata)
    expect(assetMetadata.flags.reversible.arc20).toBe(true)
    expect(assetMetadata.flags.irreversible.arc3).toBe(true)
    expect(assetMetadata.deprecatedBy).toBe(5000n)
  })

  test('parse with params overrides header size', () => {
    // Test parse with params overrides header_size.
    // Create custom params with different header size
    const customParams = new RegistryParameters({
      keySize: constants.ASSET_METADATA_BOX_KEY_SIZE,
      headerSize: 60, // Different from default
      maxMetadataSize: constants.MAX_METADATA_SIZE,
      shortMetadataSize: constants.SHORT_METADATA_SIZE,
      pageSize: constants.PAGE_SIZE,
      firstPayloadMaxSize: constants.FIRST_PAYLOAD_MAX_SIZE,
      extraPayloadMaxSize: constants.EXTRA_PAYLOAD_MAX_SIZE,
      replacePayloadMaxSize: constants.REPLACE_PAYLOAD_MAX_SIZE,
      flatMbr: constants.FLAT_MBR,
      byteMbr: constants.BYTE_MBR,
    })

    // Create box with extended header (60 bytes instead of 51)
    const baseValue = createMinimalBoxValue({ metadata: new TextEncoder().encode('{"name":"Test"}') })
    // Add extra 9 bytes for the extended header
    const boxValue = new Uint8Array(60 + baseValue.length - 51)
    boxValue.set(baseValue.slice(0, 51), 0)
    boxValue.set(baseValue.slice(51), 60)

    // Parse with custom params (should use params.header_size)
    const box = AssetMetadataBox.parse({
      assetId: 123n,
      value: boxValue,
      params: customParams,
    })
    expect(box.assetId).toBe(123n)
    // Body starts after 60 bytes instead of 51
    expect(box.body.rawBytes).toEqual(baseValue.slice(51))
  })

  test('parse with params overrides max metadata size', () => {
    // Test parse with params overrides max_metadata_size.
    // Create custom params with smaller max_metadata_size
    const customParams = new RegistryParameters({
      keySize: constants.ASSET_METADATA_BOX_KEY_SIZE,
      headerSize: constants.HEADER_SIZE,
      maxMetadataSize: 100, // Very small limit
      shortMetadataSize: constants.SHORT_METADATA_SIZE,
      pageSize: constants.PAGE_SIZE,
      firstPayloadMaxSize: constants.FIRST_PAYLOAD_MAX_SIZE,
      extraPayloadMaxSize: constants.EXTRA_PAYLOAD_MAX_SIZE,
      replacePayloadMaxSize: constants.REPLACE_PAYLOAD_MAX_SIZE,
      flatMbr: constants.FLAT_MBR,
      byteMbr: constants.BYTE_MBR,
    })

    // Create box with metadata exceeding custom limit
    const metadata = new Uint8Array(150).fill(120)
    const boxValue = createMinimalBoxValue({ metadata })

    // Should raise because metadata exceeds custom max_metadata_size
    expect(() => AssetMetadataBox.parse({ assetId: 123n, value: boxValue, params: customParams })).toThrow(
      /exceeds maxMetadataSize/,
    )
  })

  test('parse known header validation edge case', () => {
    // Test parse with custom header_size smaller than known header.
    // Edge case: custom header_size < min_known_header should not trigger
    // the secondary validation check (line 673-675)
    const customHeaderSize = 40 // Less than min_known_header (51)

    // Create a box with exactly 40 bytes of header + metadata
    const boxValue = new Uint8Array(40 + 15)
    boxValue.set(new TextEncoder().encode('{"name":"Test"}'), 40)

    // This should parse without the min_known_header check since
    // header_size < min_known_header
    const box = AssetMetadataBox.parse({
      assetId: 123n,
      value: boxValue,
      headerSize: customHeaderSize,
    })
    expect(box.body.rawBytes).toEqual(new TextEncoder().encode('{"name":"Test"}'))
  })

  test('parse malformed header raises', () => {
    // Test parse with malformed header data raises BoxParseError.
    // Create a box value that will cause an exception during parsing
    // e.g., not enough bytes for uint64 fields
    const malformedValue = new Uint8Array(50) // 50 bytes, just short of full header

    expect(() => AssetMetadataBox.parse({ assetId: 123n, value: malformedValue })).toThrow(/Box value too small/)
  })

  test('parse with large custom header size edge case', () => {
    // Test parse with custom header_size >= min_known_header but value too small.
    // This tests line 674: the secondary validation for known header size
    // Create a custom header size that's >= min_known_header (51)
    const customHeaderSize = 60

    // Create a value that's less than min_known_header
    // This should trigger the "Box value too small for known header" error
    const shortValue = new Uint8Array(48) // Less than min_known_header

    expect(() =>
      AssetMetadataBox.parse({
        assetId: 123n,
        value: shortValue,
        headerSize: customHeaderSize,
      }),
    ).toThrow(/Box value too small/)
  })
})
