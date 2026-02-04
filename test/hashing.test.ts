/**
 * Unit tests for src/hashing module.
 *
 * Tests cover:
 * - sha512_256 hash function
 * - sha256 hash function
 * - compute_header_hash
 * - paginate
 * - compute_page_hash
 * - compute_metadata_hash
 * - compute_arc3_metadata_hash
 */

import { describe, expect, test } from 'vitest'
import { hashing, assetIdToBoxName, constants } from '@algorandfoundation/asa-metadata-registry-sdk'
import { concatBytes } from '@/internal/bytes'

const {
  sha512_256,
  sha256,
  paginate,
  computeHeaderHash,
  computePageHash,
  computeMetadataHash,
  computeArc3MetadataHash,
} = hashing

const { HASH_DOMAIN_PAGE, HASH_DOMAIN_METADATA, ARC3_HASH_AM_PREFIX, ARC3_HASH_AMJ_PREFIX, HASH_DOMAIN_HEADER } =
  constants

describe('sha512/256', () => {
  // Tests for sha512_256 hash function.
  test('empty bytes', () => {
    // Test hashing empty bytes.
    const result = sha512_256(new Uint8Array())
    expect(result.length).toBe(32)
    // Known SHA-512/256 hash of empty string
    const expected = new Uint8Array(
      Buffer.from('c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a', 'hex'),
    )
    expect(result).toEqual(expected)
  })

  test('simple string', () => {
    // Test hashing simple string.
    const result = sha512_256(new TextEncoder().encode('hello world'))
    expect(result.length).toBe(32)
    // Known SHA-512/256 hash of "hello world"
    const expected = new Uint8Array(
      Buffer.from('0ac561fac838104e3f2e4ad107b4bee3e938bf15f2b15f009ccccd61a913f017', 'hex'),
    )
    expect(result).toEqual(expected)
  })

  test('deterministic', () => {
    // Test that hash is deterministic.
    const data = new TextEncoder().encode('test data')
    const result1 = sha512_256(data)
    const result2 = sha512_256(data)
    expect(result1).toEqual(result2)
  })

  test('different inputs produce different outputs', () => {
    // Test that different inputs produce different hashes.
    const result1 = sha512_256(new TextEncoder().encode('data1'))
    const result2 = sha512_256(new TextEncoder().encode('data2'))
    expect(result1).not.toEqual(result2)
  })
})

