/**
 * Unit tests for helper models in src/models.
 *
 * Tests cover:
 * - MbrDelta and MbrDeltaSign
 * - RegistryParameters
 * - MetadataExistence
 * - Pagination
 * - PaginatedMetadata
 */

import { describe, expect, test } from 'vitest'
import { models, enums, constants } from '@algorandfoundation/asa-metadata-registry-sdk'
import { toBytes } from '@/internal/bytes'

const {
  MbrDeltaSign,
  MbrDelta,
  RegistryParameters,
  MetadataExistence,
  Pagination,
  PaginatedMetadata,
  setBit,
  isNonzero32,
} = models

describe('mbr delta sign', () => {
  // Tests for MbrDeltaSign enum.
  test('values', () => {
    // Test enum values match expected constants.
    expect(MbrDeltaSign.NULL).toBe(enums.MBR_DELTA_NULL)
    expect(MbrDeltaSign.POS).toBe(enums.MBR_DELTA_POS)
    expect(MbrDeltaSign.NEG).toBe(enums.MBR_DELTA_NEG)
  })

  test('int values', () => {
    // Test actual integer values.
    expect(MbrDeltaSign.NULL).toBe(0)
    expect(MbrDeltaSign.POS).toBe(1)
    expect(MbrDeltaSign.NEG).toBe(255)
  })
})

describe('mbr delta', () => {
  // Tests for MbrDelta class.
  test('zero delta null sign', () => {
    // Test zero delta with NULL sign.
    const delta = new MbrDelta({ sign: MbrDeltaSign.NULL, amount: 0 })
    expect(delta.isZero).toBe(true)
    expect(delta.isPositive).toBe(false)
    expect(delta.isNegative).toBe(false)
    expect(delta.signedAmount).toBe(0)
  })

  test('zero delta with amount', () => {
    // Test NULL sign with non-zero amount is treated as zero.
    const delta = new MbrDelta({ sign: MbrDeltaSign.NULL, amount: 100 })
    expect(delta.isZero).toBe(true)
    expect(delta.isPositive).toBe(false)
    expect(delta.isNegative).toBe(false)
    expect(delta.signedAmount).toBe(0)
  })

  test('positive delta', () => {
    // Test positive delta.
    const delta = new MbrDelta({ sign: MbrDeltaSign.POS, amount: 5000 })
    expect(delta.isPositive).toBe(true)
    expect(delta.isNegative).toBe(false)
    expect(delta.isZero).toBe(false)
    expect(delta.signedAmount).toBe(5000)
  })

  test('positive delta zero amount', () => {
    // Test positive sign with zero amount.
    const delta = new MbrDelta({ sign: MbrDeltaSign.POS, amount: 0 })
    expect(delta.isPositive).toBe(false)
    expect(delta.isNegative).toBe(false)
    expect(delta.isZero).toBe(true)
    expect(delta.signedAmount).toBe(0)
  })

  test('negative delta', () => {
    // Test negative delta.
    const delta = new MbrDelta({ sign: MbrDeltaSign.NEG, amount: 3000 })
    expect(delta.isNegative).toBe(true)
    expect(delta.isPositive).toBe(false)
    expect(delta.isZero).toBe(false)
    expect(delta.signedAmount).toBe(-3000)
  })

  test('negative delta zero amount', () => {
    // Test negative sign with zero amount.
    const delta = new MbrDelta({ sign: MbrDeltaSign.NEG, amount: 0 })
    expect(delta.isNegative).toBe(false)
    expect(delta.isPositive).toBe(false)
    expect(delta.isZero).toBe(true)
    expect(delta.signedAmount).toBe(0)
  })

  test('from tuple null', () => {
    // Test fromTuple with NULL sign.
    const delta = MbrDelta.fromTuple([enums.MBR_DELTA_NULL, 0])
    expect(delta.sign).toBe(MbrDeltaSign.NULL)
    expect(delta.amount).toBe(0)
    expect(delta.isZero).toBe(true)
  })

  test('from tuple positive', () => {
    // Test fromTuple with positive delta.
    const delta = MbrDelta.fromTuple([enums.MBR_DELTA_POS, 1000])
    expect(delta.sign).toBe(MbrDeltaSign.POS)
    expect(delta.amount).toBe(1000)
    expect(delta.isPositive).toBe(true)
  })

  test('from tuple negative', () => {
    // Test fromTuple with negative delta.
    const delta = MbrDelta.fromTuple([enums.MBR_DELTA_NEG, 2000])
    expect(delta.sign).toBe(MbrDeltaSign.NEG)
    expect(delta.amount).toBe(2000)
    expect(delta.isNegative).toBe(true)
  })

  test('from tuple invalid length', () => {
    // Test fromTuple with wrong number of elements.
    expect(() => MbrDelta.fromTuple([1])).toThrow(/Expected \(sign, amount\)/)
    expect(() => MbrDelta.fromTuple([1, 2, 3])).toThrow(/Expected \(sign, amount\)/)
  })

  test('from tuple invalid sign', () => {
    // Test fromTuple with invalid sign value.
    expect(() => MbrDelta.fromTuple([99, 1000])).toThrow(/Invalid MBR delta sign/)
  })

  test('from tuple negative amount', () => {
    // Test fromTuple with negative amount.
    expect(() => MbrDelta.fromTuple([enums.MBR_DELTA_POS, -100])).toThrow(/must be non-negative/)
  })
})

