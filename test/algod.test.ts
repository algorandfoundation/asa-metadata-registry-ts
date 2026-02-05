/**
 * Unit tests for src/algod module.
 *
 * Tests cover:
 * - AlgodBoxReader.getBoxValue
 * - AlgodBoxReader.tryGetMetadataBox
 * - AlgodBoxReader.getMetadataBox
 * - AlgodBoxReader.getAssetMetadataRecord
 * - AlgodBoxReader.getAssetInfo
 * - AlgodBoxReader.getAssetUrl
 * - AlgodBoxReader.resolveMetadataUriFromAsset
 */

import { describe, expect, test, vi } from 'vitest'
import type { Algodv2, modelsv2 } from 'algosdk'
import {
  Arc90Uri,
  assetIdToBoxName,
  AsaNotFoundError,
  BoxNotFoundError,
  InvalidArc90UriError,
  AssetMetadataBox,
  AssetMetadataRecord,
  getDefaultRegistryParams,
  HEADER_SIZE,
  algod,
} from '@algorandfoundation/asa-metadata-registry-sdk'

const { AlgodBoxReader } = algod

// ================================================================
// Mocks
// ================================================================

const createMockAlgodReader = () => {
  const algodMock = {
    getApplicationBoxByName: vi.fn(),
    getAssetByID: vi.fn(),
  } as unknown as Algodv2
  const reader = new AlgodBoxReader(algodMock)
  return { algodMock, reader }
}

// ================================================================
// Helpers
// ================================================================

const createMinimalBoxValue = (body: Uint8Array = new Uint8Array(0)): Uint8Array => {
  const header = new Uint8Array(HEADER_SIZE)
  const result = new Uint8Array(header.length + body.length)
  result.set(header, 0)
  result.set(body, header.length)
  return result
}

// ================================================================
// Unit Tests
// ================================================================

describe('algod box reader: get box value', () => {
  // Tests for AlgodBoxReader.getBoxValue
  test('get box value simple response', async () => {
    // Test getBoxValue with simple response shape {value: Uint8Array}.
    const { algodMock, reader } = createMockAlgodReader()

    const boxData = new TextEncoder().encode('test_box_value')
    const mockResponse = {
      name: new Uint8Array(),
      value: boxData,
    } as modelsv2.Box

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(mockResponse),
    })

    const result = await reader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('test_box') })

    expect(result.value).toEqual(boxData)
    expect(algodMock.getApplicationBoxByName).toHaveBeenCalledWith(123n, new TextEncoder().encode('test_box'))
  })

  test('get box value empty bytes', async () => {
    // Test getBoxValue with empty bytes.
    const { algodMock, reader } = createMockAlgodReader()

    const emptyBytes = new Uint8Array([0x00])
    const mockResponse = {
      name: new Uint8Array(),
      value: emptyBytes,
    } as modelsv2.Box

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(mockResponse),
    })

    const result = await reader.getBoxValue({ appId: 789, boxName: new TextEncoder().encode('minimal_box') })

    expect(result.value).toEqual(emptyBytes)
  })

  test('get box value not found 404', async () => {
    // Test getBoxValue raises BoxNotFoundError on 404.
    const { algodMock, reader } = createMockAlgodReader()

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Error 404: Box not found')),
    })

    await expect(reader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('missing_box') })).rejects.toThrow(
      BoxNotFoundError,
    )
    await expect(reader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('missing_box') })).rejects.toThrow(
      /Box not found/,
    )
  })

  test('get box value not found message', async () => {
    // Test getBoxValue raises BoxNotFoundError on 'not found' message.
    const { algodMock, reader } = createMockAlgodReader()

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('The specified box was not found')),
    })

    await expect(reader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('missing_box') })).rejects.toThrow(
      BoxNotFoundError,
    )
    await expect(reader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('missing_box') })).rejects.toThrow(
      /Box not found/,
    )
  })

  test('get box value unexpected error reraises', async () => {
    // Test getBoxValue re-raises unexpected errors.
    const { algodMock, reader } = createMockAlgodReader()

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Unexpected error')),
    })

    await expect(reader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('error_box') })).rejects.toThrow(
      /Unexpected error/,
    )
  })
})