describe('sha256', () => {
  // Tests for sha256 hash function.
  test('empty bytes', () => {
    // Test hashing empty bytes.
    const result = sha256(new Uint8Array())
    expect(result.length).toBe(32)
    // Known SHA-256 hash of empty string
    const expected = new Uint8Array(
      Buffer.from('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'hex'),
    )
    expect(result).toEqual(expected)
  })

  test('simple string', () => {
    // Test hashing simple string.
    const result = sha256(new TextEncoder().encode('hello world'))
    expect(result.length).toBe(32)
    // Known SHA-256 hash of "hello world"
    const expected = new Uint8Array(
      Buffer.from('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9', 'hex'),
    )
    expect(result).toEqual(expected)
  })

  test('deterministic', () => {
    // Test that hash is deterministic.
    const data = new TextEncoder().encode('test data')
    const result1 = sha256(data)
    const result2 = sha256(data)
    expect(result1).toEqual(result2)
  })

  test('different inputs produce different outputs', () => {
    // Test that different inputs produce different hashes.
    const result1 = sha256(new TextEncoder().encode('data1'))
    const result2 = sha256(new TextEncoder().encode('data2'))
    expect(result1).not.toEqual(result2)
  })
})

describe('compute header hash', () => {
  // Tests for computeHeaderHash function.
  test('basic header hash', () => {
    // Test computing header hash with basic parameters.
    const result = computeHeaderHash({
      assetId: 12345,
      metadataIdentifiers: 0b10101010,
      reversibleFlags: 0b11001100,
      irreversibleFlags: 0b00110011,
      metadataSize: 1024,
    })
    expect(result.length).toBe(32)
  })

  test('zero values', () => {
    // Test header hash with all zero values.
    const result = computeHeaderHash({
      assetId: 0,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadataSize: 0,
    })
    expect(result.length).toBe(32)
  })

  test('max values', () => {
    // Test header hash with maximum values.
    const result = computeHeaderHash({
      assetId: 2n ** 64n - 1n,
      metadataIdentifiers: 255,
      reversibleFlags: 255,
      irreversibleFlags: 255,
      metadataSize: 65535,
    })
    expect(result.length).toBe(32)
  })

  test('deterministic', () => {
    const params = {
      assetId: 99999,
      metadataIdentifiers: 42,
      reversibleFlags: 128,
      irreversibleFlags: 64,
      metadataSize: 512,
    }
    const result1 = computeHeaderHash(params)
    const result2 = computeHeaderHash(params)
    expect(result1).toEqual(result2)
  })

  test('different asset id produces different hash', () => {
    // Test that different asset IDs produce different hashes.
    const result1 = computeHeaderHash({
      assetId: 1,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadataSize: 100,
    })
    const result2 = computeHeaderHash({
      assetId: 2,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadataSize: 100,
    })
    expect(result1).not.toEqual(result2)
  })

  test('different identifiers produce different hash', () => {
    // Test that different metadata identifiers produce different hashes.
    const result1 = computeHeaderHash({
      assetId: 100,
      metadataIdentifiers: 1,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadataSize: 100,
    })
    const result2 = computeHeaderHash({
      assetId: 100,
      metadataIdentifiers: 2,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadataSize: 100,
    })
    expect(result1).not.toEqual(result2)
  })

  test('different reversible flags produce different hash', () => {
    // Test that different reversible flags produce different hashes.
    const result1 = computeHeaderHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 1,
      irreversibleFlags: 0,
      metadataSize: 100,
    })
    const result2 = computeHeaderHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 2,
      irreversibleFlags: 0,
      metadataSize: 100,
    })
    expect(result1).not.toEqual(result2)
  })

  test('different irreversible flags produce different hash', () => {
    // Test that different irreversible flags produce different hashes.
    const result1 = computeHeaderHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 1,
      metadataSize: 100,
    })
    const result2 = computeHeaderHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 2,
      metadataSize: 100,
    })
    expect(result1).not.toEqual(result2)
  })

  test('different metadata size produces different hash', () => {
    // Test that different metadata sizes produce different hashes.
    const result1 = computeHeaderHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadataSize: 100,
    })
    const result2 = computeHeaderHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadataSize: 200,
    })
    expect(result1).not.toEqual(result2)
  })

  test('metadata identifiers out of range negative throws', () => {
    // Test that negative metadata_identifiers raises ValueError.
    expect(() =>
      computeHeaderHash({
        assetId: 100,
        metadataIdentifiers: -1,
        reversibleFlags: 0,
        irreversibleFlags: 0,
        metadataSize: 100,
      }),
    ).toThrow(/metadata_identifiers must fit in byte/)
  })

  test('metadata identifiers out of range overflow throws', () => {
    // Test that metadata_identifiers > 255 raises ValueError.
    expect(() =>
      computeHeaderHash({
        assetId: 100,
        metadataIdentifiers: 256,
        reversibleFlags: 0,
        irreversibleFlags: 0,
        metadataSize: 100,
      }),
    ).toThrow(/metadata_identifiers must fit in byte/)
  })

  test('reversible flags out of range negative throws', () => {
    // Test that negative reversible_flags raises ValueError.
    expect(() =>
      computeHeaderHash({
        assetId: 100,
        metadataIdentifiers: 0,
        reversibleFlags: -1,
        irreversibleFlags: 0,
        metadataSize: 100,
      }),
    ).toThrow(/reversible_flags must fit in byte/)
  })

  test('reversible flags out of range overflow throws', () => {
    // Test that reversible_flags > 255 raises ValueError.
    expect(() =>
      computeHeaderHash({
        assetId: 100,
        metadataIdentifiers: 0,
        reversibleFlags: 256,
        irreversibleFlags: 0,
        metadataSize: 100,
      }),
    ).toThrow(/reversible_flags must fit in byte/)
  })

  test('irreversible flags out of range negative throws', () => {
    // Test that negative irreversible_flags raises ValueError.
    expect(() =>
      computeHeaderHash({
        assetId: 100,
        metadataIdentifiers: 0,
        reversibleFlags: 0,
        irreversibleFlags: -1,
        metadataSize: 100,
      }),
    ).toThrow(/irreversible_flags must fit in byte/)
  })

  test('irreversible flags out of range overflow throws', () => {
    // Test that irreversible_flags > 255 raises ValueError.
    expect(() =>
      computeHeaderHash({
        assetId: 100,
        metadataIdentifiers: 0,
        reversibleFlags: 0,
        irreversibleFlags: 256,
        metadataSize: 100,
      }),
    ).toThrow(/irreversible_flags must fit in byte/)
  })

  test('metadata size out of range negative throws', () => {
    // Test that negative metadata_size raises ValueError.
    expect(() =>
      computeHeaderHash({
        assetId: 100,
        metadataIdentifiers: 0,
        reversibleFlags: 0,
        irreversibleFlags: 0,
        metadataSize: -1,
      }),
    ).toThrow(/metadata_size must fit in uint16/)
  })

  test('metadata size out of range overflow throws', () => {
    // Test that metadata_size > 65535 raises ValueError.
    expect(() =>
      computeHeaderHash({
        assetId: 100,
        metadataIdentifiers: 0,
        reversibleFlags: 0,
        irreversibleFlags: 0,
        metadataSize: 65536,
      }),
    ).toThrow(/metadata_size must fit in uint16/)
  })

  test('header hash uses correct domain separator', () => {
    // Test that header hash uses correct domain separator.
    // The hash should include the domain separator const.HASH_DOMAIN_HEADER
    // We can verify by manually constructing the expected input
    const assetId = 12345
    const metadataIdentifiers = 10
    const reversibleFlags = 20
    const irreversibleFlags = 30
    const metadataSize = 500

    const expectedData = concatBytes([
      HASH_DOMAIN_HEADER,
      assetIdToBoxName(assetId),
      new Uint8Array([metadataIdentifiers]),
      new Uint8Array([reversibleFlags]),
      new Uint8Array([irreversibleFlags]),
      new Uint8Array([(metadataSize >> 8) & 0xff, metadataSize & 0xff]),
    ])
    const expectedHash = sha512_256(expectedData)

    const result = computeHeaderHash({
      assetId,
      metadataIdentifiers,
      reversibleFlags,
      irreversibleFlags,
      metadataSize,
    })
    expect(result).toEqual(expectedHash)
  })
})