describe('registry parameters', () => {
  // Tests for RegistryParameters class.
  test('defaults', () => {
    // Test default registry parameters match constants.
    const params = RegistryParameters.defaults()
    expect(params.keySize).toBe(constants.ASSET_METADATA_BOX_KEY_SIZE)
    expect(params.headerSize).toBe(constants.HEADER_SIZE)
    expect(params.maxMetadataSize).toBe(constants.MAX_METADATA_SIZE)
    expect(params.shortMetadataSize).toBe(constants.SHORT_METADATA_SIZE)
    expect(params.pageSize).toBe(constants.PAGE_SIZE)
    expect(params.firstPayloadMaxSize).toBe(constants.FIRST_PAYLOAD_MAX_SIZE)
    expect(params.extraPayloadMaxSize).toBe(constants.EXTRA_PAYLOAD_MAX_SIZE)
    expect(params.replacePayloadMaxSize).toBe(constants.REPLACE_PAYLOAD_MAX_SIZE)
    expect(params.flatMbr).toBe(constants.FLAT_MBR)
    expect(params.byteMbr).toBe(constants.BYTE_MBR)
  })

  test('from tuple', () => {
    // Test fromTuple parsing.
    const values = [8, 50, 30000, 4000, 1000, 2000, 1900, 1950, 2500, 400]
    const params = RegistryParameters.fromTuple(values)
    expect(params.keySize).toBe(8)
    expect(params.headerSize).toBe(50)
    expect(params.maxMetadataSize).toBe(30000)
    expect(params.shortMetadataSize).toBe(4000)
    expect(params.pageSize).toBe(1000)
    expect(params.firstPayloadMaxSize).toBe(2000)
    expect(params.extraPayloadMaxSize).toBe(1900)
    expect(params.replacePayloadMaxSize).toBe(1950)
    expect(params.flatMbr).toBe(2500)
    expect(params.byteMbr).toBe(400)
  })

  test('from tuple invalid length', () => {
    // Test fromTuple with wrong number of elements.
    expect(() => RegistryParameters.fromTuple([1, 2, 3])).toThrow(/Expected 10-tuple/)
  })

  test('mbr for box zero metadata', () => {
    // Test MBR calculation for box with zero metadata.
    const params = RegistryParameters.defaults()
    const mbr = params.mbrForBox(0)
    const expected =
      constants.FLAT_MBR + constants.BYTE_MBR * (constants.ASSET_METADATA_BOX_KEY_SIZE + constants.HEADER_SIZE + 0)
    expect(mbr).toBe(expected)
  })

  test('mbr for box small metadata', () => {
    // Test MBR calculation for box with small metadata.
    const params = RegistryParameters.defaults()
    const metadataSize = 100
    const mbr = params.mbrForBox(metadataSize)
    const expected =
      constants.FLAT_MBR +
      constants.BYTE_MBR * (constants.ASSET_METADATA_BOX_KEY_SIZE + constants.HEADER_SIZE + metadataSize)
    expect(mbr).toBe(expected)
  })

  test('mbr for box max metadata', () => {
    // Test MBR calculation for box with max metadata.
    const params = RegistryParameters.defaults()
    const mbr = params.mbrForBox(params.maxMetadataSize)
    const expected =
      constants.FLAT_MBR +
      constants.BYTE_MBR * (constants.ASSET_METADATA_BOX_KEY_SIZE + constants.HEADER_SIZE + params.maxMetadataSize)
    expect(mbr).toBe(expected)
  })

  test('mbr delta creation', () => {
    // Test MBR delta for box creation (oldMetadataSize=null).
    const params = RegistryParameters.defaults()
    const newSize = 200
    const delta = params.mbrDelta({ oldMetadataSize: null, newMetadataSize: newSize })

    const expectedMbr = params.mbrForBox(newSize)
    expect(delta.isPositive).toBe(true)
    expect(delta.amount).toBe(expectedMbr)
    expect(delta.signedAmount).toBe(expectedMbr)
  })

  test('mbr delta increase', () => {
    // Test MBR delta for increasing metadata size.
    const params = RegistryParameters.defaults()
    const oldSize = 100
    const newSize = 300
    const delta = params.mbrDelta({ oldMetadataSize: oldSize, newMetadataSize: newSize })

    const expectedDelta = params.mbrForBox(newSize) - params.mbrForBox(oldSize)
    expect(delta.isPositive).toBe(true)
    expect(delta.amount).toBe(expectedDelta)
    expect(delta.signedAmount).toBe(expectedDelta)
  })

  test('mbr delta decrease', () => {
    // Test MBR delta for decreasing metadata size.
    const params = RegistryParameters.defaults()
    const oldSize = 500
    const newSize = 200
    const delta = params.mbrDelta({ oldMetadataSize: oldSize, newMetadataSize: newSize })

    const expectedDelta = params.mbrForBox(oldSize) - params.mbrForBox(newSize)
    expect(delta.isNegative).toBe(true)
    expect(delta.amount).toBe(expectedDelta)
    expect(delta.signedAmount).toBe(-expectedDelta)
  })

  test('mbr delta no change', () => {
    // Test MBR delta when size doesn't change.
    const params = RegistryParameters.defaults()
    const size = 150
    const delta = params.mbrDelta({ oldMetadataSize: size, newMetadataSize: size })

    expect(delta.isZero).toBe(true)
    expect(delta.amount).toBe(0)
    expect(delta.signedAmount).toBe(0)
  })

  test('mbr delta delete', () => {
    // Test MBR delta for deletion.
    const params = RegistryParameters.defaults()
    const oldSize = 250
    const delta = params.mbrDelta({ oldMetadataSize: oldSize, newMetadataSize: 0, delete: true })

    const expectedRefund = params.mbrForBox(oldSize)
    expect(delta.isNegative).toBe(true)
    expect(delta.amount).toBe(expectedRefund)
    expect(delta.signedAmount).toBe(-expectedRefund)
  })
})