describe('algod box reader: try get metadata box', () => {
  // Tests for AlgodBoxReader.tryGetMetadataBox
  test('try get metadata box exists', async () => {
    // Test tryGetMetadataBox returns AssetMetadataBox when box exists.
    const { algodMock, reader } = createMockAlgodReader()

    const assetId = 12345n
    const body = new TextEncoder().encode('{"test": "metadata"}')
    const boxValue = createMinimalBoxValue(body)

    const mockResponse = {
      name: new Uint8Array(),
      value: boxValue,
    } as modelsv2.Box

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(mockResponse),
    })

    const result = await reader.tryGetMetadataBox({ appId: 123, assetId })

    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(AssetMetadataBox)
    expect(result!.assetId).toBe(assetId)
    expect(result!.body.rawBytes).toEqual(body)
    expect(algodMock.getApplicationBoxByName).toHaveBeenCalledWith(123n, assetIdToBoxName(assetId))
  })

  test('try get metadata box not found', async () => {
    // Test tryGetMetadataBox returns null when box doesn't exist.
    const { algodMock, reader } = createMockAlgodReader()

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Error 404: Not found')),
    })

    const result = await reader.tryGetMetadataBox({ appId: 123, assetId: 12345 })

    expect(result).toBeNull()
  })

  test('try get metadata box with custom params', async () => {
    // Test tryGetMetadataBox with custom RegistryParameters.
    const { algodMock, reader } = createMockAlgodReader()

    const assetId = 67890n
    const body = new TextEncoder().encode('test')
    const boxValue = createMinimalBoxValue(body)

    const mockResponse = {
      name: new Uint8Array(),
      value: boxValue,
    } as modelsv2.Box

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(mockResponse),
    })

    const params = getDefaultRegistryParams()
    const result = await reader.tryGetMetadataBox({ appId: 123, assetId, params })

    expect(result).not.toBeNull()
    expect(result!.assetId).toBe(assetId)
  })
})

describe('algod box reader: get metadata box', () => {
  // Tests for AlgodBoxReader.getMetadataBox
  test('get metadata box exists', async () => {
    // Test getMetadataBox returns AssetMetadataBox when box exists.
    const { algodMock, reader } = createMockAlgodReader()

    const assetId = 99999n
    const body = new TextEncoder().encode('{"name": "Test Asset"}')
    const boxValue = createMinimalBoxValue(body)

    const mockResponse = {
      name: new Uint8Array(),
      value: boxValue,
    } as modelsv2.Box

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(mockResponse),
    })

    const result = await reader.getMetadataBox({ appId: 456, assetId })

    expect(result).toBeInstanceOf(AssetMetadataBox)
    expect(result.assetId).toBe(assetId)
    expect(result.body.rawBytes).toEqual(body)
  })

  test('get metadata box not found raises', async () => {
    // Test getMetadataBox raises BoxNotFoundError when box doesn't exist.
    const { algodMock, reader } = createMockAlgodReader()

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('404 Not found')),
    })

    await expect(reader.getMetadataBox({ appId: 123, assetId: 12345 })).rejects.toThrow(BoxNotFoundError)
    await expect(reader.getMetadataBox({ appId: 123, assetId: 12345 })).rejects.toThrow(/Metadata box not found/)
  })
})

describe('algod box reader: get asset metadata record', () => {
  // Tests for AlgodBoxReader.getAssetMetadataRecord

  test('get asset metadata record success', async () => {
    // Test getAssetMetadataRecord returns complete record.
    const { algodMock, reader } = createMockAlgodReader()

    const appId = 789
    const assetId = 54321n
    const body = new TextEncoder().encode('{"description": "Test metadata"}')
    const boxValue = createMinimalBoxValue(body)

    const mockResponse = {
      name: new Uint8Array(),
      value: boxValue,
    } as modelsv2.Box

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(mockResponse),
    })

    const result = await reader.getAssetMetadataRecord({ appId, assetId })

    expect(result).toBeInstanceOf(AssetMetadataRecord)
    expect(result.appId).toBe(BigInt(appId))
    expect(result.assetId).toBe(assetId)
    expect(result.body.rawBytes).toEqual(body)
    expect(result.header).toBeDefined()
  })

  test('get asset metadata record with params', async () => {
    // Test getAssetMetadataRecord with custom RegistryParameters.
    const { algodMock, reader } = createMockAlgodReader()

    const appId = 111
    const assetId = 222n
    const body = new TextEncoder().encode('{}')
    const boxValue = createMinimalBoxValue(body)

    const mockResponse = {
      name: new Uint8Array(),
      value: boxValue,
    } as modelsv2.Box

    algodMock.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(mockResponse),
    })

    const params = getDefaultRegistryParams()
    const result = await reader.getAssetMetadataRecord({ appId, assetId, params })

    expect(result.appId).toBe(BigInt(appId))
    expect(result.assetId).toBe(assetId)
  })
})

describe('algod box reader: get asset info', () => {
  // Tests for AlgodBoxReader.getAssetInfo
  test('get asset info success', async () => {
    // Test getAssetInfo returns asset information.
    const { algodMock, reader } = createMockAlgodReader()

    const assetId = 123456n
    const assetInfo = {
      index: assetId,
      params: {
        total: 1000n,
        decimals: 0,
        name: 'Test Asset',
        url: 'https://example.com',
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await reader.getAssetInfo(assetId)

    expect(result).toEqual(assetInfo)
    expect(algodMock.getAssetByID).toHaveBeenCalledWith(assetId)
  })

  test('get asset info not found 404', async () => {
    // Test getAssetInfo raises AsaNotFoundError on 404.
    const { algodMock, reader } = createMockAlgodReader()

    const assetId = 99999n
    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Error 404: Asset not found')),
    })

    await expect(reader.getAssetInfo(assetId)).rejects.toThrow(AsaNotFoundError)
    await expect(reader.getAssetInfo(assetId)).rejects.toThrow(`ASA ${assetId} not found`)
  })

  test('get asset info not found message', async () => {
    // Test getAssetInfo raises AsaNotFoundError on 'not found' message.
    const { algodMock, reader } = createMockAlgodReader()

    const assetId = 88888n
    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('asset not found in ledger')),
    })

    await expect(reader.getAssetInfo(assetId)).rejects.toThrow(AsaNotFoundError)
    await expect(reader.getAssetInfo(assetId)).rejects.toThrow(`ASA ${assetId} not found`)
  })

  test('get asset info unexpected error reraises', async () => {
    // Test getAssetInfo re-raises unexpected errors.
    const { algodMock, reader } = createMockAlgodReader()

    const assetId = 77777n
    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Network error')),
    })

    await expect(reader.getAssetInfo(assetId)).rejects.toThrow(/Network error/)
  })
})