describe('paginate', () => {
  // Tests for paginate function.
  test('empty metadata', () => {
    // Test paginating empty metadata.
    const result = paginate(new Uint8Array(), 100)
    expect(result).toEqual([])
  })

  test('single page exact', () => {
    // Test metadata that fits exactly in one page.
    const metadata = new Uint8Array(100).fill(120)
    const result = paginate(metadata, 100)
    expect(result.length).toBe(1)
    expect(result[0]).toEqual(metadata)
  })

  test('single page partial', () => {
    // Test metadata smaller than one page.
    const metadata = new TextEncoder().encode('hello')
    const result = paginate(metadata, 100)
    expect(result.length).toBe(1)
    expect(result[0]).toEqual(metadata)
  })

  test('multiple pages exact', () => {
    // Test metadata that fits exactly in multiple pages.
    const metadata = new Uint8Array(300).fill(120)
    const result = paginate(metadata, 100)
    expect(result.length).toBe(3)
    expect(result.every((page) => page.length === 100)).toBe(true)
    expect(concatBytes(result)).toEqual(metadata)
  })

  test('multiple pages partial last', () => {
    // Test metadata with partial last page.
    const metadata = new Uint8Array(250).fill(120)
    const result = paginate(metadata, 100)
    expect(result.length).toBe(3)
    expect(result[0].length).toBe(100)
    expect(result[1].length).toBe(100)
    expect(result[2].length).toBe(50)
    expect(concatBytes(result)).toEqual(metadata)
  })

  test('page size one', () => {
    // Test paginating with page size of 1.
    const metadata = new TextEncoder().encode('hello')
    const result = paginate(metadata, 1)
    expect(result.length).toBe(5)
    expect(result.every((page) => page.length === 1)).toBe(true)
    expect(concatBytes(result)).toEqual(metadata)
  })

  test('page size larger than metadata', () => {
    // Test page size larger than metadata.
    const metadata = new TextEncoder().encode('hello')
    const result = paginate(metadata, 1000)
    expect(result.length).toBe(1)
    expect(result[0]).toEqual(metadata)
  })

  test('page size zero throws', () => {
    // Test that page_size of 0 raises ValueError.
    expect(() => paginate(new Uint8Array(10), 0)).toThrow(/page_size must be > 0/)
  })

  test('page size negative throws', () => {
    // Test that negative page_size raises ValueError.
    expect(() => paginate(new Uint8Array(10), -1)).toThrow(/page_size must be > 0/)
  })

  test('preserves metadata content', () => {
    // Test that pagination preserves metadata content.
    const metadata = new TextEncoder().encode('The quick brown fox jumps over the lazy dog')
    const result = paginate(metadata, 10)
    expect(concatBytes(result)).toEqual(metadata)
  })

  test('large metadata', () => {
    // Test paginating large metadata.
    const metadata = new Uint8Array(10000).fill(65)
    const result = paginate(metadata, 1024)
    expect(result.length).toBe(10) // 10000 / 1024 = 9.765... -> 10 pages
    expect(concatBytes(result)).toEqual(metadata)
  })
})

describe('compute page hash', () => {
  // Tests for computePageHash function.
  test('basic page hash', () => {
    // Test computing page hash with basic parameters.
    const result = computePageHash({
      assetId: 12345,
      pageIndex: 0,
      pageContent: new TextEncoder().encode('hello world'),
    })
    expect(result.length).toBe(32)
  })

  test('empty page', () => {
    // Test page hash with empty content.
    const result = computePageHash({
      assetId: 100,
      pageIndex: 0,
      pageContent: new Uint8Array(),
    })
    expect(result.length).toBe(32)
  })

  test('max page size', () => {
    // Test page hash with maximum page size (uint16 max).
    const result = computePageHash({
      assetId: 100,
      pageIndex: 0,
      pageContent: new Uint8Array(2 ** 16 - 1).fill(120),
    })
    expect(result.length).toBe(32)
  })

  test('deterministic', () => {
    // Test that page hash is deterministic.
    const params = {
      assetId: 99999,
      pageIndex: 5,
      pageContent: new TextEncoder().encode('test page content'),
    }
    const result1 = computePageHash(params)
    const result2 = computePageHash(params)
    expect(result1).toEqual(result2)
  })

  test('different asset id produces different hash', () => {
    // Test that different asset IDs produce different hashes.
    const result1 = computePageHash({
      assetId: 1,
      pageIndex: 0,
      pageContent: new TextEncoder().encode('content'),
    })
    const result2 = computePageHash({
      assetId: 2,
      pageIndex: 0,
      pageContent: new TextEncoder().encode('content'),
    })
    expect(result1).not.toEqual(result2)
  })

  test('different page index produces different hash', () => {
    // Test that different page indices produce different hashes.
    const result1 = computePageHash({
      assetId: 100,
      pageIndex: 0,
      pageContent: new TextEncoder().encode('content'),
    })
    const result2 = computePageHash({
      assetId: 100,
      pageIndex: 1,
      pageContent: new TextEncoder().encode('content'),
    })
    expect(result1).not.toEqual(result2)
  })

  test('different page content produces different hash', () => {
    // Test that different page content produces different hashes.
    const result1 = computePageHash({
      assetId: 100,
      pageIndex: 0,
      pageContent: new TextEncoder().encode('content1'),
    })
    const result2 = computePageHash({
      assetId: 100,
      pageIndex: 0,
      pageContent: new TextEncoder().encode('content2'),
    })
    expect(result1).not.toEqual(result2)
  })

  test('page index max', () => {
    // Test page hash with maximum page index (255).
    const result = computePageHash({
      assetId: 100,
      pageIndex: 255,
      pageContent: new TextEncoder().encode('test'),
    })
    expect(result.length).toBe(32)
  })

  test('page index out of range negative throws', () => {
    // Test that negative page_index raises ValueError.
    expect(() =>
      computePageHash({
        assetId: 100,
        pageIndex: -1,
        pageContent: new TextEncoder().encode('test'),
      }),
    ).toThrow(/page_index must fit in uint8/)
  })

  test('page index out of range overflow throws', () => {
    // Test that page_index > 255 raises ValueError.
    expect(() =>
      computePageHash({
        assetId: 100,
        pageIndex: 256,
        pageContent: new TextEncoder().encode('test'),
      }),
    ).toThrow(/page_index must fit in uint8/)
  })

  test('page content too large throws', () => {
    // Test that page_content larger than uint16 max raises ValueError.
    expect(() =>
      computePageHash({
        assetId: 100,
        pageIndex: 0,
        pageContent: new Uint8Array(2 ** 16).fill(120),
      }),
    ).toThrow(/page_content length must fit in uint16/)
  })

  test('page hash uses correct domain separator', () => {
    // Test that page hash uses correct domain separator.
    const assetId = 12345
    const pageIndex = 3
    const pageContent = new TextEncoder().encode('test page')

    const expectedData = concatBytes([
      HASH_DOMAIN_PAGE,
      assetIdToBoxName(assetId),
      new Uint8Array([pageIndex]),
      new Uint8Array([(pageContent.length >> 8) & 0xff, pageContent.length & 0xff]),
      pageContent,
    ])
    const expectedHash = sha512_256(expectedData)

    const result = computePageHash({
      assetId,
      pageIndex,
      pageContent,
    })
    expect(result).toEqual(expectedHash)
  })
})