describe('registry parameters advanced', () => {
  // Advanced tests for RegistryParameters edge cases.
  test('mbr for box negative size raises', () => {
    // Test mbrForBox with negative metadataSize.
    const params = RegistryParameters.defaults()
    expect(() => params.mbrForBox(-1)).toThrow(/metadataSize must be non-negative/)
  })

  test('mbr delta negative new size raises', () => {
    // Test mbrDelta with negative newMetadataSize.
    const params = RegistryParameters.defaults()
    expect(() => params.mbrDelta({ oldMetadataSize: 100, newMetadataSize: -1 })).toThrow(
      /newMetadataSize must be non-negative/,
    )
  })

  test('mbr delta delete without old size raises', () => {
    // Test mbrDelta with delete=true but oldMetadataSize=null.
    const params = RegistryParameters.defaults()
    expect(() => params.mbrDelta({ oldMetadataSize: null, newMetadataSize: 0, delete: true })).toThrow(
      /oldMetadataSize must be provided when delete=true/,
    )
  })

  test('mbr delta delete with nonzero new size raises', () => {
    // Test mbrDelta with delete=true but newMetadataSize != 0.
    const params = RegistryParameters.defaults()
    expect(() => params.mbrDelta({ oldMetadataSize: 100, newMetadataSize: 50, delete: true })).toThrow(
      /newMetadataSize must be 0 when delete=true/,
    )
  })
})

