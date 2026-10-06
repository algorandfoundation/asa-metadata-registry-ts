/**
 * Unit tests for src/algod module.
 *
 * Ported from Python `arc89/tests/sdk/test_algod.py` (v1.0.0).
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

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { ALGORAND_ZERO_ADDRESS_STRING, modelsv2, type Algodv2 } from 'algosdk'
import {
  AlgodBoxReader,
  type AlgodClientSubset,
  Arc90Uri,
  AsaMetadataRegistryWrite,
  AsaNotFoundError,
  AssetMetadataBox,
  AssetMetadataRecord,
  BoxNotFoundError,
  InvalidArc90UriError,
  RegistryParameters,
  ARC90_URI_BOX_QUERY_NAME,
  ARC90_URI_SCHEME,
  DEPRECATED_BY_SIZE,
  HEADER_SIZE,
  IRREVERSIBLE_FLAGS_SIZE,
  LAST_MODIFIED_ROUND_SIZE,
  MAX_METADATA_SIZE,
  METADATA_HASH_SIZE,
  METADATA_IDENTIFIERS_SIZE,
  REVERSIBLE_FLAGS_SIZE,
  assetIdToBoxName,
  b64Encode,
  getDefaultRegistryParams,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import type { AsaMetadataRegistryClient } from '@/generated'
import {
  ARC90_NETAUTH,
  type AddressWithSigners,
  buildEmptyMetadata,
  buildMaxedMetadata,
  buildShortMetadata,
  createArc89Asa,
  createFactory,
  createFundedAccount,
  deployRegistry,
  getDeployer,
  sampleJsonObj,
  uploadMetadata,
} from './helpers'

// ================================================================
// Mocks
// ================================================================

/** An algosdk request object: the Algod HTTP call happens on `.do()`. */
type AlgodRequest = { do: () => Promise<unknown> }

/** A request whose `.do()` resolves with `response`. */
const respond = (response: unknown): AlgodRequest => ({ do: async () => response })

/** A request whose `.do()` rejects with `error` (algosdk surfaces Algod HTTP errors there). */
const reject = (error: unknown): AlgodRequest => ({
  do: async () => {
    throw error
  },
})

/** Mock of the algosdk `Algodv2` subset wrapped by `AlgodBoxReader`. */
const createMockAlgod = () => ({
  getApplicationBoxByName: vi.fn<(appId: bigint, boxName: Uint8Array) => AlgodRequest>(),
  getAssetByID: vi.fn<(assetId: bigint) => AlgodRequest>(),
})

type MockAlgod = ReturnType<typeof createMockAlgod>

/** An algosdk `getApplicationBoxByName(...).do()` response: the model decodes the base64 value, as Algod returns it. */
const boxResponse = (value: Uint8Array): modelsv2.Box =>
  new modelsv2.Box({ name: new Uint8Array(), round: 1, value: b64Encode(value) })

/** An algosdk HTTP error recognizable only by its response status (as algosdk request errors expose it). */
const httpStatusError = (status: number): Error => Object.assign(new Error('Request failed'), { response: { status } })

// ================================================================
// Helpers
// ================================================================

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/** A metadata box value: `header` (zeroed by default) followed by `body`. */
const metadataBoxValue = (body: Uint8Array, header: Uint8Array = new Uint8Array(HEADER_SIZE)): Uint8Array => {
  const value = new Uint8Array(header.length + body.length)
  value.set(header, 0)
  value.set(body, header.length)
  return value
}

// ================================================================
// AlgodBoxReader Tests
// ================================================================

let algod: MockAlgod // MOCK algod client
let boxReader: AlgodBoxReader // AlgodBoxReader over the MOCK algod client

beforeEach(() => {
  algod = createMockAlgod()
  boxReader = new AlgodBoxReader(algod as unknown as AlgodClientSubset)
})

describe('get box value', () => {
  // Tests for AlgodBoxReader.getBoxValue
  test('get box value simple response', async () => {
    // Test getBoxValue with simple response shape {name, value}.
    const boxData = utf8('test_box_value')
    algod.getApplicationBoxByName.mockReturnValue(respond({ name: utf8('test'), value: boxData }))

    const result = await boxReader.getBoxValue({ appId: 123, boxName: utf8('test_box') })

    expect(result).toEqual(boxData)
    expect(algod.getApplicationBoxByName).toHaveBeenCalledExactlyOnceWith(123n, utf8('test_box'))
  })

  test('get box value box model response', async () => {
    // Test getBoxValue with the algosdk `modelsv2.Box` response (base64 value decoded by the model).
    // Python tests the nested {"box": {...}} dict shape of py-algosdk here: algosdk v3 always
    // returns the typed model.
    const boxData = utf8('nested_box_value')
    algod.getApplicationBoxByName.mockReturnValue(respond(boxResponse(boxData)))

    const result = await boxReader.getBoxValue({ appId: 456, boxName: utf8('nested_box') })

    expect(result).toEqual(boxData)
    expect(algod.getApplicationBoxByName).toHaveBeenCalledExactlyOnceWith(456n, utf8('nested_box'))
  })

  test('get box value empty bytes', async () => {
    // Test getBoxValue with a minimal box value ("AA==" is the base64 of a single null byte).
    algod.getApplicationBoxByName.mockReturnValue(respond(new modelsv2.Box({ name: '', round: 1, value: 'AA==' })))

    const result = await boxReader.getBoxValue({ appId: 789, boxName: utf8('minimal_box') })

    expect(result).toEqual(new Uint8Array([0x00]))
  })

  test('get box value empty value', async () => {
    // An empty box value (empty base64 string) is returned as empty bytes.
    algod.getApplicationBoxByName.mockReturnValue(respond(boxResponse(new Uint8Array())))

    const result = await boxReader.getBoxValue({ appId: 789, boxName: utf8('empty_box') })

    expect(result).toEqual(new Uint8Array())
  })

  test('get box value not found 404', async () => {
    // Test getBoxValue raises BoxNotFoundError on 404.
    algod.getApplicationBoxByName.mockReturnValue(reject(new Error('Error 404: Box not found')))

    const promise = boxReader.getBoxValue({ appId: 123, boxName: utf8('missing_box') })

    await expect(promise).rejects.toThrow(BoxNotFoundError)
    await expect(promise).rejects.toThrow(/Box not found/)
  })

  test('get box value not found message', async () => {
    // Test getBoxValue raises BoxNotFoundError on 'not found' message.
    algod.getApplicationBoxByName.mockReturnValue(reject(new Error('The specified box was not found')))

    const promise = boxReader.getBoxValue({ appId: 123, boxName: utf8('missing_box') })

    await expect(promise).rejects.toThrow(BoxNotFoundError)
    await expect(promise).rejects.toThrow(/Box not found/)
  })

  test('get box value not found http status', async () => {
    // algosdk request errors are also recognized as "not found" by their HTTP status (404).
    const algodError = httpStatusError(404)
    algod.getApplicationBoxByName.mockReturnValue(reject(algodError))

    const promise = boxReader.getBoxValue({ appId: 123, boxName: utf8('missing_box') })

    await expect(promise).rejects.toThrow(BoxNotFoundError)
    await expect(promise).rejects.toHaveProperty('cause', algodError)
  })

  test('get box value unexpected error reraises', async () => {
    // Test getBoxValue re-raises unexpected errors.
    const unexpected = new Error('Unexpected error')
    algod.getApplicationBoxByName.mockReturnValue(reject(unexpected))

    await expect(boxReader.getBoxValue({ appId: 123, boxName: utf8('error_box') })).rejects.toBe(unexpected)

    // Other HTTP errors are not "not found"
    const serverError = httpStatusError(500)
    algod.getApplicationBoxByName.mockReturnValue(reject(serverError))

    await expect(boxReader.getBoxValue({ appId: 123, boxName: utf8('error_box') })).rejects.toBe(serverError)
  })

  // Python's `test_get_box_value_invalid_response_shape` and `test_get_box_value_non_dict_response`
  // check the raw dict responses of py-algosdk: algosdk v3 decodes the Algod JSON into a typed
  // `modelsv2.Box`, so there is no response shape for the SDK to check.
})

describe('try get metadata box', () => {
  // Tests for AlgodBoxReader.tryGetMetadataBox
  test('try get metadata box exists', async () => {
    // Test tryGetMetadataBox returns AssetMetadataBox when box exists.
    const assetId = 12345n
    // Create minimal valid box value (51 bytes header + body)
    // Header: identifiers(1) + rev_flags(1) + irr_flags(1) + hash(32) + revision(8) + deprecated_by(8)
    const header = new Uint8Array(
      METADATA_IDENTIFIERS_SIZE + // identifiers
        REVERSIBLE_FLAGS_SIZE + // reversible_flags
        IRREVERSIBLE_FLAGS_SIZE + // irreversible_flags
        METADATA_HASH_SIZE + // metadata_hash
        LAST_MODIFIED_ROUND_SIZE + // last_modified_round
        DEPRECATED_BY_SIZE, // deprecated_by
    )
    const body = utf8('{"test": "metadata"}')
    algod.getApplicationBoxByName.mockReturnValue(respond(boxResponse(metadataBoxValue(body, header))))

    const result = await boxReader.tryGetMetadataBox({ appId: 123, assetId })

    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(AssetMetadataBox)
    expect(result!.assetId).toBe(assetId)
    expect(result!.body.rawBytes).toEqual(body)
    expect(algod.getApplicationBoxByName).toHaveBeenCalledExactlyOnceWith(123n, assetIdToBoxName(assetId))
  })

  test('try get metadata box not found', async () => {
    // Test tryGetMetadataBox returns null when box doesn't exist.
    algod.getApplicationBoxByName.mockReturnValue(reject(new Error('Error 404: Not found')))

    const result = await boxReader.tryGetMetadataBox({ appId: 123, assetId: 12345 })

    expect(result).toBeNull()
  })

  test('try get metadata box with custom params', async () => {
    // Test tryGetMetadataBox with custom RegistryParameters.
    const assetId = 67890n
    algod.getApplicationBoxByName.mockReturnValue(respond(boxResponse(metadataBoxValue(utf8('test')))))

    const params = getDefaultRegistryParams()
    const result = await boxReader.tryGetMetadataBox({ appId: 123, assetId, params })

    expect(result).not.toBeNull()
    expect(result!.assetId).toBe(assetId)
  })

  test('try get metadata box unexpected error reraises', async () => {
    // Only a missing box maps to null: other Algod errors are re-raised.
    const unexpected = new Error('Network error')
    algod.getApplicationBoxByName.mockReturnValue(reject(unexpected))

    await expect(boxReader.tryGetMetadataBox({ appId: 123, assetId: 12345 })).rejects.toBe(unexpected)
  })
})

describe('get metadata box', () => {
  // Tests for AlgodBoxReader.getMetadataBox
  test('get metadata box exists', async () => {
    // Test getMetadataBox returns AssetMetadataBox when box exists.
    const assetId = 99999n
    const body = utf8('{"name": "Test Asset"}')
    algod.getApplicationBoxByName.mockReturnValue(respond(boxResponse(metadataBoxValue(body))))

    const result = await boxReader.getMetadataBox({ appId: 456, assetId })

    expect(result).toBeInstanceOf(AssetMetadataBox)
    expect(result.assetId).toBe(assetId)
    expect(result.body.rawBytes).toEqual(body)
  })

  test('get metadata box not found raises', async () => {
    // Test getMetadataBox raises BoxNotFoundError when box doesn't exist.
    algod.getApplicationBoxByName.mockReturnValue(reject(new Error('404 Not found')))

    const promise = boxReader.getMetadataBox({ appId: 123, assetId: 12345 })

    await expect(promise).rejects.toThrow(BoxNotFoundError)
    await expect(promise).rejects.toThrow(/Metadata box not found/)
  })
})

describe('get asset metadata record', () => {
  // Tests for AlgodBoxReader.getAssetMetadataRecord
  test('get asset metadata record success', async () => {
    // Test getAssetMetadataRecord returns complete record.
    const appId = 789
    const assetId = 54321n
    const body = utf8('{"description": "Test metadata"}')
    algod.getApplicationBoxByName.mockReturnValue(respond(boxResponse(metadataBoxValue(body))))

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
    algod.getApplicationBoxByName.mockReturnValue(respond(boxResponse(metadataBoxValue(utf8('{}')))))

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
    const assetId = 123456
    const assetInfo = new modelsv2.Asset({
      index: assetId,
      params: new modelsv2.AssetParams({
        creator: ALGORAND_ZERO_ADDRESS_STRING,
        total: 1000,
        decimals: 0,
        name: 'Test Asset',
        url: 'https://example.com',
      }),
    })
    algod.getAssetByID.mockReturnValue(respond(assetInfo))

    const result = await boxReader.getAssetInfo(assetId)

    expect(result).toBe(assetInfo)
    expect(algod.getAssetByID).toHaveBeenCalledExactlyOnceWith(BigInt(assetId))
  })

  test('get asset info not found 404', async () => {
    // Test getAssetInfo raises AsaNotFoundError on 404.
    const assetId = 99999n
    algod.getAssetByID.mockReturnValue(reject(new Error('Error 404: Asset not found')))

    const promise = boxReader.getAssetInfo(assetId)

    await expect(promise).rejects.toThrow(AsaNotFoundError)
    await expect(promise).rejects.toThrow(`ASA ${assetId} not found`)
  })

  test('get asset info not found message', async () => {
    // Test getAssetInfo raises AsaNotFoundError on 'not found' message.
    const assetId = 88888n
    algod.getAssetByID.mockReturnValue(reject(new Error('asset not found in ledger')))

    const promise = boxReader.getAssetInfo(assetId)

    await expect(promise).rejects.toThrow(AsaNotFoundError)
    await expect(promise).rejects.toThrow(`ASA ${assetId} not found`)
  })

  test('get asset info does not exist message', async () => {
    // Algod 'does not exist' errors also denote a missing ASA.
    const assetId = 66666n
    algod.getAssetByID.mockReturnValue(reject(new Error('asset 66666 does not exist')))

    const promise = boxReader.getAssetInfo(assetId)

    await expect(promise).rejects.toThrow(AsaNotFoundError)
    await expect(promise).rejects.toThrow(`ASA ${assetId} not found`)
  })

  test('get asset info not found http status', async () => {
    // algosdk request errors are also recognized as "not found" by their HTTP status (404).
    const assetId = 55555n
    const algodError = httpStatusError(404)
    algod.getAssetByID.mockReturnValue(reject(algodError))

    const promise = boxReader.getAssetInfo(assetId)

    await expect(promise).rejects.toThrow(AsaNotFoundError)
    await expect(promise).rejects.toHaveProperty('cause', algodError)
  })

  test('get asset info unexpected error reraises', async () => {
    // Test getAssetInfo re-raises unexpected errors.
    const unexpected = new Error('Network error')
    algod.getAssetByID.mockReturnValue(reject(unexpected))

    await expect(boxReader.getAssetInfo(77777n)).rejects.toBe(unexpected)
  })

  // Python's `test_get_asset_info_invalid_response_type` checks the raw dict response of py-algosdk:
  // algosdk v3 decodes the Algod JSON into a typed `modelsv2.Asset`.
})

describe('get asset url', () => {
  // Tests for AlgodBoxReader.getAssetUrl
  test('get asset url with url', async () => {
    // Test getAssetUrl returns URL when present.
    const url = 'https://example.com/metadata'
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: { url, name: 'Test' } }))

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBe(url)
  })

  test('get asset url without url', async () => {
    // Test getAssetUrl returns null when URL is not present.
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: { name: 'Test' } }))

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBeNull()
  })

  test('get asset url empty url', async () => {
    // Test getAssetUrl with empty URL string.
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: { url: '', name: 'Test' } }))

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBe('')
  })

  test('get asset url no params', async () => {
    // Test getAssetUrl returns null when params is missing.
    algod.getAssetByID.mockReturnValue(respond({ index: 123n }))

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBeNull()
  })

  test('get asset url params not dict', async () => {
    // Test getAssetUrl returns null when params is not an object.
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: 'not a dict' }))

    const result = await boxReader.getAssetUrl(123)

    expect(result).toBeNull()
  })

  test('get asset url numeric value', async () => {
    // Test getAssetUrl converts numeric URL to string.
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: { url: 12345 } }))

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
    algod.getAssetByID.mockReturnValue(respond({ index: assetId, params: { url: partialUri } }))

    const result = await boxReader.resolveMetadataUriFromAsset({ assetId })

    expect(result).toBeInstanceOf(Arc90Uri)
    expect(result.appId).toBe(456n)
    expect(result.assetId).toBe(assetId)
    expect(result.netauth).toBe('net:testnet')
  })

  test('resolve metadata uri no url raises', async () => {
    // Test resolveMetadataUriFromAsset raises when ASA has no URL.
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: { name: 'Test' } }))

    const promise = boxReader.resolveMetadataUriFromAsset({ assetId: 123 })

    await expect(promise).rejects.toThrow(InvalidArc90UriError)
    await expect(promise).rejects.toThrow(/ASA has no url field; cannot resolve ARC-89 metadata URI/)
  })

  test('resolve metadata uri empty url raises', async () => {
    // Test resolveMetadataUriFromAsset raises when URL is empty.
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: { url: '' } }))

    const promise = boxReader.resolveMetadataUriFromAsset({ assetId: 123 })

    await expect(promise).rejects.toThrow(InvalidArc90UriError)
    await expect(promise).rejects.toThrow(/ASA has no url field; cannot resolve ARC-89 metadata URI/)
  })

  test('resolve metadata uri invalid uri format', async () => {
    // Test resolveMetadataUriFromAsset raises on invalid URI format.
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: { url: 'https://example.com' } }))

    await expect(boxReader.resolveMetadataUriFromAsset({ assetId: 123 })).rejects.toThrow(InvalidArc90UriError)
  })

  test('resolve metadata uri generic parse error', async () => {
    // Test resolveMetadataUriFromAsset raises InvalidArc90UriError for malformed URIs.
    algod.getAssetByID.mockReturnValue(
      respond({ index: 123n, params: { url: 'algorand://net:testnet/app/NOTANUMBER?box=' } }),
    )

    // The Arc90Uri.parse error is wrapped into an InvalidArc90UriError
    const promise = boxReader.resolveMetadataUriFromAsset({ assetId: 123 })

    await expect(promise).rejects.toThrow(InvalidArc90UriError)
    await expect(promise).rejects.toThrow(/Failed to resolve ARC-89 URI from ASA url/)
  })

  test('resolve metadata uri non partial url raises', async () => {
    // An Asset URL MUST be an ARC-89 partial URI (empty box value): a complete URI is rejected.
    const completeUri = new Arc90Uri({ netauth: 'net:testnet', appId: 456, boxName: null }).withAssetId(123).toUri()
    algod.getAssetByID.mockReturnValue(respond({ index: 123n, params: { url: completeUri } }))

    const promise = boxReader.resolveMetadataUriFromAsset({ assetId: 123 })

    await expect(promise).rejects.toThrow(InvalidArc90UriError)
    await expect(promise).rejects.toHaveProperty('cause.message', 'Asset URL MUST have an empty box value')
  })
})

// ================================================================
// AlgodBoxReader Integration Tests
// ================================================================

describe('algod box reader integration', () => {
  // Integration tests using a real algod client (LocalNet).
  const textDecoder = new TextDecoder()
  const fixture = algorandFixture()
  let algodClient: Algodv2
  let client: AsaMetadataRegistryClient
  let writer: AsaMetadataRegistryWrite
  let assetManager: AddressWithSigners
  let algodReader: AlgodBoxReader

  beforeAll(async () => {
    await fixture.newScope()
    algodClient = fixture.context.algod
    const deployer = getDeployer(fixture)
    const factory = createFactory({ algorand: fixture.algorand, deployer })
    client = await deployRegistry({ factory, deployer })
    writer = new AsaMetadataRegistryWrite({ client })
    assetManager = await createFundedAccount(fixture)

    // Create AlgodBoxReader with real algod client.
    algodReader = new AlgodBoxReader(algodClient)
  })

  test('try get metadata box for nonexistent app', async () => {
    // Test tryGetMetadataBox returns null for nonexistent app.
    // Use a very high app ID that likely doesn't exist
    const result = await algodReader.tryGetMetadataBox({ appId: 999999999, assetId: 12345 })
    expect(result).toBeNull()
  })

  test('get metadata box for nonexistent metadata throws', async () => {
    // Test getMetadataBox throws for nonexistent metadata.
    await expect(algodReader.getMetadataBox({ appId: 999999999, assetId: 12345 })).rejects.toThrow(BoxNotFoundError)
  })

  test('get asset info for invalid asset id throws', async () => {
    // Test getAssetInfo throws AsaNotFoundError for invalid asset ID.
    const promise = algodReader.getAssetInfo(999999999999)

    await expect(promise).rejects.toThrow(AsaNotFoundError)
    await expect(promise).rejects.toThrow(/ASA 999999999999 not found/)
  })

  test('full flow with uploaded metadata', async () => {
    // Test full read flow with actual uploaded metadata.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

    const appId = client.appId

    // Test tryGetMetadataBox
    const box = await algodReader.tryGetMetadataBox({ appId, assetId })
    expect(box).not.toBeNull()
    expect(box!.assetId).toBe(assetId)
    expect(box!.body.rawBytes.length).toBeGreaterThan(0)

    // Test getMetadataBox
    const box2 = await algodReader.getMetadataBox({ appId, assetId })
    expect(box2.assetId).toBe(assetId)
    expect(box2.body.rawBytes).toEqual(box!.body.rawBytes)

    // Test getAssetMetadataRecord
    const record = await algodReader.getAssetMetadataRecord({ appId, assetId })
    expect(record.appId).toBe(appId)
    expect(record.assetId).toBe(assetId)
    expect(record.body.rawBytes).toEqual(box!.body.rawBytes)
    expect(record.json).toStrictEqual(sampleJsonObj) // assert content
  })

  test('resolve metadata uri from arc89 asset', async () => {
    // Test resolving ARC-89 URI from an actual ARC-89 compliant ASA.
    // The createArc89Asa helper creates an ASA with an ARC-89 partial URI
    const arc89Asa = await createArc89Asa({ assetManager, appClient: client })

    const uri = await algodReader.resolveMetadataUriFromAsset({ assetId: arc89Asa })

    expect(uri).toBeInstanceOf(Arc90Uri)
    expect(uri.appId).toBeGreaterThan(0n)
    expect(uri.appId).toBe(client.appId)
    expect(uri.assetId).toBe(arc89Asa)
    expect(uri.netauth).not.toBeNull()
    expect(uri.netauth).toBe(ARC90_NETAUTH)
    expect(uri.boxName).toStrictEqual(assetIdToBoxName(arc89Asa))
  })

  test('get asset URL from arc89 asset', async () => {
    // Test getting asset URL from an actual ARC-89 compliant ASA.
    const arc89Asa = await createArc89Asa({ assetManager, appClient: client })

    const url = await algodReader.getAssetUrl(arc89Asa)

    expect(url).not.toBeNull()
    expect(url!.startsWith(textDecoder.decode(ARC90_URI_SCHEME))).toBe(true)
    expect(url!.includes(textDecoder.decode(ARC90_URI_BOX_QUERY_NAME))).toBe(true)
  })

  test('metadata box with empty metadata', async () => {
    // Test reading metadata box with empty metadata.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildEmptyMetadata(assetId) })

    const box = await algodReader.getMetadataBox({ appId: client.appId, assetId })
    expect(box.assetId).toBe(assetId)
    expect(box.body.rawBytes).toEqual(new Uint8Array())
  })

  test('metadata box with maxed metadata', async () => {
    // Test reading metadata box with maximum size metadata.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildMaxedMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata, validateArc3: false })

    const box = await algodReader.getMetadataBox({ appId: client.appId, assetId })
    expect(box.assetId).toBe(assetId)
    expect(box.body.rawBytes.length).toBe(MAX_METADATA_SIZE)
  })

  test('metadata record json parsing', async () => {
    // Test that metadata record can parse JSON correctly.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

    const record = await algodReader.getAssetMetadataRecord({ appId: client.appId, assetId })

    // Should be able to access JSON
    const jsonData = record.json
    expect(typeof jsonData).toBe('object')
    // The buildShortMetadata helper uses sampleJsonObj
    expect(jsonData).toStrictEqual(sampleJsonObj)
  })

  test('immutable metadata flags', async () => {
    // Test that immutable flag is correctly read from metadata box.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata, immutable: true })

    const box = await algodReader.getMetadataBox({ appId: client.appId, assetId })
    expect(box.header.isImmutable).toBe(true)
  })

  test('get box value with actual box', async () => {
    // Test getBoxValue with an actual box: the raw box value (header + metadata).
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })

    const value = await algodReader.getBoxValue({ appId: client.appId, boxName: assetIdToBoxName(assetId) })

    expect(value).toBeInstanceOf(Uint8Array)
    expect(value.length).toBeGreaterThanOrEqual(HEADER_SIZE) // At least header size
    expect(value.length).toBe(HEADER_SIZE + metadata.body.size)
    expect(value.slice(HEADER_SIZE)).toEqual(metadata.body.rawBytes)
  })

  test('custom registry parameters', async () => {
    // Test reading metadata with custom RegistryParameters.
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

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
      flatMbr: defaults.flatMbr * 2, // the MBR parameters do not affect box parsing
      byteMbr: defaults.byteMbr,
    })

    const box = await algodReader.getMetadataBox({ appId, assetId, params })
    expect(box.assetId).toBe(assetId)

    // Also test with tryGetMetadataBox
    const box2 = await algodReader.tryGetMetadataBox({ appId, assetId, params })
    expect(box2).not.toBeNull()
    expect(box2!.assetId).toBe(assetId)
  })
})