describe('compute metadata hash', () => {
  // Tests for computeMetadataHash function.
  test('empty metadata', () => {
    // Test metadata hash with empty metadata.
    const result = computeMetadataHash({
      assetId: 12345,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata: new Uint8Array(),
      pageSize: 1024,
    })
    expect(result.length).toBe(32)
  })

  test('single page metadata', () => {
    // Test metadata hash with single page of metadata.
    const result = computeMetadataHash({
      assetId: 12345,
      metadataIdentifiers: 1,
      reversibleFlags: 2,
      irreversibleFlags: 3,
      metadata: new TextEncoder().encode('hello world'),
      pageSize: 1024,
    })
    expect(result.length).toBe(32)
  })

  test('multiple pages metadata', () => {
    // Test metadata hash with multiple pages.
    const metadata = new Uint8Array(3000).fill(120)
    const result = computeMetadataHash({
      assetId: 12345,
      metadataIdentifiers: 1,
      reversibleFlags: 2,
      irreversibleFlags: 3,
      metadata,
      pageSize: 1024,
    })
    expect(result.length).toBe(32)
  })

  test('deterministic', () => {
    // Test that metadata hash is deterministic.
    const params = {
      assetId: 99999,
      metadataIdentifiers: 5,
      reversibleFlags: 10,
      irreversibleFlags: 15,
      metadata: new TextEncoder().encode('test metadata content'),
      pageSize: 1024,
    }
    const result1 = computeMetadataHash(params)
    const result2 = computeMetadataHash(params)
    expect(result1).toEqual(result2)
  })

  test('different metadata produces different hash', () => {
    // Test that different metadata produces different hashes.
    const result1 = computeMetadataHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata: new TextEncoder().encode('metadata1'),
      pageSize: 1024,
    })
    const result2 = computeMetadataHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata: new TextEncoder().encode('metadata2'),
      pageSize: 1024,
    })
    expect(result1).not.toEqual(result2)
  })

  test('different page size produces different hash', () => {
    // Test that different page sizes produce different hashes.
    const metadata = new Uint8Array(2000).fill(120)
    const result1 = computeMetadataHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata,
      pageSize: 512,
    })
    const result2 = computeMetadataHash({
      assetId: 100,
      metadataIdentifiers: 0,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata,
      pageSize: 1024,
    })
    expect(result1).not.toEqual(result2)
  })

  test('metadata hash includes header hash', () => {
    // Test that metadata hash incorporates header hash.
    const assetId = 12345
    const metadataIdentifiers = 5
    const reversibleFlags = 10
    const irreversibleFlags = 15
    const metadata = new TextEncoder().encode('test')
    const pageSize = 1024

    // Compute expected hash manually
    const hh = computeHeaderHash({
      assetId,
      metadataIdentifiers,
      reversibleFlags,
      irreversibleFlags,
      metadataSize: metadata.length,
    })
    const pages = paginate(metadata, pageSize)

    const pageHashes = pages.map((pageContent, i) =>
      computePageHash({
        assetId,
        pageIndex: i,
        pageContent,
      }),
    )
    const data = concatBytes([HASH_DOMAIN_METADATA, hh, ...pageHashes])
    const expected = sha512_256(data)

    const result = computeMetadataHash({
      assetId,
      metadataIdentifiers,
      reversibleFlags,
      irreversibleFlags,
      metadata,
      pageSize,
    })
    expect(result).toEqual(expected)
  })

  test('empty metadata only includes header hash', () => {
    // Test that empty metadata hash only includes header hash.
    const assetId = 12345
    const metadataIdentifiers = 5
    const reversibleFlags = 10
    const irreversibleFlags = 15

    const hh = computeHeaderHash({
      assetId,
      metadataIdentifiers,
      reversibleFlags,
      irreversibleFlags,
      metadataSize: 0,
    })
    const expected = sha512_256(concatBytes([HASH_DOMAIN_METADATA, hh]))

    const result = computeMetadataHash({
      assetId,
      metadataIdentifiers,
      reversibleFlags,
      irreversibleFlags,
      metadata: new Uint8Array(),
      pageSize: 1024,
    })
    expect(result).toEqual(expected)
  })

  test('different header params produce different hash', () => {
    // Test that different header parameters affect the hash.
    const metadata = new TextEncoder().encode('same content')

    const result1 = computeMetadataHash({
      assetId: 100,
      metadataIdentifiers: 1,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata,
      pageSize: 1024,
    })
    const result2 = computeMetadataHash({
      assetId: 100,
      metadataIdentifiers: 2,
      reversibleFlags: 0,
      irreversibleFlags: 0,
      metadata,
      pageSize: 1024,
    })
    expect(result1).not.toEqual(result2)
  })
})