describe('metadata existence', () => {
  // Tests for MetadataExistence class.
  test('both exist', () => {
    // Test when both ASA and metadata exist.
    const existence = new MetadataExistence({ asaExists: true, metadataExists: true })
    expect(existence.asaExists).toBe(true)
    expect(existence.metadataExists).toBe(true)
  })

  test('asa only exists', () => {
    // Test when only ASA exists.
    const existence = new MetadataExistence({ asaExists: true, metadataExists: false })
    expect(existence.asaExists).toBe(true)
    expect(existence.metadataExists).toBe(false)
  })

  test('neither exists', () => {
    // Test when neither exists.
    const existence = new MetadataExistence({ asaExists: false, metadataExists: false })
    expect(existence.asaExists).toBe(false)
    expect(existence.metadataExists).toBe(false)
  })

  test('from tuple', () => {
    // Test fromTuple parsing.
    const existence = MetadataExistence.fromTuple([true, false])
    expect(existence.asaExists).toBe(true)
    expect(existence.metadataExists).toBe(false)
  })

  test('from tuple both true', () => {
    // Test fromTuple with both True.
    const existence = MetadataExistence.fromTuple([true, true])
    expect(existence.asaExists).toBe(true)
    expect(existence.metadataExists).toBe(true)
  })

  test('from tuple both false', () => {
    // Test fromTuple with both False.
    const existence = MetadataExistence.fromTuple([false, false])
    expect(existence.asaExists).toBe(false)
    expect(existence.metadataExists).toBe(false)
  })

  test('from tuple invalid length', () => {
    // Test fromTuple with wrong number of elements.
    expect(() => MetadataExistence.fromTuple([true])).toThrow(/Expected \(asaExists, metadataExists\)/)
    expect(() => MetadataExistence.fromTuple([true, false, true])).toThrow(/Expected \(asaExists, metadataExists\)/)
  })
})

describe('pagination', () => {
  // Tests for Pagination class.
  test('basic pagination', () => {
    // Test basic pagination values.
    const pagination = new Pagination({ metadataSize: 5000, pageSize: 1000, totalPages: 5 })
    expect(pagination.metadataSize).toBe(5000)
    expect(pagination.pageSize).toBe(1000)
    expect(pagination.totalPages).toBe(5)
  })

  test('from tuple', () => {
    // Test fromTuple parsing.
    const pagination = Pagination.fromTuple([3000, 1000, 3])
    expect(pagination.metadataSize).toBe(3000)
    expect(pagination.pageSize).toBe(1000)
    expect(pagination.totalPages).toBe(3)
  })

  test('from tuple zero metadata', () => {
    // Test fromTuple with zero metadata.
    const pagination = Pagination.fromTuple([0, 1000, 0])
    expect(pagination.metadataSize).toBe(0)
    expect(pagination.pageSize).toBe(1000)
    expect(pagination.totalPages).toBe(0)
  })

  test('from tuple invalid length', () => {
    // Test fromTuple with wrong number of elements.
    expect(() => Pagination.fromTuple([1000, 100])).toThrow(/Expected \(metadataSize, pageSize, totalPages\)/)
  })
})

describe('paginated metadata', () => {
  // Tests for PaginatedMetadata class.
  test('has next page', () => {
    // Test paginated metadata with next page.
    const metadata = new PaginatedMetadata({
      hasNextPage: true,
      lastModifiedRound: 1000n,
      pageContent: new TextEncoder().encode('page data'),
    })
    expect(metadata.hasNextPage).toBe(true)
    expect(metadata.lastModifiedRound).toBe(1000n)
    expect(metadata.pageContent).toEqual(new TextEncoder().encode('page data'))
  })

  test('no next page', () => {
    // Test paginated metadata without next page.
    const metadata = new PaginatedMetadata({
      hasNextPage: false,
      lastModifiedRound: 2000n,
      pageContent: new TextEncoder().encode('last page'),
    })
    expect(metadata.hasNextPage).toBe(false)
    expect(metadata.lastModifiedRound).toBe(2000n)
    expect(metadata.pageContent).toEqual(new TextEncoder().encode('last page'))
  })

  test('from tuple', () => {
    // Test fromTuple parsing.
    const metadata = PaginatedMetadata.fromTuple([true, 1500, new TextEncoder().encode('content')])
    expect(metadata.hasNextPage).toBe(true)
    expect(metadata.lastModifiedRound).toBe(1500n)
    expect(metadata.pageContent).toEqual(new TextEncoder().encode('content'))
  })

  test('from tuple empty content', () => {
    // Test fromTuple with empty content.
    const metadata = PaginatedMetadata.fromTuple([false, 0, new Uint8Array()])
    expect(metadata.hasNextPage).toBe(false)
    expect(metadata.lastModifiedRound).toBe(0n)
    expect(metadata.pageContent).toEqual(new Uint8Array())
  })

  test('from tuple invalid length', () => {
    // Test fromTuple with wrong number of elements.
    expect(() => PaginatedMetadata.fromTuple([true, 1000])).toThrow(
      /Expected \(hasNextPage, lastModifiedRound, pageContent\)/,
    )
  })
})

