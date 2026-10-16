/**
 * Unit tests for src/codec module.
 *
 * Ported from Python `tests/sdk/test_codec.py`.
 *
 * Tests cover:
 * - assetIdToBoxName and boxNameToAssetId
 * - b64Encode and b64Decode
 * - b64UrlEncode and b64UrlDecode
 * - Arc90Compliance parsing and serialization
 * - Arc90Uri parsing and serialization
 * - completePartialAssetUrl
 */

import { describe, expect, test } from 'vitest'
import { codec, constants, InvalidArc90UriError } from '@algorandfoundation/asa-metadata-registry-sdk'

const {
  assetIdToBoxName,
  boxNameToAssetId,
  b64Encode,
  b64Decode,
  b64UrlEncode,
  b64UrlDecode,
  Arc90Compliance,
  Arc90Uri,
  completePartialAssetUrl,
} = codec

describe('asset id / box name conversion', () => {
  // Tests for assetIdToBoxName and boxNameToAssetId.
  test('asset ID to box name zero', () => {
    // Test conversion of asset ID 0.
    const result = assetIdToBoxName(0)
    expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
    expect(result.length).toBe(constants.ASSET_METADATA_BOX_KEY_SIZE)
  })

  test('asset ID to box name small', () => {
    // Test conversion of small asset ID.
    const result = assetIdToBoxName(42)
    expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a]))
    expect(result.length).toBe(constants.ASSET_METADATA_BOX_KEY_SIZE)
  })

  test('asset ID to box name large', () => {
    // Test conversion of large asset ID.
    const assetId = 123456789012345n
    const result = assetIdToBoxName(assetId)
    expect(result.length).toBe(constants.ASSET_METADATA_BOX_KEY_SIZE)
    // Verify round-trip
    expect(boxNameToAssetId(result)).toBe(assetId)
  })

  test('asset ID to box name max uint64', () => {
    // Test conversion of maximum uint64 value.
    const maxUint64 = 2n ** 64n - 1n
    const result = assetIdToBoxName(maxUint64)
    expect(result).toEqual(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))
    expect(result.length).toBe(constants.ASSET_METADATA_BOX_KEY_SIZE)
  })

  test('asset ID to box name negative throws', () => {
    // Test that negative asset IDs raise ValueError (TS: RangeError).
    expect(() => assetIdToBoxName(-1)).toThrow(RangeError)
    expect(() => assetIdToBoxName(-1)).toThrow(/must fit in uint64/)
  })

  test('asset ID to box name overflow throws', () => {
    // Test that asset IDs larger than uint64 raise ValueError (TS: RangeError).
    expect(() => assetIdToBoxName(2n ** 64n)).toThrow(RangeError)
    expect(() => assetIdToBoxName(2n ** 64n)).toThrow(/must fit in uint64/)
  })

  test('asset ID to box name accepts number and bigint (TS-only)', () => {
    // `number` asset IDs are accepted when they are safe integers; use `bigint` beyond 2^53 - 1.
    expect(assetIdToBoxName(123456)).toEqual(assetIdToBoxName(123456n))
    expect(assetIdToBoxName(Number.MAX_SAFE_INTEGER)).toEqual(assetIdToBoxName(BigInt(Number.MAX_SAFE_INTEGER)))
    expect(() => assetIdToBoxName(1.5)).toThrow(TypeError)
    expect(() => assetIdToBoxName(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
  })

  test('box name to asset ID zero', () => {
    // Test conversion of zero box name.
    const boxName = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    const result = boxNameToAssetId(boxName)
    expect(result).toBe(0n)
  })

  test('box name to asset ID small', () => {
    // Test conversion of small box name.
    const boxName = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a])
    const result = boxNameToAssetId(boxName)
    expect(result).toBe(42n)
  })

  test('box name to asset ID large', () => {
    // Test conversion of large box name.
    const assetId = 123456789012345n
    const boxName = assetIdToBoxName(assetId)
    const result = boxNameToAssetId(boxName)
    expect(result).toBe(assetId)
  })

  test('box name to asset ID max', () => {
    // Test conversion of maximum box name.
    const boxName = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    const result = boxNameToAssetId(boxName)
    expect(result).toBe(2n ** 64n - 1n)
  })

  test('box name to asset ID invalid length throws', () => {
    // Test that box names with invalid length raise ValueError (TS: RangeError).
    expect(() => boxNameToAssetId(new Uint8Array([0x00, 0x00, 0x00]))).toThrow(RangeError)
    expect(() => boxNameToAssetId(new Uint8Array([0x00, 0x00, 0x00]))).toThrow(/must be 8 bytes/)
    expect(() => boxNameToAssetId(new Uint8Array(10).fill(0x00))).toThrow(/must be 8 bytes/)
  })

  test('roundtrip conversion', () => {
    // Test round-trip conversion for various asset IDs.
    const testIds = [0n, 1n, 42n, 1000n, 123456n, 2n ** 32n, 2n ** 48n, 2n ** 64n - 1n]
    for (const assetId of testIds) {
      const boxName = assetIdToBoxName(assetId)
      const result = boxNameToAssetId(boxName)
      expect(result).toBe(assetId)
    }
  })
})

describe('base64 encoding', () => {
  // Tests for base64 encoding/decoding functions.
  test.each([
    [0n, 'AAAAAAAAAAA'],
    [1n, 'AAAAAAAAAAE'],
    [12345n, 'AAAAAAAAMDk'],
    [2n ** 63n - 1n, 'f_________8'],
  ])('arc89 box name vectors (%s => %s)', (assetId, encoded) => {
    const boxName = assetIdToBoxName(assetId)
    expect(b64UrlEncode(boxName)).toBe(encoded)
    expect(boxNameToAssetId(b64UrlDecode(encoded))).toBe(assetId)
  })

  test('b64 encode empty', () => {
    // Test encoding empty bytes.
    const result = b64Encode(new Uint8Array())
    expect(result).toBe('')
  })

  test('b64 encode simple', () => {
    // Test encoding simple bytes.
    const result = b64Encode(new TextEncoder().encode('hello'))
    expect(result).toBe('aGVsbG8=')
  })

  test('b64 encode binary', () => {
    // Test encoding binary data.
    const result = b64Encode(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff]))
    expect(result).toBe('AAECA/8=')
  })

  test('b64 decode empty', () => {
    // Test decoding empty string.
    const result = b64Decode('')
    expect(result).toEqual(new Uint8Array())
  })

  test('b64 decode simple', () => {
    // Test decoding simple base64.
    const result = b64Decode('aGVsbG8=')
    expect(result).toEqual(new TextEncoder().encode('hello'))
  })

  test('b64 decode binary', () => {
    // Test decoding binary base64.
    const result = b64Decode('AAECA/8=')
    expect(result).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff]))
  })

  test('b64 roundtrip', () => {
    // Test round-trip base64 encoding.
    const original = new TextEncoder().encode('The quick brown fox jumps over the lazy dog')
    const encoded = b64Encode(original)
    const decoded = b64Decode(encoded)
    expect(decoded).toEqual(original)
  })

  test('b64url encode empty', () => {
    // Test URL-safe encoding of empty bytes.
    const result = b64UrlEncode(new Uint8Array())
    expect(result).toBe('')
  })

  test('b64url encode simple', () => {
    // Test URL-safe encoding (canonical: unpadded).
    const result = b64UrlEncode(new TextEncoder().encode('hello'))
    expect(result).toBe('aGVsbG8')
  })

  test('b64url encode with special chars', () => {
    // Test URL-safe encoding with characters that differ from standard base64.
    // Standard base64 uses + and /, URL-safe uses - and _
    const result = b64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))
    expect(result).toBe('-__-')
    // Standard base64 would be: +//+
  })

  test('b64url decode empty', () => {
    // Test URL-safe decoding of empty string.
    const result = b64UrlDecode('')
    expect(result).toEqual(new Uint8Array())
  })

  test('b64url decode simple', () => {
    // Test URL-safe decoding.
    const result = b64UrlDecode('aGVsbG8')
    expect(result).toEqual(new TextEncoder().encode('hello'))
  })

  test('b64url decode with special chars', () => {
    // Test URL-safe decoding with - and _.
    const result = b64UrlDecode('-__-')
    expect(result).toEqual(new Uint8Array([0xfb, 0xff, 0xfe]))
  })

  test('b64url roundtrip', () => {
    // Test round-trip URL-safe base64 encoding.
    const original = new Uint8Array([0x00, 0x01, 0x02, 0xfb, 0xff, 0xfe, 0xff])
    const encoded = b64UrlEncode(original)
    const decoded = b64UrlDecode(encoded)
    expect(decoded).toEqual(original)
  })

  test.each([
    'aGVsbG8=', // padded
    'aGVsbG9', // non-zero trailing bits (alias of 'aGVsbG8')
    '+/+/', // standard (non URL-safe) alphabet
    'aGVs bG8', // character outside the alphabet
    'a', // impossible length
  ])('b64url decode rejects non-canonical input %j (TS-only)', (encoded) => {
    // Only the canonical unpadded base64url encoding is accepted (Python raises binascii.Error).
    expect(() => b64UrlDecode(encoded)).toThrow(/base64url/)
  })
})

