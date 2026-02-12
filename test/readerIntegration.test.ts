/**
 * Integration tests for src/read/reader module with real smart contracts.
 *
 * Ported from Python `arc89/tests/sdk/test_reader_integration.py`.
 *
 * Tests cover:
 * - Reader with algod (BOX source) using uploaded metadata
 * - Reader with AVM source using uploaded metadata
 * - Reader with both algod and AVM configured (AUTO mode)
 * - JSON key extraction methods
 * - ARC-90 URI resolution
 * - Edge cases with real contracts
 */

import { describe, expect, test, beforeAll, vi } from 'vitest'
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import type { AlgorandClient } from '@algorandfoundation/algokit-utils'
import {
  AsaMetadataRegistryRead,
  AsaMetadataRegistryAvmRead,
  MetadataSource,
  AsaMetadataRegistryWrite,
  AssetMetadata,
  AlgodBoxReader,
  assetIdToBoxName,
  b64Decode,
  b64UrlEncode,
  B64_URL_ENCODING,
  B64_STD_ENCODING,
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
// AsaMetadataRegistryRead (a.k.a. reader) Integration Tests
// ================================================================

/**
 * Shared setup for reader integration tests.
 * Since all tests are read-only, test setup consists of uploading metadata once in beforeAll.
 */

const fixture = algorandFixture()
let algorand: AlgorandClient
let client: AsaMetadataRegistryClient
let factory: AsaMetadataRegistryFactory
let deployer: TransactionSignerAccount
let assetManager: TransactionSignerAccount
let writer: AsaMetadataRegistryWrite
let boxReader: AlgodBoxReader

// Reader variants
let readerWithAlgod: AsaMetadataRegistryRead
let readerWithAvm: AsaMetadataRegistryRead
let readerFull: AsaMetadataRegistryRead

// Uploaded metadata references
let mutableShortMetadata: AssetMetadata
let mutableMaxedMetadata: AssetMetadata
let mutableEmptyMetadata: AssetMetadata
let immutableShortMetadata: AssetMetadata

// ASA for ARC-90 URI tests
let arc89Asa: bigint

beforeAll(async () => {
  await fixture.newScope()
  algorand = fixture.algorand
  deployer = getDeployer(fixture)
  assetManager = await createFundedAccount(fixture)

  factory = createFactory({ algorand, deployer })
  client = await deployRegistry({ factory, deployer })
  writer = new AsaMetadataRegistryWrite({ client })
  boxReader = new AlgodBoxReader(algorand.client.algod)

  const avmFactory = (appId: bigint): AsaMetadataRegistryAvmRead =>
    new AsaMetadataRegistryAvmRead({ client: client.clone({ appId }) })

  // Reader instances
  readerWithAlgod = new AsaMetadataRegistryRead({ appId: client.appId, algod: boxReader })
  readerWithAvm = new AsaMetadataRegistryRead({ appId: client.appId, avmFactory })
  readerFull = new AsaMetadataRegistryRead({ appId: client.appId, algod: boxReader, avmFactory })

  // Upload mutable short metadata
  const shortAsaId = await createArc89Asa({ assetManager, appClient: client })
  const shortMeta = buildShortMetadata(shortAsaId)
  mutableShortMetadata = await uploadMetadata({ writer, assetManager, appClient: client, metadata: shortMeta })

  // Upload mutable maxed metadata
  const maxedAsaId = await createArc89Asa({ assetManager, appClient: client })
  const maxedMeta = buildMaxedMetadata(maxedAsaId)
  mutableMaxedMetadata = await uploadMetadata({ writer, assetManager, appClient: client, metadata: maxedMeta })

  // Upload mutable empty metadata
  const emptyAsaId = await createArc89Asa({ assetManager, appClient: client })
  const emptyMeta = buildEmptyMetadata(emptyAsaId)
  mutableEmptyMetadata = await uploadMetadata({ writer, assetManager, appClient: client, metadata: emptyMeta })

  // Upload immutable short metadata
  const immAsaId = await createArc89Asa({ assetManager, appClient: client })
  const immMeta = buildShortMetadata(immAsaId)
  immutableShortMetadata = await uploadMetadata({
    writer,
    assetManager,
    appClient: client,
    metadata: immMeta,
    immutable: true,
  })

  // ASA for ARC-90 URI resolution tests
  arc89Asa = await createArc89Asa({ assetManager, appClient: client })
})

// ================================================================
// Reader with Algod (BOX source)
// ================================================================

describe('reader with algod', () => {
  // Test reader with algod (BOX source) using uploaded metadata.
  test('get asset metadata short box source', async () => {
    // Test reading short metadata via BOX source.
    const result = await readerWithAlgod.getAssetMetadata({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(result.assetId).toBe(mutableShortMetadata.assetId)
    expect(result.body.rawBytes).toStrictEqual(mutableShortMetadata.body.rawBytes)
    expect(result.header.isShort).toBe(true)
  })

  test('get asset metadata maxed box source', async () => {
    // Test reading maxed metadata via BOX source.
    const result = await readerWithAlgod.getAssetMetadata({
      assetId: mutableMaxedMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(result.assetId).toBe(mutableMaxedMetadata.assetId)
    expect(result.body.rawBytes.length).toBe(mutableMaxedMetadata.size)
    expect(result.header.isShort).toBe(false)
  })

  test('get asset metadata empty box source', async () => {
    // Test reading empty metadata via BOX source.
    const result = await readerWithAlgod.getAssetMetadata({
      assetId: mutableEmptyMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(result.assetId).toBe(mutableEmptyMetadata.assetId)
    expect(result.body.rawBytes.length).toBe(0)
    expect(result.header.isShort).toBe(true)
  })

  test('check metadata exists true', async () => {
    // Test checking metadata existence when it exists.
    const result = await readerWithAlgod.arc89CheckMetadataExists({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(result.asaExists).toBe(true)
    expect(result.metadataExists).toBe(true)
  })

  test('is metadata immutable false', async () => {
    // Test checking immutability of mutable metadata.
    const result = await readerWithAlgod.arc89IsMetadataImmutable({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(result).toBe(false)
  })

  test('is metadata immutable true', async () => {
    // Test checking immutability of immutable metadata.
    const result = await readerWithAlgod.arc89IsMetadataImmutable({
      assetId: immutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(result).toBe(true)
  })

  test('is metadata short true', async () => {
    // Test checking if metadata is short (true case).
    const [isShort, roundNum] = await readerWithAlgod.arc89IsMetadataShort({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(isShort).toBe(true)
    expect(typeof roundNum).toBe('bigint')
    expect(roundNum).toBeGreaterThan(0n)
  })

  test('is metadata short false', async () => {
    // Test checking if metadata is short (false case).
    const [isShort, roundNum] = await readerWithAlgod.arc89IsMetadataShort({
      assetId: mutableMaxedMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(isShort).toBe(false)
    expect(typeof roundNum).toBe('bigint')
  })

  test('get metadata header', async () => {
    // Test getting metadata header.
    const header = await readerWithAlgod.arc89GetMetadataHeader({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(header.lastModifiedRound).toBeGreaterThan(0n)
    expect(header.metadataHash.length).toBe(32)
  })

  test('get metadata pagination', async () => {
    // Test getting metadata pagination info.
    const pagination = await readerWithAlgod.arc89GetMetadataPagination({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(pagination.metadataSize).toBe(mutableShortMetadata.size)
    expect(pagination.totalPages).toBeGreaterThanOrEqual(0)
  })

  test('get metadata first page', async () => {
    // Test getting first page of metadata.
    const page = await readerWithAlgod.arc89GetMetadata({
      assetId: mutableShortMetadata.assetId,
      page: 0,
      source: MetadataSource.BOX,
    })

    expect(page.pageContent.length).toBeGreaterThan(0)
    expect(page.lastModifiedRound).toBeGreaterThan(0n)
  })

  test('get metadata slice', async () => {
    // Test getting a slice of metadata.
    const sliceData = await readerWithAlgod.arc89GetMetadataSlice({
      assetId: mutableShortMetadata.assetId,
      offset: 0,
      size: 10,
      source: MetadataSource.BOX,
    })

    expect(sliceData.length).toBeLessThanOrEqual(10)
    expect(sliceData).toStrictEqual(mutableShortMetadata.body.rawBytes.slice(0, 10))
  })

  test('get metadata header hash', async () => {
    // Test getting metadata header hash.
    const headerHash = await readerWithAlgod.arc89GetMetadataHeaderHash({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(headerHash.length).toBe(32)
  })

  test('get metadata page hash', async () => {
    // Test getting metadata page hash.
    const pageHash = await readerWithAlgod.arc89GetMetadataPageHash({
      assetId: mutableShortMetadata.assetId,
      page: 0,
      source: MetadataSource.BOX,
    })

    expect(pageHash.length).toBe(32)
  })

  test('get metadata hash', async () => {
    // Test getting full metadata hash.
    const metadataHash = await readerWithAlgod.arc89GetMetadataHash({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    expect(metadataHash.length).toBe(32)
  })
})

// ================================================================
// Reader with AVM source
// ================================================================

describe('reader with avm', () => {
  // Test reader with AVM source using uploaded metadata.
  test('get asset metadata short avm source', async () => {
    // Test reading short metadata via AVM source.
    const result = await readerWithAvm.getAssetMetadata({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(result.assetId).toBe(mutableShortMetadata.assetId)
    expect(result.body.rawBytes).toStrictEqual(mutableShortMetadata.body.rawBytes)
    expect(result.header.isShort).toBe(true)
  })

  test('get asset metadata maxed avm source', async () => {
    // Test reading maxed metadata via AVM source.
    const result = await readerWithAvm.getAssetMetadata({
      assetId: mutableMaxedMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(result.assetId).toBe(mutableMaxedMetadata.assetId)
    expect(result.body.rawBytes.length).toBe(mutableMaxedMetadata.size)
  })

  test('check metadata exists avm', async () => {
    // Test checking metadata existence via AVM.
    const result = await readerWithAvm.arc89CheckMetadataExists({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(result.asaExists).toBe(true)
    expect(result.metadataExists).toBe(true)
  })

  test('is metadata immutable avm', async () => {
    // Test checking immutability via AVM.
    const result = await readerWithAvm.arc89IsMetadataImmutable({
      assetId: immutableShortMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(result).toBe(true)
  })

  test('get metadata header avm', async () => {
    // Test getting metadata header via AVM.
    const header = await readerWithAvm.arc89GetMetadataHeader({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(header.lastModifiedRound).toBeGreaterThan(0n)
    expect(header.metadataHash.length).toBe(32)
  })

  test('get metadata pagination avm', async () => {
    // Test getting pagination info via AVM.
    const pagination = await readerWithAvm.arc89GetMetadataPagination({
      assetId: mutableMaxedMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(pagination.metadataSize).toBe(mutableMaxedMetadata.size)
    expect(pagination.totalPages).toBeGreaterThan(1) // Maxed metadata should be multi-page
  })

  test('get metadata registry parameters', async () => {
    // Test getting registry parameters via AVM.
    const params = await readerWithAvm.arc89GetMetadataRegistryParameters({
      source: MetadataSource.AVM,
    })

    expect(params.headerSize).toBeGreaterThan(0)
    expect(params.maxMetadataSize).toBeGreaterThan(0)
  })
})

// ================================================================
// Reader with both algod and AVM (AUTO mode)
// ================================================================

describe('reader full', () => {
  // Test reader with both algod and AVM configured (AUTO mode).
  test('auto source prefers box', async () => {
    // AUTO should use BOX (faster) when both are available.
    // Spy on the algod box reader to verify metadata is fetched via BOX.
    const boxReadSpy = vi.spyOn(readerFull.algod!, 'getAssetMetadataRecord')

    const result = await readerFull.getAssetMetadata({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.AUTO,
    })

    expect(boxReadSpy).toHaveBeenCalledTimes(1)
    expect(boxReadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: mutableShortMetadata.assetId,
      }),
    )
    expect(result.assetId).toBe(mutableShortMetadata.assetId)
    expect(result.body.rawBytes).toStrictEqual(mutableShortMetadata.body.rawBytes)

    boxReadSpy.mockRestore()
  })

  test('box and avm consistency', async () => {
    // Test BOX and AVM sources return consistent results.
    const boxResult = await readerFull.getAssetMetadata({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    const avmResult = await readerFull.getAssetMetadata({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.AVM,
    })

    // Both should return same metadata
    expect(boxResult.body.rawBytes).toStrictEqual(avmResult.body.rawBytes)
    expect(boxResult.header.isShort).toBe(avmResult.header.isShort)
    expect(boxResult.header.isImmutable).toBe(avmResult.header.isImmutable)
  })

  test('header hash consistency', async () => {
    // Test header hash is consistent between BOX and AVM.
    const boxHash = await readerFull.arc89GetMetadataHeaderHash({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    const avmHash = await readerFull.arc89GetMetadataHeaderHash({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(boxHash).toStrictEqual(avmHash)
  })

  test('metadata hash consistency', async () => {
    // Test metadata hash is consistent between BOX and AVM.
    const boxHash = await readerFull.arc89GetMetadataHash({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.BOX,
    })

    const avmHash = await readerFull.arc89GetMetadataHash({
      assetId: mutableShortMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(boxHash).toStrictEqual(avmHash)
  })

  test('pagination consistency', async () => {
    // Test pagination info is consistent between BOX and AVM.
    const boxPagination = await readerFull.arc89GetMetadataPagination({
      assetId: mutableMaxedMetadata.assetId,
      source: MetadataSource.BOX,
    })

    const avmPagination = await readerFull.arc89GetMetadataPagination({
      assetId: mutableMaxedMetadata.assetId,
      source: MetadataSource.AVM,
    })

    expect(boxPagination.metadataSize).toBe(avmPagination.metadataSize)
    expect(boxPagination.pageSize).toBe(avmPagination.pageSize)
    expect(boxPagination.totalPages).toBe(avmPagination.totalPages)
  })
})

// ================================================================
// JSON Key Extraction
// ================================================================

describe('reader JSON extraction', () => {
  const expectedDecodedB64Bytes = b64Decode(sampleJsonObj.gh_b64_std)

  test('get string by key box', async () => {
    // Test extracting string value by key via BOX.
    const result = await readerWithAlgod.arc89GetMetadataStringByKey({
      assetId: mutableShortMetadata.assetId,
      key: 'name',
      source: MetadataSource.BOX,
    })

    expect(result).toBe(sampleJsonObj.name)
  })

  test('get uint64 by key box', async () => {
    // Test extracting uint64 value by key via BOX.
    const result = await readerWithAlgod.arc89GetMetadataUint64ByKey({
      assetId: mutableShortMetadata.assetId,
      key: 'answer',
      source: MetadataSource.BOX,
    })

    expect(result).toBe(BigInt(sampleJsonObj.answer))
  })

  test('get object by key box', async () => {
    // Test extracting object value by key via BOX.
    const result = await readerWithAlgod.arc89GetMetadataObjectByKey({
      assetId: mutableShortMetadata.assetId,
      key: 'date',
      source: MetadataSource.BOX,
    })

    // Result should be JSON string
    const obj = JSON.parse(result)
    expect(obj).toHaveProperty('day')
    expect(obj).toHaveProperty('month')
    expect(obj).toHaveProperty('year')
  })

  test('get b64 bytes by key box (url encoding)', async () => {
    // Test extracting base64url-encoded bytes by key via BOX.
    const result = await readerWithAlgod.arc89GetMetadataB64BytesByKey({
      assetId: mutableShortMetadata.assetId,
      key: 'gh_b64_url',
      b64Encoding: B64_URL_ENCODING,
      source: MetadataSource.BOX,
    })

    // Should return decoded bytes
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
    expect(result).toStrictEqual(expectedDecodedB64Bytes)
  })

  test('get b64 bytes by key box (std encoding)', async () => {
    // Test extracting base64 standard-encoded bytes by key via BOX.
    const result = await readerWithAlgod.arc89GetMetadataB64BytesByKey({
      assetId: mutableShortMetadata.assetId,
      key: 'gh_b64_std',
      b64Encoding: B64_STD_ENCODING,
      source: MetadataSource.BOX,
    })

    // Should return decoded bytes
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
    expect(result).toStrictEqual(expectedDecodedB64Bytes)
  })
})

// ================================================================
// ARC-90 URI Resolution
// ================================================================

describe('reader ARC-90 URI', () => {
  test('resolve from asset url', async () => {
    // Test resolving URI from ASA's url field.
    const uri = await readerWithAlgod.resolveArc90Uri({ assetId: arc89Asa })

    expect(uri.assetId).toBe(arc89Asa)
    expect(uri.appId).not.toBeNull()
    expect(uri.appId).toBe(client.appId)
  })

  test('resolve from explicit uri', async () => {
    // Test resolving from explicit metadata URI.
    const boxEncoded = b64UrlEncode(assetIdToBoxName(arc89Asa))
    const uriString = `algorand://net:localnet/app/${client.appId}?box=${boxEncoded}`

    const uri = await readerWithAlgod.resolveArc90Uri({ metadataUri: uriString })

    expect(uri.assetId).toBe(arc89Asa)
    expect(uri.appId).toBe(client.appId)
  })

  test('get partial uri', async () => {
    // Test getting partial URI from registry.
    const uri = await readerWithAvm.arc89GetMetadataPartialUri({ source: MetadataSource.AVM })

    expect(typeof uri).toBe('string')
    expect(uri).toContain('algorand://')
  })
})

// ================================================================
// Edge Cases
// ================================================================

describe('reader edge cases', () => {
  test('empty metadata edge case', async () => {
    // Test handling of empty metadata (edge case).
    const result = await readerFull.getAssetMetadata({
      assetId: mutableEmptyMetadata.assetId,
      source: MetadataSource.AUTO,
    })

    expect(result.body.rawBytes.length).toBe(0)

    // Pagination should work correctly
    const pagination = await readerFull.arc89GetMetadataPagination({
      assetId: mutableEmptyMetadata.assetId,
    })
    expect(pagination.metadataSize).toBe(0)
    expect(pagination.totalPages).toBe(0)
  })

  test('large metadata paging', async () => {
    // Test reading large metadata across multiple pages.
    const result = await readerFull.getAssetMetadata({
      assetId: mutableMaxedMetadata.assetId,
      source: MetadataSource.AVM,
    })

    // Verify all pages were read correctly
    expect(result.body.rawBytes.length).toBe(mutableMaxedMetadata.size)

    // Check pagination
    const pagination = await readerFull.arc89GetMetadataPagination({
      assetId: mutableMaxedMetadata.assetId,
    })
    expect(pagination.totalPages).toBeGreaterThan(1)
  })

  test('immutable flag respected', async () => {
    // Test that immutable flag is correctly read.
    const result = await readerFull.getAssetMetadata({
      assetId: immutableShortMetadata.assetId,
    })

    expect(result.header.isImmutable).toBe(true)

    // Verify via is_metadata_immutable getter
    const isImmutable = await readerFull.arc89IsMetadataImmutable({
      assetId: immutableShortMetadata.assetId,
    })
    expect(isImmutable).toBe(true)
  })
})
