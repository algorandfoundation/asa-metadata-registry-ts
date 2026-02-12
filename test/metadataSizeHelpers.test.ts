/**
 * Tests demonstrating the use of metadata size helpers.
 *
 * Ported from Python `arc89/tests/test_metadata_size_fixtures.py`.
 */

import { describe, expect, test } from 'vitest'
import { AssetMetadata, constants } from '@algorandfoundation/asa-metadata-registry-sdk'
import { buildEmptyMetadata, buildShortMetadata, buildMaxedMetadata, buildOversizedMetadata } from './helpers'

const textEncoder = new TextEncoder()
const ARC_89_ASA = 42n

describe('metadata size helpers', () => {
  test('empty metadata', () => {
    const emptyMetadata = buildEmptyMetadata(ARC_89_ASA)

    expect(emptyMetadata.assetId).toBe(ARC_89_ASA)
    expect(emptyMetadata.size).toBe(0)
    expect(emptyMetadata.body.totalPages()).toBe(0)
    expect(emptyMetadata.isShort).toBe(true) // Empty is considered short
    expect(() => emptyMetadata.body.validateSize()).not.toThrow() // Should not raise

    // Empty metadata should still have valid hash (just header)
    const hash = emptyMetadata.computeMetadataHash()
    expect(hash.length).toBe(32)
    expect(hash).not.toEqual(new Uint8Array(32))
  })

  test('short metadata', () => {
    const shortMetadata = buildShortMetadata(ARC_89_ASA)

    expect(shortMetadata.assetId).toBe(ARC_89_ASA)
    expect(shortMetadata.size).toBeGreaterThan(0)
    expect(shortMetadata.size).toBeLessThanOrEqual(constants.SHORT_METADATA_SIZE)
    expect(shortMetadata.isShort).toBe(true)
    expect(() => shortMetadata.body.validateSize()).not.toThrow() // Should not raise

    // Short metadata can be operated on directly by AVM
    const jsonData = shortMetadata.body.json
    expect(jsonData).toHaveProperty('name')
    expect(jsonData['name']).toBe('Silvia')

    // Should have at least 1 page (even if small)
    expect(shortMetadata.body.totalPages()).toBeGreaterThanOrEqual(1)
  })

  test('maxed metadata', () => {
    const maxedMetadata = buildMaxedMetadata(ARC_89_ASA)

    expect(maxedMetadata.assetId).toBe(ARC_89_ASA)
    expect(maxedMetadata.size).toBe(constants.MAX_METADATA_SIZE)
    expect(maxedMetadata.isShort).toBe(false) // Too large to be short
    expect(() => maxedMetadata.body.validateSize()).not.toThrow() // Should not raise

    // Should have maximum number of pages
    const expectedPages = Math.ceil(constants.MAX_METADATA_SIZE / constants.PAGE_SIZE)
    expect(maxedMetadata.body.totalPages()).toBe(expectedPages)
    expect(maxedMetadata.body.totalPages()).toBeLessThanOrEqual(constants.MAX_PAGES)

    // Verify we can get each page
    for (let pageIdx = 0; pageIdx < maxedMetadata.body.totalPages(); pageIdx++) {
      const page = maxedMetadata.body.getPage(pageIdx)
      expect(page.length).toBeGreaterThan(0)
      // Last page might be partial
      if (pageIdx < maxedMetadata.body.totalPages() - 1) {
        expect(page.length).toBe(constants.PAGE_SIZE)
      }
    }

    // Hash computation should work even for max size
    const hashValue = maxedMetadata.computeMetadataHash()
    expect(hashValue.length).toBe(32)
    expect(hashValue).toEqual(maxedMetadata.computeMetadataHash())
  })

  test('oversized metadata', () => {
    const oversizedMetadata = buildOversizedMetadata(ARC_89_ASA)

    expect(oversizedMetadata.assetId).toBe(ARC_89_ASA)
    expect(oversizedMetadata.size).toBeGreaterThan(constants.MAX_METADATA_SIZE)
    expect(oversizedMetadata.isShort).toBe(false)

    expect(() => oversizedMetadata.body.validateSize()).toThrowError(/exceeds max/i)

    // Should still be able to compute hash (even though invalid)
    const hashValue = oversizedMetadata.computeMetadataHash()
    expect(hashValue.length).toBe(32)

    // MBR calculation should still work
    const mbrDelta = oversizedMetadata.getMbrDelta()
    expect(mbrDelta.isPositive).toBe(true) // Positive for creation
    expect(mbrDelta.amount).toBeGreaterThan(0)
  })
})