describe('arc90 compliance', () => {
  // Tests for Arc90Compliance parsing and serialization.
  test('parse empty fragment', () => {
    // Test parsing empty or None fragment.
    expect(Arc90Compliance.parse(null)).toEqual(new Arc90Compliance([]))
    expect(Arc90Compliance.parse('')).toEqual(new Arc90Compliance([]))
    expect(Arc90Compliance.parse('#')).toEqual(new Arc90Compliance([]))
  })

  test('parse single arc', () => {
    // Test parsing single ARC number.
    const result = Arc90Compliance.parse('#arc89')
    expect(result).toEqual(new Arc90Compliance([89]))
  })

  test('parse multiple arcs', () => {
    // Test parsing multiple ARC numbers.
    const result = Arc90Compliance.parse('#arc89+90+91')
    expect(result).toEqual(new Arc90Compliance([89, 90, 91]))
  })

  test('parse arc3 alone', () => {
    // Test parsing ARC-3 alone (valid).
    const result = Arc90Compliance.parse('#arc3')
    expect(result).toEqual(new Arc90Compliance([3]))
  })

  test('parse arc3 with others invalid', () => {
    // Test parsing ARC-3 with others (invalid per spec).
    const result1 = Arc90Compliance.parse('#arc3+89')
    expect(result1).toEqual(new Arc90Compliance([])) // invalid, returns empty

    const result2 = Arc90Compliance.parse('#arc89+3')
    expect(result2).toEqual(new Arc90Compliance([])) // invalid, returns empty
  })

  test('parse leading zeros invalid', () => {
    // Test parsing with leading zeros (invalid).
    const result1 = Arc90Compliance.parse('#arc089')
    expect(result1).toEqual(new Arc90Compliance([])) // invalid

    const result2 = Arc90Compliance.parse('#arc89+090')
    expect(result2).toEqual(new Arc90Compliance([])) // invalid
  })

  test('parse single digit zero valid', () => {
    // Test parsing single digit 0 (valid).
    const result = Arc90Compliance.parse('#arc0')
    expect(result).toEqual(new Arc90Compliance([0]))
  })

  test('parse without arc prefix invalid', () => {
    // Test parsing without 'arc' prefix (invalid).
    const result = Arc90Compliance.parse('#89')
    expect(result).toEqual(new Arc90Compliance([]))
  })

  test('parse arc without number invalid', () => {
    // Test parsing 'arc' without a number (invalid).
    const result = Arc90Compliance.parse('#arc')
    expect(result).toEqual(new Arc90Compliance([]))
  })

  test('parse non-numeric invalid', () => {
    // Test parsing with non-numeric values (invalid).
    const result1 = Arc90Compliance.parse('#arcabc')
    expect(result1).toEqual(new Arc90Compliance([]))

    const result2 = Arc90Compliance.parse('#arc89+xyz')
    expect(result2).toEqual(new Arc90Compliance([]))
  })

  test('to fragment empty', () => {
    // Test serializing empty compliance.
    const compliance = new Arc90Compliance([])
    expect(compliance.toFragment()).toBeNull()
  })

  test('to fragment single', () => {
    // Test serializing single ARC.
    const compliance = new Arc90Compliance([89])
    expect(compliance.toFragment()).toBe('#arc89')
  })

  test('to fragment multiple', () => {
    // Test serializing multiple ARCs.
    const compliance = new Arc90Compliance([89, 90, 91])
    expect(compliance.toFragment()).toBe('#arc89+90+91')
  })

  test('to fragment arc3 alone', () => {
    // Test serializing ARC-3 alone.
    const compliance = new Arc90Compliance([3])
    expect(compliance.toFragment()).toBe('#arc3')
  })

  test('to fragment arc3 with others throws', () => {
    // Test serializing ARC-3 with others raises error.
    const compliance = new Arc90Compliance([3, 89])
    expect(() => compliance.toFragment()).toThrow(/ARC-3 must be the sole entry/)
  })

  test('roundtrip single', () => {
    // Test round-trip for single ARC.
    const original = '#arc89'
    const parsed = Arc90Compliance.parse(original)
    const serialized = parsed.toFragment()
    expect(serialized).toBe(original)
  })

  test('roundtrip multiple', () => {
    // Test round-trip for multiple ARCs.
    const original = '#arc89+90+200'
    const parsed = Arc90Compliance.parse(original)
    const serialized = parsed.toFragment()
    expect(serialized).toBe(original)
  })
})

