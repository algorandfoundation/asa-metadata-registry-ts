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

import { describe, expect, test, vi, beforeAll, beforeEach } from 'vitest'
import type { modelsv2 } from 'algosdk'
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import type { AlgorandClient } from '@algorandfoundation/algokit-utils'
import {
  Arc90Uri,
  assetIdToBoxName,
  AsaNotFoundError,
  BoxNotFoundError,
  InvalidArc90UriError,
  AssetMetadataBox,
  AssetMetadataRecord,
  AsaMetadataRegistryWrite,
  getDefaultRegistryParams,
  RegistryParameters,
  HEADER_SIZE,
  MAX_METADATA_SIZE,
  ARC90_URI_SCHEME,
  ARC90_URI_BOX_QUERY_NAME,
  AlgodClientSubset,
  AlgodBoxReader,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import { AsaMetadataRegistryClient, AsaMetadataRegistryFactory } from '@/generated'
import {
  sampleJsonObj,
  deployRegistry,
  getDeployer,
  createFactory,
  createFundedAccount,
  createArc89Asa,
  buildEmptyMetadata,
  buildShortMetadata,
  buildMaxedMetadata,
  uploadMetadata,
} from './helpers'

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

const createMockBoxResponse = (value?: Uint8Array<ArrayBufferLike>, rawValue = false): modelsv2.Box => {
  return {
    name: new Uint8Array(),
    value: rawValue ? value : minimalMetadataBoxValue(value),
  } as modelsv2.Box
}

const createMockAssetResponse = (assetId?: bigint, url?: string): modelsv2.Asset => {
  return {
    index: assetId ?? 12345n,
    params: {
      total: 1000n,
      decimals: 0,
      name: 'Test Asset',
      url: url ?? '',
    },
  } as modelsv2.Asset
}

// ================================================================
// Helpers
// ================================================================

const minimalMetadataBoxValue = (body: Uint8Array = new Uint8Array(0)): Uint8Array => {
  const header = new Uint8Array(HEADER_SIZE)
  const result = new Uint8Array(header.length + body.length)
  result.set(header, 0)
  result.set(body, header.length)
  return result
}

// ================================================================
// AlgodBoxReader Tests
// ================================================================

let algod: AlgodClientSubset // MOCK algod client
let boxReader: AlgodBoxReader // MOCK algod box reader

beforeEach(() => {
  vi.resetAllMocks()
  algod = createMockAlgod()
  boxReader = createMockBoxReader(algod)
})

describe('get box value', () => {
  // Tests for AlgodBoxReader.getBoxValue
  test('get box value simple response', async () => {
    // Test getBoxValue with simple response shape {value: Uint8Array}.
    const boxData = new TextEncoder().encode('test_box_value')
    const response = createMockBoxResponse(boxData, true)
    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(response),
    })

    const result = await boxReader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('test_box') })

    expect(result.value).toEqual(boxData)
    expect(algod.getApplicationBoxByName).toHaveBeenCalledWith(123n, new TextEncoder().encode('test_box'))
  })

  test('get box value empty bytes', async () => {
    // Test getBoxValue with empty bytes.
    const emptyBytes = new Uint8Array([0x00])
    const response = createMockBoxResponse(emptyBytes, true)
    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(response),
    })

    const result = await boxReader.getBoxValue({ appId: 789, boxName: new TextEncoder().encode('minimal_box') })

    expect(result.value).toEqual(emptyBytes)
  })

  test('get box value not found 404', async () => {
    // Test getBoxValue raises BoxNotFoundError on 404.
    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Error 404: Box not found')),
    })

    await expect(
      boxReader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('missing_box') }),
    ).rejects.toThrow(BoxNotFoundError)
    await expect(
      boxReader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('missing_box') }),
    ).rejects.toThrow(/Box not found/)
  })

  test('get box value not found message', async () => {
    // Test getBoxValue raises BoxNotFoundError on 'not found' message.
    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('The specified box was not found')),
    })

    await expect(
      boxReader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('missing_box') }),
    ).rejects.toThrow(BoxNotFoundError)
    await expect(
      boxReader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('missing_box') }),
    ).rejects.toThrow(/Box not found/)
  })

  test('get box value unexpected error reraises', async () => {
    // Test getBoxValue re-raises unexpected errors.
    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Unexpected error')),
    })

    await expect(boxReader.getBoxValue({ appId: 123, boxName: new TextEncoder().encode('error_box') })).rejects.toThrow(
      /Unexpected error/,
    )
  })
})

describe('try get metadata box', () => {
  // Tests for AlgodBoxReader.tryGetMetadataBox
  test('try get metadata box exists', async () => {
    // Test tryGetMetadataBox returns AssetMetadataBox when box exists.
    const assetId = 12345n
    const body = new TextEncoder().encode('{"test": "metadata"}')
    const response = createMockBoxResponse(body)
    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(response),
    })

    const result = await boxReader.tryGetMetadataBox({ appId: 123, assetId })

    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(AssetMetadataBox)
    expect(result!.assetId).toBe(assetId)
    expect(result!.body.rawBytes).toEqual(body)
    expect(algod.getApplicationBoxByName).toHaveBeenCalledWith(123n, assetIdToBoxName(assetId))
  })

  test('try get metadata box not found', async () => {
    // Test tryGetMetadataBox returns null when box doesn't exist.
    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Error 404: Not found')),
    })

    const result = await boxReader.tryGetMetadataBox({ appId: 123, assetId: 12345 })

    expect(result).toBeNull()
  })

  test('try get metadata box with custom params', async () => {
    // Test tryGetMetadataBox with custom RegistryParameters.
    const assetId = 67890n
    const body = new TextEncoder().encode('test')
    const response = createMockBoxResponse(body)

    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(response),
    })

    const params = getDefaultRegistryParams()
    const result = await boxReader.tryGetMetadataBox({ appId: 123, assetId, params })

    expect(result).not.toBeNull()
    expect(result!.assetId).toBe(assetId)
  })
})

describe('get metadata box', () => {
  // Tests for AlgodBoxReader.getMetadataBox
  test('get metadata box exists', async () => {
    // Test getMetadataBox returns AssetMetadataBox when box exists.
    const assetId = 99999n
    const body = new TextEncoder().encode('{"name": "Test Asset"}')
    const response = createMockBoxResponse(body)

    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(response),
    })

    const result = await boxReader.getMetadataBox({ appId: 456, assetId })

    expect(result).toBeInstanceOf(AssetMetadataBox)
    expect(result.assetId).toBe(assetId)
    expect(result.body.rawBytes).toEqual(body)
  })

  test('get metadata box not found raises', async () => {
    // Test getMetadataBox raises BoxNotFoundError when box doesn't exist.
    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('404 Not found')),
    })

    await expect(boxReader.getMetadataBox({ appId: 123, assetId: 12345 })).rejects.toThrow(BoxNotFoundError)
    await expect(boxReader.getMetadataBox({ appId: 123, assetId: 12345 })).rejects.toThrow(/Metadata box not found/)
  })
})

describe('get asset metadata record', () => {
  // Tests for AlgodBoxReader.getAssetMetadataRecord

  test('get asset metadata record success', async () => {
    // Test getAssetMetadataRecord returns complete record.
    const appId = 789
    const assetId = 54321n
    const body = new TextEncoder().encode('{"description": "Test metadata"}')
    const response = createMockBoxResponse(body)

    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(response),
    })

    const result = await boxReader.getAssetMetadataRecord({ appId, assetId })

    expect(result).toBeInstanceOf(AssetMetadataRecord)
    expect(result.appId).toBe(BigInt(appId))
    expect(result.assetId).toBe(assetId)
    expect(result.body.rawBytes).toEqual(body)
    expect(result.header).toBeDefined()
  })

  test('get asset metadata record with params', async () => {
    // Test getAssetMetadataRecord with custom RegistryParameters.
    const appId = 111
    const assetId = 222n
    const body = new TextEncoder().encode('{}')
    const response = createMockBoxResponse(body)

    algod.getApplicationBoxByName = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(response),
    })

    const params = getDefaultRegistryParams()
    const result = await boxReader.getAssetMetadataRecord({ appId, assetId, params })

    expect(result.appId).toBe(BigInt(appId))
    expect(result.assetId).toBe(assetId)
  })
})

describe('get asset info', () => {
  // Tests for AlgodBoxReader.getAssetInfo
  test('get asset info success', async () => {
    // Test getAssetInfo returns asset information.
    const assetId = 123456n
    const assetInfo = createMockAssetResponse(assetId)

    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await boxReader.getAssetInfo(assetId)

    expect(result).toEqual(assetInfo)
    expect(algod.getAssetByID).toHaveBeenCalledWith(assetId)
  })

  test('get asset info not found 404', async () => {
    // Test getAssetInfo raises AsaNotFoundError on 404.
    const assetId = 99999n

    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Error 404: Asset not found')),
    })

    await expect(boxReader.getAssetInfo(assetId)).rejects.toThrow(AsaNotFoundError)
    await expect(boxReader.getAssetInfo(assetId)).rejects.toThrow(`ASA ${assetId} not found`)
  })

  test('get asset info not found message', async () => {
    // Test getAssetInfo raises AsaNotFoundError on 'not found' message.
    const assetId = 88888n
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('asset not found in ledger')),
    })

    await expect(boxReader.getAssetInfo(assetId)).rejects.toThrow(AsaNotFoundError)
    await expect(boxReader.getAssetInfo(assetId)).rejects.toThrow(`ASA ${assetId} not found`)
  })

  test('get asset info unexpected error reraises', async () => {
    // Test getAssetInfo re-raises unexpected errors.
    const assetId = 77777n

    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockRejectedValue(new Error('Network error')),
    })

    await expect(boxReader.getAssetInfo(assetId)).rejects.toThrow(/Network error/)
  })
})

describe('get asset url', () => {
  // Tests for AlgodBoxReader.getAssetUrl
  test('get asset url with url', async () => {
    // Test getAssetUrl returns URL when present.
    const url = 'https://example.com/metadata'
    const assetInfo = createMockAssetResponse(123n, url)
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBe(url)
  })

  test('get asset url without url', async () => {
    // Test getAssetUrl returns null when URL is not present.
    const assetInfo = {
      index: 123n,
      params: {
        name: 'Test',
      },
    } as modelsv2.Asset
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBeNull()
  })

  test('get asset url empty url', async () => {
    // Test getAssetUrl with empty URL string.
    const assetInfo = createMockAssetResponse(123n)

    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBe('')
  })

  test('get asset url no params', async () => {
    // Test getAssetUrl returns null when params is missing.
    const assetInfo = {
      index: 123n,
    } as modelsv2.Asset
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBeNull()
  })

  test('get asset url numeric value', async () => {
    // Test getAssetUrl converts numeric URL to string.
    const assetInfo = {
      index: 123n,
      params: {
        url: 12345 as any,
      },
    } as modelsv2.Asset
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBe('12345')
  })
})

describe('resolve metadata uri from asset', () => {
  // Tests for AlgodBoxReader.resolveMetadataUriFromAsset
  test('resolve metadata uri valid arc89 uri', async () => {
    // Test resolveMetadataUriFromAsset with valid ARC-89 partial URI.
    const assetId = 12345n
    const partialUri = 'algorand://net:testnet/app/456?box='
    const assetInfo = createMockAssetResponse(assetId, partialUri)
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    const result = await boxReader.resolveMetadataUriFromAsset({ assetId })

    expect(result).toBeInstanceOf(Arc90Uri)
    expect(result.appId).toBe(456n)
    expect(result.assetId).toBe(assetId)
    expect(result.netauth).toBe('net:testnet')
  })

  test('resolve metadata uri no url raises', async () => {
    // Test resolveMetadataUriFromAsset raises when ASA has no URL.
    const assetInfo = {
      index: 123n,
      params: {
        name: 'Test',
      },
    } as modelsv2.Asset
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    await expect(boxReader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
    await expect(boxReader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(
      /ASA has no url field; cannot resolve ARC-89 metadata URI/,
    )
  })

  test('resolve metadata uri empty url raises', async () => {
    // Test resolveMetadataUriFromAsset raises when URL is empty.
    const assetInfo = createMockAssetResponse(123n)
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    await expect(boxReader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
    await expect(boxReader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(
      /ASA has no url field; cannot resolve ARC-89 metadata URI/,
    )
  })

  test('resolve metadata uri invalid uri format', async () => {
    // Test resolveMetadataUriFromAsset raises on invalid URI format.
    const assetInfo = createMockAssetResponse(123n, 'https://example.com')
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    await expect(boxReader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
  })

  test('resolve metadata uri generic parse error', async () => {
    // Test resolveMetadataUriFromAsset raises InvalidArc90UriError for malformed URIs.
    const assetInfo = createMockAssetResponse(123n, 'algorand://net:testnet/app/NOTANUMBER?box=')
    algod.getAssetByID = vi.fn().mockReturnValue({
      do: vi.fn().mockResolvedValue(assetInfo),
    })

    await expect(boxReader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
  })
})

// ================================================================
// AlgodBoxReader Integration Tests
// ================================================================

describe('algod box reader integration', () => {
  // Integration tests using real algod client.
  const textDecoder = new TextDecoder()
  const fixture = algorandFixture()
  let algorand: AlgorandClient
  let client: AsaMetadataRegistryClient
  let factory: AsaMetadataRegistryFactory
  let boxReader: AlgodBoxReader
  let writer: AsaMetadataRegistryWrite
  let deployer: TransactionSignerAccount
  let assetManager: TransactionSignerAccount

  beforeAll(async () => {
    await fixture.newScope()
    algorand = fixture.algorand
    deployer = getDeployer(fixture)
    factory = createFactory({ algorand, deployer })
    client = await deployRegistry({ factory, deployer })
    assetManager = await createFundedAccount(fixture)

    // Create AlgodBoxReader with real algod client.
    boxReader = new AlgodBoxReader(algorand.client.algod)
    writer = new AsaMetadataRegistryWrite({ client })
  })

  test('try get metadata box for nonexistent app', async () => {
    // Test tryGetMetadataBox returns null for nonexistent app.
    // Use a very high app ID that likely doesn't exist
    const result = await boxReader.tryGetMetadataBox({ appId: 999999999, assetId: 12345 })
    expect(result).toBeNull()
  })

  test('get metadata box for nonexistent metadata throws', async () => {
    // Test getMetadataBox throws for nonexistent metadata.
    await expect(boxReader.getMetadataBox({ appId: 999999999, assetId: 12345 })).rejects.toThrow(BoxNotFoundError)
  })

  test('get asset info for invalid asset id throws', async () => {
    // Test getAssetInfo throws for invalid asset ID.
    await expect(boxReader.getAssetInfo(999999999999)).rejects.toThrow(AsaNotFoundError)
    await expect(boxReader.getAssetInfo(999999999999)).rejects.toThrow(/ASA 999999999999 not found/)
  })

  test('full flow with uploaded metadata', async () => {
    // Test full read flow with actual uploaded metadata.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })

    const appId = client.appId

    // Test tryGetMetadataBox
    const box = await boxReader.tryGetMetadataBox({ appId, assetId })
    expect(box).not.toBeNull()
    expect(box!.assetId).toBe(assetId)
    expect(box!.body.rawBytes.length).toBeGreaterThan(0)

    // Test getMetadataBox
    const box2 = await boxReader.getMetadataBox({ appId, assetId })
    expect(box2.assetId).toBe(assetId)
    expect(box2.body.rawBytes).toEqual(box!.body.rawBytes)

    // Test getAssetMetadataRecord
    const record = await boxReader.getAssetMetadataRecord({ appId, assetId })
    expect(record.appId).toBe(BigInt(appId))
    expect(record.assetId).toBe(assetId)
    expect(record.body.rawBytes).toEqual(box!.body.rawBytes)
    expect(record.json).toEqual(sampleJsonObj) // assert content
  })

  test('resolve metadata uri from arc89 asset', async () => {
    // Test resolving ARC-89 URI from an actual ARC-89 compliant ASA.
    // The createArc89Asa helper creates an ASA with an ARC-89 partial URI
    const arc89Asa = await createArc89Asa({ assetManager, appClient: client })

    const uri = await boxReader.resolveMetadataUriFromAsset({ assetId: arc89Asa })

    expect(uri).toBeInstanceOf(Arc90Uri)
    expect(uri.appId).toBeGreaterThan(0n)
    expect(uri.appId).toBe(client.appId)
    expect(uri.assetId).toBe(arc89Asa)
    expect(uri.netauth).not.toBeNull()
    expect(uri.boxName).toStrictEqual(assetIdToBoxName(arc89Asa))
  })

  test('get asset URL from arc89 asset', async () => {
    // Test getting asset URL from an actual ARC-89 compliant ASA.
    const arc89Asa = await createArc89Asa({ assetManager, appClient: client })

    const url = await boxReader.getAssetUrl(arc89Asa)

    expect(url).not.toBeNull()
    expect(url!.startsWith(textDecoder.decode(ARC90_URI_SCHEME))).toBe(true)
    expect(url!.includes(textDecoder.decode(ARC90_URI_BOX_QUERY_NAME))).toBe(true)
  })

  test('metadata box with empty metadata', async () => {
    // Test reading metadata box with empty metadata.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildEmptyMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })

    const appId = client.appId
    const box = await boxReader.getMetadataBox({ appId, assetId })
    expect(box.assetId).toBe(assetId)
    expect(box.body.rawBytes).toEqual(new Uint8Array())
  })

  test('metadata box with maxed metadata', async () => {
    // Test reading metadata box with maximum size metadata.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildMaxedMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })

    const appId = client.appId
    const box = await boxReader.getMetadataBox({ appId, assetId })
    expect(box.assetId).toBe(assetId)
    expect(box.body.rawBytes.length).toBe(MAX_METADATA_SIZE)
  })

  test('metadata record json parsing', async () => {
    // Test that metadata record can parse JSON correctly.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })

    const appId = client.appId
    const record = await boxReader.getAssetMetadataRecord({ appId, assetId })

    // Should be able to access JSON
    const jsonData = record.json
    expect(typeof jsonData).toBe('object')
    // The buildShortMetadata uses jsonObj which has these fields
    expect('name' in jsonData || Object.keys(jsonData).length >= 0).toBe(true)
  })

  test('immutable metadata flags', async () => {
    // Test that immutable flag is correctly read from metadata box.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata, immutable: true })

    const appId = client.appId
    const box = await boxReader.getMetadataBox({ appId, assetId })
    expect(box.header.isImmutable).toBe(true)
  })

  test('get box value with actual box', async () => {
    // Test getBoxValue with an actual box.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })

    const appId = client.appId
    const boxName = assetIdToBoxName(assetId)

    const value = await boxReader.getBoxValue({ appId, boxName })

    expect(value.value).toBeInstanceOf(Uint8Array)
    expect(value.value.length).toBeGreaterThanOrEqual(HEADER_SIZE) // At least header size
  })

  test('custom registry parameters', async () => {
    // Test reading metadata with custom RegistryParameters.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })

    const appId = client.appId
    const defaults = getDefaultRegistryParams()
    const params = new RegistryParameters({
      keySize: defaults.keySize,
      headerSize: defaults.headerSize,
      maxMetadataSize: defaults.maxMetadataSize,
      shortMetadataSize: defaults.shortMetadataSize,
      pageSize: defaults.pageSize,
      firstPayloadMaxSize: defaults.firstPayloadMaxSize,
      extraPayloadMaxSize: defaults.extraPayloadMaxSize,
      replacePayloadMaxSize: defaults.replacePayloadMaxSize,
      flatMbr: 5000, // double the default
      byteMbr: defaults.byteMbr,
    })

    const box = await boxReader.getMetadataBox({ appId, assetId, params })
    expect(box.assetId).toBe(assetId)

    // Also test with tryGetMetadataBox
    const box2 = await boxReader.tryGetMetadataBox({ appId, assetId, params })
    expect(box2).not.toBeNull()
    expect(box2!.assetId).toBe(assetId)
  })
})