describe('compute arc3 metadata hash', () => {
  // Tests for compute_arc3_metadata_hash function.
  test('simple json no extra metadata', () => {
    // Test ARC-3 hash with simple JSON without extra_metadata.
    const jsonObj = { name: 'Test Asset', description: 'A test asset' }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj))

    const result = computeArc3MetadataHash(jsonBytes)
    expect(result.length).toBe(32)

    // Without extra_metadata, should use SHA-256
    const expected = sha256(jsonBytes)
    expect(result).toEqual(expected)
  })

  test('json with extra metadata', () => {
    // Test ARC-3 hash with extra_metadata field.
    const extraData = new TextEncoder().encode('extra binary data')
    const extraB64 = Buffer.from(extraData).toString('base64')

    const jsonObj = {
      name: 'Test Asset',
      description: 'A test asset',
      extra_metadata: extraB64,
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj))

    const result = computeArc3MetadataHash(jsonBytes)
    expect(result.length).toBe(32)

    // With extra_metadata, should use SHA-512/256 double hash
    const jsonH = sha512_256(concatBytes([ARC3_HASH_AMJ_PREFIX, jsonBytes]))
    const expected = sha512_256(concatBytes([ARC3_HASH_AM_PREFIX, jsonH, extraData]))
    expect(result).toEqual(expected)
  })

  test('json with empty extra metadata', () => {
    // Test ARC-3 hash with empty extra_metadata.
    const extraB64 = Buffer.from(new Uint8Array()).toString('base64')

    const jsonObj = {
      name: 'Test Asset',
      extra_metadata: extraB64,
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj))

    const result = computeArc3MetadataHash(jsonBytes)
    expect(result.length).toBe(32)

    // Should still use double hash
    const jsonH = sha512_256(concatBytes([ARC3_HASH_AMJ_PREFIX, jsonBytes]))
    const expected = sha512_256(concatBytes([ARC3_HASH_AM_PREFIX, jsonH, new Uint8Array()]))
    expect(result).toEqual(expected)
  })

  test('deterministic', () => {
    // Test that ARC-3 hash is deterministic.
    const jsonObj = { name: 'Test', description: 'Test' }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj))

    const result1 = computeArc3MetadataHash(jsonBytes)
    const result2 = computeArc3MetadataHash(jsonBytes)
    expect(result1).toEqual(result2)
  })

  test('different json produces different hash', () => {
    // Test that different JSON produces different hashes.
    const json1 = new TextEncoder().encode(JSON.stringify({ name: 'Asset1' }))
    const json2 = new TextEncoder().encode(JSON.stringify({ name: 'Asset2' }))

    const result1 = computeArc3MetadataHash(json1)
    const result2 = computeArc3MetadataHash(json2)
    expect(result1).not.toEqual(result2)
  })

  test('json array no extra metadata', () => {
    // Test ARC-3 hash with JSON array (no extra_metadata key).
    const jsonBytes = new TextEncoder().encode(JSON.stringify([1, 2, 3]))

    const result = computeArc3MetadataHash(jsonBytes)
    expect(result.length).toBe(32)

    // JSON array has no extra_metadata, should use SHA-256
    const expected = sha256(jsonBytes)
    expect(result).toEqual(expected)
  })

  test('json string no extra metadata', () => {
    // Test ARC-3 hash with JSON string (no extra_metadata key).
    const jsonBytes = new TextEncoder().encode(JSON.stringify('hello world'))

    const result = computeArc3MetadataHash(jsonBytes)
    expect(result.length).toBe(32)

    // JSON string has no extra_metadata, should use SHA-256
    const expected = sha256(jsonBytes)
    expect(result).toEqual(expected)
  })

  test('json number no extra metadata', () => {
    // Test ARC-3 hash with JSON number (no extra_metadata key).
    const jsonBytes = new TextEncoder().encode(JSON.stringify(42))

    const result = computeArc3MetadataHash(jsonBytes)
    expect(result.length).toBe(32)

    // JSON number has no extra_metadata, should use SHA-256
    const expected = sha256(jsonBytes)
    expect(result).toEqual(expected)
  })

  test('invalid utf-8 throws', () => {
    // Test that invalid UTF-8 raises ValueError.
    const invalidBytes = new Uint8Array([0xff, 0xfe])

    expect(() => computeArc3MetadataHash(invalidBytes)).toThrow(/Metadata file must be UTF-8 encoded JSON/)
  })

  test('invalid json throws', () => {
    // Test that invalid JSON raises ValueError.
    const invalidJson = new TextEncoder().encode('{invalid json')

    expect(() => computeArc3MetadataHash(invalidJson)).toThrow(/Invalid JSON metadata file/)
  })

  test('extra metadata not string throws', () => {
    // Test that non-string extra_metadata raises ValueError.
    const jsonObj = {
      name: 'Test',
      extra_metadata: 123, // Not a string
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj))

    expect(() => computeArc3MetadataHash(jsonBytes)).toThrow(/"extra_metadata" must be a base64 string when present/)
  })

  test('extra metadata invalid base64 throws', () => {
    // Test that invalid base64 extra_metadata raises ValueError.
    const jsonObj = {
      name: 'Test',
      extra_metadata: 'not valid base64!!!',
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj))

    expect(() => computeArc3MetadataHash(jsonBytes)).toThrow(/Could not base64-decode "extra_metadata"/)
  })

  test('complex json with extra metadata', () => {
    // Test ARC-3 hash with complex JSON structure and extra_metadata.
    const extraData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])
    const extraB64 = Buffer.from(extraData).toString('base64')

    const jsonObj = {
      name: 'Complex Asset',
      description: 'A complex test asset',
      decimals: 6,
      properties: {
        color: 'blue',
        size: 'large',
      },
      tags: ['tag1', 'tag2', 'tag3'],
      extra_metadata: extraB64,
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj))

    const result = computeArc3MetadataHash(jsonBytes)
    expect(result.length).toBe(32)

    // Verify correct computation
    const jsonH = sha512_256(concatBytes([ARC3_HASH_AMJ_PREFIX, jsonBytes]))
    const expected = sha512_256(concatBytes([ARC3_HASH_AM_PREFIX, jsonH, extraData]))
    expect(result).toEqual(expected)
  })

  test('extra metadata with special chars', () => {
    // Test ARC-3 hash with extra_metadata containing special characters.
    const extraData = new Uint8Array([
      0x53, 0x70, 0x65, 0x63, 0x69, 0x61, 0x6c, 0x20, 0x00, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x20, 0xff, 0xfe,
    ])
    const extraB64 = Buffer.from(extraData).toString('base64')

    const jsonObj = {
      name: 'Test',
      extra_metadata: extraB64,
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj))

    const result = computeArc3MetadataHash(jsonBytes)
    expect(result.length).toBe(32)

    // Verify correct computation
    const jsonH = sha512_256(concatBytes([ARC3_HASH_AMJ_PREFIX, jsonBytes]))
    const expected = sha512_256(concatBytes([ARC3_HASH_AM_PREFIX, jsonH, extraData]))
    expect(result).toEqual(expected)
  })

  test('whitespace in json affects hash', () => {
    // Test that whitespace in JSON affects hash (as expected).
    const json1 = new TextEncoder().encode(JSON.stringify({ name: 'Test' }))
    const json2 = new TextEncoder().encode(JSON.stringify({ name: 'Test' }, null, 2))

    // Different whitespace should produce different hashes
    const result1 = computeArc3MetadataHash(json1)
    const result2 = computeArc3MetadataHash(json2)
    expect(result1).not.toEqual(result2)
  })

  test('extra metadata field ordering affects hash', () => {
    // Test that field ordering in JSON affects hash (as expected).
    const extraB64 = Buffer.from(new TextEncoder().encode('test')).toString('base64')

    const json1 = new TextEncoder().encode(JSON.stringify({ name: 'Test', extra_metadata: extraB64 }))
    const json2 = new TextEncoder().encode(JSON.stringify({ extra_metadata: extraB64, name: 'Test' }))

    const result1 = computeArc3MetadataHash(json1)
    const result2 = computeArc3MetadataHash(json2)
    // Different ordering should produce different hashes
    expect(result1).not.toEqual(result2)
  })
})