describe('arc90 uri', () => {
  // Tests for Arc90Uri parsing and serialization.
  test('parse testnet uri', () => {
    // Test parsing testnet URI.
    const uri = 'algorand://net:testnet/app/752790676?box=AAAAAAAAAAE#arc89'
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.netauth).toBe('net:testnet')
    expect(parsed.appId).toBe(752790676n)
    expect(parsed.boxName).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]))
    expect(parsed.compliance).toEqual(new Arc90Compliance([89]))
    expect(parsed.assetId).toBe(1n)
    expect(parsed.isPartial).toBe(false)
  })

  test('parse mainnet uri', () => {
    // Test parsing mainnet URI.
    const uri = 'algorand://app/123456789?box=AAAAAAAAAAE#arc89'
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.netauth).toBeNull()
    expect(parsed.appId).toBe(123456789n)
    expect(parsed.boxName).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]))
    expect(parsed.compliance).toEqual(new Arc90Compliance([89]))
    expect(parsed.assetId).toBe(1n)
    expect(parsed.isPartial).toBe(false)
  })

  test('parse localnet uri', () => {
    // Test parsing localnet URI.
    const uri = 'algorand://net:localnet/app/1001?box=AAAAAAAAAAE#arc3'
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.netauth).toBe('net:localnet')
    expect(parsed.appId).toBe(1001n)
    expect(parsed.boxName).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]))
    expect(parsed.compliance).toEqual(new Arc90Compliance([3]))
    expect(parsed.assetId).toBe(1n)
    expect(parsed.isPartial).toBe(false)
  })

  test('parse partial uri', () => {
    // Test parsing partial URI (empty box value).
    const uri = 'algorand://net:testnet/app/752790676?box=#arc89'
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.netauth).toBe('net:testnet')
    expect(parsed.appId).toBe(752790676n)
    expect(parsed.boxName).toBeNull()
    expect(parsed.compliance).toEqual(new Arc90Compliance([89]))
    expect(parsed.assetId).toBeNull()
    expect(parsed.isPartial).toBe(true)
  })

  test('parse uri without fragment', () => {
    // Test parsing URI without compliance fragment.
    const uri = 'algorand://net:testnet/app/752790676?box=AAAAAAAAAAE'
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.netauth).toBe('net:testnet')
    expect(parsed.appId).toBe(752790676n)
    expect(parsed.boxName).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]))
    expect(parsed.compliance).toEqual(new Arc90Compliance([]))
  })

  test('parse uri multiple compliance', () => {
    // Test parsing URI with multiple compliance ARCs.
    const uri = 'algorand://net:testnet/app/752790676?box=AAAAAAAAAAE#arc89+90'
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.compliance).toEqual(new Arc90Compliance([89, 90]))
  })

  test('parse invalid scheme throws', () => {
    // Test parsing non-algorand scheme raises error.
    expect(() => Arc90Uri.parse('https://example.com/app/123?box=')).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse('https://example.com/app/123?box=')).toThrow(/Not an algorand:\/\/ URI/)
  })

  test('parse missing box param throws', () => {
    // Test parsing without box parameter raises error.
    expect(() => Arc90Uri.parse('algorand://net:testnet/app/123')).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse('algorand://net:testnet/app/123')).toThrow(/Missing 'box' query parameter/)
  })

  test('parse invalid app path throws', () => {
    // Test parsing with invalid app path raises error.
    expect(() => Arc90Uri.parse('algorand://net:testnet/asset/123?box=')).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse('algorand://net:testnet/asset/123?box=')).toThrow(/Expected path '\/app\/<app_id>'/)
  })

  test('parse invalid app id throws', () => {
    // Test parsing with non-numeric app ID raises error.
    expect(() => Arc90Uri.parse('algorand://net:testnet/app/abc?box=')).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse('algorand://net:testnet/app/abc?box=')).toThrow(/Invalid app id/)
  })

  test('parse invalid app id mainnet throws', () => {
    // Test parsing mainnet URI with non-numeric app ID raises error.
    expect(() => Arc90Uri.parse('algorand://app/notanumber?box=')).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse('algorand://app/notanumber?box=')).toThrow(/Invalid app id/)
  })

  test.each(['!!!invalid!!!', 'AAAAAAAAAAE=', 'AAAAAAAAAAE%3D', 'f_________9'])(
    'parse noncanonical box name throws (%s)',
    (boxName) => {
      // Test that aliases and invalid base64url box names are rejected.
      const uri = `algorand://net:testnet/app/123?box=${boxName}`
      expect(() => Arc90Uri.parse(uri)).toThrow(InvalidArc90UriError)
      expect(() => Arc90Uri.parse(uri)).toThrow(/Invalid base64url box name/)
    },
  )

  test('parse invalid box name length throws', () => {
    // Test parsing with wrong box name length raises error.
    // 4 bytes instead of 8
    const boxB64 = b64UrlEncode(new Uint8Array([0x00, 0x00, 0x00, 0x01]))
    const uri = `algorand://net:testnet/app/123?box=${boxB64}`
    expect(() => Arc90Uri.parse(uri)).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse(uri)).toThrow(/8-byte box name/)
  })

  test('parse unrecognized shape throws', () => {
    // Test parsing with unrecognized URI shape raises error.
    expect(() => Arc90Uri.parse('algorand://unknown/something/123?box=')).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse('algorand://unknown/something/123?box=')).toThrow(/Unrecognized ARC-90 app URI shape/)
  })

  test('to uri testnet', () => {
    // Test serializing testnet URI.
    const uriObj = new Arc90Uri({
      netauth: 'net:testnet',
      appId: 752790676n,
      boxName: new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]),
      compliance: new Arc90Compliance([89]),
    })
    const result = uriObj.toUri()

    expect(result).toBe('algorand://net:testnet/app/752790676?box=AAAAAAAAAAE#arc89')
  })

  test('to uri mainnet', () => {
    // Test serializing mainnet URI.
    const uriObj = new Arc90Uri({
      netauth: null,
      appId: 123456789n,
      boxName: new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]),
      compliance: new Arc90Compliance([89]),
    })
    const result = uriObj.toUri()

    expect(result).toBe('algorand://app/123456789?box=AAAAAAAAAAE#arc89')
  })

  test('to uri partial', () => {
    // Test serializing partial URI.
    const uriObj = new Arc90Uri({
      netauth: 'net:testnet',
      appId: 752790676n,
      boxName: null,
      compliance: new Arc90Compliance([89]),
    })
    const result = uriObj.toUri()

    expect(result).toContain('algorand://net:testnet/app/752790676')
    expect(result).toContain('box=')
    expect(result).toContain('arc89')
    // Box should be empty
    expect(result.includes('box=&') || result.includes('box=#') || result.endsWith('box=')).toBe(true)
  })

  test('to uri without compliance', () => {
    // Test serializing URI without compliance fragment.
    const uriObj = new Arc90Uri({
      netauth: 'net:testnet',
      appId: 752790676n,
      boxName: new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]),
      compliance: new Arc90Compliance([]),
    })
    const result = uriObj.toUri()

    expect(result).toContain('algorand://net:testnet/app/752790676')
    expect(result).toContain('box=')
    expect(result).not.toContain('#')
  })

  test('with asset id', () => {
    // Test completing partial URI with asset ID.
    const partial = new Arc90Uri({
      netauth: 'net:testnet',
      appId: 752790676n,
      boxName: null,
      compliance: new Arc90Compliance([89]),
    })
    const completed = partial.withAssetId(42n)

    expect(completed.netauth).toBe(partial.netauth)
    expect(completed.appId).toBe(partial.appId)
    expect(completed.boxName).toEqual(assetIdToBoxName(42n))
    expect(completed.compliance).toEqual(partial.compliance)
    expect(completed.assetId).toBe(42n)
    expect(completed.isPartial).toBe(false)
  })

  test('to algod box name b64', () => {
    // Test converting to Algod box name format (standard base64).
    const uriObj = new Arc90Uri({
      netauth: 'net:testnet',
      appId: 752790676n,
      boxName: new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]),
      compliance: new Arc90Compliance([89]),
    })
    const result = uriObj.toAlgodBoxNameB64()

    // Should be standard base64 with padding
    expect(result).toBe(b64Encode(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])))
    // Verify it's different from URL-safe encoding if special chars present
    expect(b64Decode(result)).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]))
  })

  test('to algod box name b64 partial throws', () => {
    // Test that partial URI cannot produce algod box name.
    const partial = new Arc90Uri({
      netauth: 'net:testnet',
      appId: 752790676n,
      boxName: null,
      compliance: new Arc90Compliance([89]),
    })
    expect(() => partial.toAlgodBoxNameB64()).toThrow(/Cannot produce algod box name for a partial URI/)
  })

  test('roundtrip testnet', () => {
    // Test round-trip for testnet URI.
    const originalUri = 'algorand://net:testnet/app/752790676?box=AAAAAAAAAAE#arc89'
    const parsed = Arc90Uri.parse(originalUri)
    const serialized = parsed.toUri()
    const reparsed = Arc90Uri.parse(serialized)

    expect(reparsed.netauth).toBe(parsed.netauth)
    expect(reparsed.appId).toBe(parsed.appId)
    expect(reparsed.boxName).toEqual(parsed.boxName)
    expect(reparsed.compliance).toEqual(parsed.compliance)
  })

  test('roundtrip mainnet', () => {
    // Test round-trip for mainnet URI.
    const originalUri = 'algorand://app/123456789?box=AAAAAAAAAAE#arc89'
    const parsed = Arc90Uri.parse(originalUri)
    const serialized = parsed.toUri()
    const reparsed = Arc90Uri.parse(serialized)

    expect(reparsed.netauth).toBe(parsed.netauth)
    expect(reparsed.appId).toBe(parsed.appId)
    expect(reparsed.boxName).toEqual(parsed.boxName)
    expect(reparsed.compliance).toEqual(parsed.compliance)
  })
})

describe('complete partial asset url', () => {
  // Tests for completePartialAssetUrl function.
  test('complete partial url', () => {
    // Test completing a partial asset URL.
    const partialUrl = 'algorand://net:testnet/app/752790676?box=#arc89'
    const assetId = 42n

    const result = completePartialAssetUrl(partialUrl, assetId)

    // Parse to verify
    const parsed = Arc90Uri.parse(result)
    expect(parsed.assetId).toBe(assetId)
    expect(parsed.isPartial).toBe(false)
    expect(parsed.appId).toBe(752790676n)
    expect(parsed.netauth).toBe('net:testnet')
  })

  test('complete prefilled box throws', () => {
    // An Asset URL MUST have an empty box value; a pre-filled one is rejected.
    const completeUrl = 'algorand://net:testnet/app/752790676?box=AAAAAAAAAAE#arc89'
    expect(() => completePartialAssetUrl(completeUrl, 1n)).toThrow(InvalidArc90UriError)
    expect(() => completePartialAssetUrl(completeUrl, 1n)).toThrow(/empty box value/)
    expect(() => completePartialAssetUrl(completeUrl, 999n)).toThrow(InvalidArc90UriError)
    expect(() => completePartialAssetUrl(completeUrl, 999n)).toThrow(/empty box value/)
  })

  test('parse rejects extra query parameter', () => {
    expect(() => Arc90Uri.parse('algorand://app/1?box=&foo=bar')).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse('algorand://app/1?box=&foo=bar')).toThrow(/Unexpected query parameter/)
  })

  test.each(['algorand://app/01?box=', 'algorand://app/-1?box=', 'algorand://app/1_000?box='])(
    'parse rejects non canonical app id (%s)',
    (uri) => {
      expect(() => Arc90Uri.parse(uri)).toThrow(InvalidArc90UriError)
      expect(() => Arc90Uri.parse(uri)).toThrow(/Invalid app id/)
    },
  )

  test('parse rejects extra path segments', () => {
    expect(() => Arc90Uri.parse('algorand://app/1/extra?box=')).toThrow(InvalidArc90UriError)
    expect(() => Arc90Uri.parse('algorand://app/1/extra?box=')).toThrow(/Invalid app id/)
  })

  test('parse gh netauth', () => {
    const uri = 'algorand://gh:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9_cOUJOiI/app/753324084?box=AAAAAAAAMDk#arc89'
    const parsed = Arc90Uri.parse(uri)
    expect(parsed.netauth).toBe('gh:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9_cOUJOiI')
    expect(parsed.toUri()).toBe(uri)
  })

  test.each(['#arc89+-3', '#arc1_0', '#arc٣', '##arc89', '#arc90+89', '#arc89+89'])(
    'parse rejects non grammar fragments (%s)',
    (fragment) => {
      expect(Arc90Compliance.parse(fragment)).toEqual(new Arc90Compliance([]))
    },
  )

  test('to fragment sorts and dedups', () => {
    expect(new Arc90Compliance([89, 20, 20]).toFragment()).toBe('#arc20+89')
  })

  test('complete mainnet url', () => {
    // Test completing mainnet partial URL.
    const partialUrl = 'algorand://app/123456789?box=#arc89'
    const assetId = 1000n

    const result = completePartialAssetUrl(partialUrl, assetId)

    const parsed = Arc90Uri.parse(result)
    expect(parsed.assetId).toBe(assetId)
    expect(parsed.appId).toBe(123456789n)
    expect(parsed.netauth).toBeNull()
  })

  test('complete preserves compliance', () => {
    // Test that completing preserves compliance fragment.
    const partialUrl = 'algorand://net:testnet/app/752790676?box=#arc89+90'
    const assetId = 42n

    const result = completePartialAssetUrl(partialUrl, assetId)

    const parsed = Arc90Uri.parse(result)
    expect(parsed.compliance).toEqual(new Arc90Compliance([89, 90]))
  })

  test('complete without compliance', () => {
    // Test completing URL without compliance fragment.
    const partialUrl = 'algorand://net:testnet/app/752790676?box='
    const assetId = 42n

    const result = completePartialAssetUrl(partialUrl, assetId)

    const parsed = Arc90Uri.parse(result)
    expect(parsed.assetId).toBe(assetId)
    expect(parsed.compliance).toEqual(new Arc90Compliance([]))
  })

  test('complete large asset id', () => {
    // Test completing with large asset ID.
    const partialUrl = 'algorand://net:testnet/app/752790676?box=#arc89'
    const assetId = 2n ** 48n - 1n

    const result = completePartialAssetUrl(partialUrl, assetId)

    const parsed = Arc90Uri.parse(result)
    expect(parsed.assetId).toBe(assetId)
  })

  test('complete zero asset id', () => {
    // Test completing with zero asset ID.
    const partialUrl = 'algorand://net:testnet/app/752790676?box=#arc89'
    const assetId = 0n

    const result = completePartialAssetUrl(partialUrl, assetId)

    const parsed = Arc90Uri.parse(result)
    expect(parsed.assetId).toBe(assetId)
  })
})

test('parse rejects app id above uint64', () => {
  expect(() => Arc90Uri.parse(`algorand://app/${2n ** 64n}?box=AAAAAAAAAAE`)).toThrow(InvalidArc90UriError)
  expect(() => Arc90Uri.parse(`algorand://app/${2n ** 64n}?box=AAAAAAAAAAE`)).toThrow(/Invalid app id/)
  const uri = Arc90Uri.parse(`algorand://app/${2n ** 64n - 1n}?box=AAAAAAAAAAE`)
  expect(uri.appId).toBe(2n ** 64n - 1n)
})