describe('paginated metadata advanced', () => {
  // Advanced tests for PaginatedMetadata.
  test('from tuple invalid has next page type', () => {
    // Test fromTuple with non-bool hasNextPage.
    expect(() => PaginatedMetadata.fromTuple(['not bool' as any, 1000, new Uint8Array()])).toThrow(
      /hasNextPage must be bool/,
    )
  })

  test('from tuple invalid last modified round type', () => {
    // Test fromTuple with non-int lastModifiedRound.
    expect(() => PaginatedMetadata.fromTuple([true, 'not int' as any, new Uint8Array()])).toThrow(
      /lastModifiedRound.*must be an integer/,
    )
  })

  test('from tuple page content as list', () => {
    // Test fromTuple with pageContent as list of ints.
    const result = PaginatedMetadata.fromTuple([false, 2000, [1, 2, 3, 4, 5]])
    expect(result.pageContent).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })
})

describe('helper functions', () => {
  // Tests for module-level helper functions.
  test('set bit true', () => {
    // Test setBit setting a bit to True.
    const result = setBit({ bits: 0b00000000, mask: 0b00000001, value: true })
    expect(result).toBe(0b00000001)
  })

  test('set bit false', () => {
    // Test setBit clearing a bit to False.
    const result = setBit({ bits: 0b11111111, mask: 0b00000001, value: false })
    expect(result).toBe(0b11111110)
  })

  test('set bit preserves other bits', () => {
    // Test setBit preserves other bits when setting.
    const result = setBit({ bits: 0b10101010, mask: 0b00000100, value: true })
    expect(result).toBe(0b10101110)
  })

  test('set bit preserves other bits when clearing', () => {
    // Test setBit preserves other bits when clearing.
    const result = setBit({ bits: 0b10101110, mask: 0b00000100, value: false })
    expect(result).toBe(0b10101010)
  })

  test('coerce bytes from bytes', () => {
    // Test toBytes with bytes input.
    const result = toBytes(new TextEncoder().encode('hello'), 'test')
    expect(result).toEqual(new TextEncoder().encode('hello'))
  })

  test('coerce bytes from arraybuffer', () => {
    // Test toBytes with ArrayBuffer input.
    const buf = new Uint8Array([4, 5, 6]).buffer
    const result = toBytes(buf, 'test')
    expect(result).toEqual(new Uint8Array([4, 5, 6]))
  })

  test('coerce bytes from buffer', () => {
    // Test toBytes with Node Buffer input.
    const result = toBytes(Buffer.from([7, 8, 9]), 'test')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result)).toEqual([7, 8, 9])
  })

  test('coerce bytes from data view slice', () => {
    // Test toBytes with a DataView over a subset of an ArrayBuffer.
    const raw = new Uint8Array([10, 11, 12, 13, 14])
    const view = new DataView(raw.buffer, 1, 3)
    const result = toBytes(view, 'test')
    expect(result).toEqual(new Uint8Array([11, 12, 13]))
  })

  test('coerce bytes from list', () => {
    // Test toBytes with list of ints.
    const result = toBytes([0, 255, 128], 'test')
    expect(result).toEqual(new Uint8Array([0, 255, 128]))
  })

  test('coerce bytes invalid string raises', () => {
    // Test toBytes with string raises TypeError.
    expect(() => toBytes('not bytes', 'test')).toThrow(/must be bytes or a sequence of ints/)
  })

  test('coerce bytes invalid int raises', () => {
    // Test toBytes with int raises TypeError.
    expect(() => toBytes(42, 'test')).toThrow(/must be bytes or a sequence of ints/)
  })

  test('coerce bytes invalid list content raises', () => {
    // Test toBytes with list of non-ints raises TypeError.
    expect(() => toBytes(['not', 'ints'], 'test')).toThrow(/must be bytes or a sequence of ints/)
  })

  test('is nonzero 32 all zeros', () => {
    // Test isNonzero32 with all zeros.
    expect(isNonzero32(new Uint8Array(32))).toBe(false)
  })

  test('is nonzero 32 one nonzero', () => {
    // Test isNonzero32 with one non-zero byte.
    const data = new Uint8Array(32)
    data[31] = 1
    expect(isNonzero32(data)).toBe(true)
  })

  test('is nonzero 32 all nonzero', () => {
    // Test isNonzero32 with all non-zero bytes.
    expect(isNonzero32(new Uint8Array(32).fill(0xff))).toBe(true)
  })

  test('is nonzero 32 wrong length', () => {
    // Test isNonzero32 with wrong length.
    expect(isNonzero32(new Uint8Array(31).fill(1))).toBe(false)
    expect(isNonzero32(new Uint8Array(33).fill(1))).toBe(false)
  })
})