describe('size comparison', () => {
  test('size progression', () => {
    const sizes = [
      0,
      100,
      1000,
      constants.SHORT_METADATA_SIZE,
      constants.SHORT_METADATA_SIZE + 1,
      constants.MAX_METADATA_SIZE,
    ]

    for (const size of sizes) {
      const content = 'x'.repeat(size)
      const metadata = AssetMetadata.fromBytes({
        assetId: 999,
        metadataBytes: content ? textEncoder.encode(content) : new Uint8Array(),
        validateJsonObject: false, // Skip JSON validation for this test
      })

      const isShort = metadata.isShort
      const pages = metadata.body.totalPages()

      // Verify the expected invariants
      if (size <= constants.SHORT_METADATA_SIZE) {
        expect(isShort).toBe(true)
      } else {
        expect(isShort).toBe(false)
      }
      if (size === 0) {
        expect(pages).toBe(0)
      } else {
        expect(pages).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('mbr calculations for different sizes', () => {
  test('mbr increases with metadata size', () => {
    const emptyMetadata = buildEmptyMetadata(ARC_89_ASA)
    const shortMetadata = buildShortMetadata(ARC_89_ASA)
    const maxedMetadata = buildMaxedMetadata(ARC_89_ASA)

    const sizesAndMetadata: [string, AssetMetadata][] = [
      ['empty', emptyMetadata],
      ['short', shortMetadata],
      ['maxed', maxedMetadata],
    ]

    for (const [, metadata] of sizesAndMetadata) {
      const mbrDelta = metadata.getMbrDelta()

      // All should require positive MBR for creation
      expect(mbrDelta.isPositive).toBe(true)
      expect(mbrDelta.amount).toBeGreaterThan(0)
    }

    // Maxed should require the most MBR
    const emptyDelta = emptyMetadata.getMbrDelta()
    const shortDelta = shortMetadata.getMbrDelta()
    const maxedDelta = maxedMetadata.getMbrDelta()

    expect(emptyDelta.amount).toBeLessThan(shortDelta.amount)
    expect(shortDelta.amount).toBeLessThan(maxedDelta.amount)
  })
})

describe('pagination across sizes', () => {
  test('pagination behavior for different sizes', () => {
    const emptyMetadata = buildEmptyMetadata(ARC_89_ASA)
    const shortMetadata = buildShortMetadata(ARC_89_ASA)
    const maxedMetadata = buildMaxedMetadata(ARC_89_ASA)

    // Empty: no pages
    expect(emptyMetadata.body.totalPages()).toBe(0)

    // Short: should have 1 page (or maybe 2 depending on exact size)
    expect(shortMetadata.body.totalPages()).toBeGreaterThanOrEqual(1)
    if (shortMetadata.size <= constants.PAGE_SIZE) {
      expect(shortMetadata.body.totalPages()).toBe(1)
    }

    // Maxed: should have many pages
    expect(maxedMetadata.body.totalPages()).toBeGreaterThan(1)
    expect(maxedMetadata.body.totalPages()).toBeLessThanOrEqual(constants.MAX_PAGES)

    // Verify each metadata's pages
    for (const metadata of [shortMetadata, maxedMetadata]) {
      let totalContentSize = 0
      for (let pageIdx = 0; pageIdx < metadata.body.totalPages(); pageIdx++) {
        const page = metadata.body.getPage(pageIdx)
        totalContentSize += page.length

        // Each page except last should be full
        if (pageIdx < metadata.body.totalPages() - 1) {
          expect(page.length).toBe(constants.PAGE_SIZE)
        }
      }

      // Total should match metadata size
      expect(totalContentSize).toBe(metadata.size)
    }
  })
})