describe('algod box reader: get asset url', () => {
  // Tests for AlgodBoxReader.getAssetUrl
  test('get asset url with url', async () => {
    // Test getAssetUrl returns URL when present.
    const { algodMock, reader } = createMockAlgodReader()

    const url = 'https://example.com/metadata'
    const assetInfo = {
      index: 123n,
      params: {
        url,
        name: 'Test',
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await reader.getAssetUrl(123)

    expect(result).toBe(url)
  })

  test('get asset url without url', async () => {
    // Test getAssetUrl returns null when URL is not present.
    const { algodMock, reader } = createMockAlgodReader()

    const assetInfo = {
      index: 123n,
      params: {
        name: 'Test',
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await reader.getAssetUrl(123)

    expect(result).toBeNull()
  })

  test('get asset url empty url', async () => {
    // Test getAssetUrl with empty URL string.
    const { algodMock, reader } = createMockAlgodReader()

    const assetInfo = {
      index: 123n,
      params: {
        url: '',
        name: 'Test',
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await reader.getAssetUrl(123)

    expect(result).toBe('')
  })

  test('get asset url no params', async () => {
    // Test getAssetUrl returns null when params is missing.
    const { algodMock, reader } = createMockAlgodReader()

    const assetInfo = {
      index: 123n,
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await reader.getAssetUrl(123)

    expect(result).toBeNull()
  })

  test('get asset url numeric value', async () => {
    // Test getAssetUrl converts numeric URL to string.
    const { algodMock, reader } = createMockAlgodReader()

    const assetInfo = {
      index: 123n,
      params: {
        url: 12345 as any,
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await reader.getAssetUrl(123)

    expect(result).toBe('12345')
  })
})

describe('algod box reader: resolve metadata uri from asset', () => {
  // Tests for AlgodBoxReader.resolveMetadataUriFromAsset
  test('resolve metadata uri valid arc89 uri', async () => {
    // Test resolveMetadataUriFromAsset with valid ARC-89 partial URI.
    const { algodMock, reader } = createMockAlgodReader()

    const assetId = 12345n
    const partialUri = 'algorand://net:testnet/app/456?box='

    const assetInfo = {
      index: assetId,
      params: {
        url: partialUri,
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await reader.resolveMetadataUriFromAsset({ assetId })

    expect(result).toBeInstanceOf(Arc90Uri)
    expect(result.appId).toBe(456n)
    expect(result.assetId).toBe(assetId)
    expect(result.netauth).toBe('net:testnet')
  })

  test('resolve metadata uri no url raises', async () => {
    // Test resolveMetadataUriFromAsset raises when ASA has no URL.
    const { algodMock, reader } = createMockAlgodReader()

    const assetInfo = {
      index: 123n,
      params: {
        name: 'Test',
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    await expect(reader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
    await expect(reader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(
      /ASA has no url field; cannot resolve ARC-89 metadata URI/,
    )
  })

  test('resolve metadata uri empty url raises', async () => {
    // Test resolveMetadataUriFromAsset raises when URL is empty.
    const { algodMock, reader } = createMockAlgodReader()

    const assetInfo = {
      index: 123n,
      params: {
        url: '',
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    await expect(reader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
    await expect(reader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(
      /ASA has no url field; cannot resolve ARC-89 metadata URI/,
    )
  })

  test('resolve metadata uri invalid uri format', async () => {
    // Test resolveMetadataUriFromAsset raises on invalid URI format.
    const { algodMock, reader } = createMockAlgodReader()

    const assetInfo = {
      index: 123n,
      params: {
        url: 'https://example.com',
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    await expect(reader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
  })

  test('resolve metadata uri generic parse error', async () => {
    // Test resolveMetadataUriFromAsset raises InvalidArc90UriError for malformed URIs.
    const { algodMock, reader } = createMockAlgodReader()

    const assetInfo = {
      index: 123n,
      params: {
        url: 'algorand://net:testnet/app/NOTANUMBER?box=',
      },
    } as modelsv2.Asset

    algodMock.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    await expect(reader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
  })
})

// ================================================================
// Integration Tests
// ================================================================

// TODO:
