/**
 * Extensive tests for src/write/writer module.
 *
 * Tests cover:
 * - WriteOptions configuration (mock)
 * - AsaMetadataRegistryWrite initialization and validation (mock when possible)
 * - Group building methods
 * - High-level send methods
 * - Flag management methods (mock when possible)
 * - Utility methods (mock)
 * - Fee pooling and padding
 * - Extra resources handling (mock)
 * - Error handling and edge cases
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { Address, type TransactionSigner } from 'algosdk'
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { algorandFixture, algoKitLogCaptureFixture } from '@algorandfoundation/algokit-utils/testing'
import type { AlgorandClient } from '@algorandfoundation/algokit-utils'
import {
  InvalidFlagIndexError,
  MissingAppClientError,
  getDefaultRegistryParams,
  RegistryParameters,
  flags,
  AssetMetadata,
  MbrDelta,
  // writer
  AsaMetadataRegistryWrite,
  WriteOptions,
  writeOptionsDefault,
  AsaMetadataRegistryRead,
  AlgodBoxReader,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import type { SimulateOptions } from '@/read/avm'
import { AsaMetadataRegistryClient, AsaMetadataRegistryComposer, AsaMetadataRegistryFactory } from '@/generated'
import { chunksForSlice, appendExtraResources } from '@/internal/writer'
import {
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

const createMockAppClient = (): AsaMetadataRegistryClient => {
  return {
    appClient: { appId: 12345n },
    appId: 12345n,
    appAddress: 'IEEMEG2UHU5HZZ4AWTKJ4ZQCBX3LBZQBE7YYGLPOT5G4HHCXNPFP47DKCM',
    clone: vi.fn(),
    newGroup: vi.fn(),
    algorand: {
      getSuggestedParams: vi.fn(),
      createTransaction: { payment: vi.fn() },
    },
  } as unknown as AsaMetadataRegistryClient
}

const createMockSigningAccount = (): TransactionSignerAccount => ({
  addr: Address.fromString('IIOWCOZ6GR5KX23BOV5EAPJ7SI3LVN6BBNEIUGFUYX4X2W65H5UXCMIZKU'),
  signer: vi.fn() as unknown as TransactionSigner,
})

// ================================================================
// AsaMetadataRegistryWrite (a.k.a. writer) Tests
// ================================================================

// mock
let mockClient: AsaMetadataRegistryClient

// on-chain
const fixture = algorandFixture()
let algorand: AlgorandClient
let client: AsaMetadataRegistryClient
let factory: AsaMetadataRegistryFactory
let deployer: TransactionSignerAccount

beforeEach(async () => {
  vi.resetAllMocks()
  mockClient = createMockAppClient()
  await fixture.newScope()
  algorand = fixture.algorand
  deployer = getDeployer(fixture)
  factory = createFactory({ algorand, deployer })
  client = await deployRegistry({ factory, deployer })
})

// ================================================================
// WriteOptions Tests
// ================================================================

describe('write options', () => {
  // Test WriteOptions interface and its expected defaults.
  test('default options', () => {
    // Test default WriteOptions values.
    expect(writeOptionsDefault.extraResources).toBe(0)
    expect(writeOptionsDefault.feePaddingTxns).toBe(0)
    expect(writeOptionsDefault.coverAppCallInnerTransactionFees).toBe(true)
  })

  test('custom options', () => {
    // Test custom WriteOptions configuration.
    const opts: WriteOptions = {
      extraResources: 5,
      feePaddingTxns: 2,
      coverAppCallInnerTransactionFees: false,
    }
    expect(opts.extraResources).toBe(5)
    expect(opts.feePaddingTxns).toBe(2)
    expect(opts.coverAppCallInnerTransactionFees).toBe(false)
  })
})

// ================================================================
// Private Helper Functions Tests
// ================================================================

describe('chunking helpers', () => {
  // Tests for module-level internal chunksForSlice function.
  test('chunks for slice single', () => {
    // Test slicing a small payload into single chunk.
    const payload = new TextEncoder().encode('slice')
    const chunks = chunksForSlice(payload, 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual(payload)
  })

  test('chunks for slice multiple', () => {
    // Tests slicing a large payload into multiple chunks.
    const payload = new Uint8Array(250).fill(0x78) // b"x" * 250
    const chunks = chunksForSlice(payload, 100)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(100)
    expect(chunks[1]).toHaveLength(100)
    expect(chunks[2]).toHaveLength(50)
    // Concatenated chunks must equal original payload
    const reassembled = new Uint8Array([...chunks[0], ...chunks[1], ...chunks[2]])
    expect(reassembled).toEqual(payload)
  })

  test('chunks for slice empty', () => {
    // Test slicing empty payload.
    const chunks = chunksForSlice(new Uint8Array(), 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual(new Uint8Array())
  })

  test('chunks for slice invalid max size', () => {
    // Test slicing with invalid max size.
    const payload = new TextEncoder().encode('test')
    expect(() => chunksForSlice(payload, 0)).toThrow(RangeError)
    expect(() => chunksForSlice(payload, -1)).toThrow(RangeError)
  })
})

describe('composer helpers', () => {
  // Tests composer helper functions (mocked).
  test('append extra resources zero', () => {
    // Test that no extra resources are appended when count is 0.
    const composer = { extraResources: vi.fn() } as unknown as AsaMetadataRegistryComposer<unknown[]>
    const account = createMockSigningAccount()
    appendExtraResources(composer, { count: 0, sender: account.addr, signer: account.signer })
    expect(composer.extraResources).not.toHaveBeenCalled()
  })

  test('append extra resources negative', () => {
    // Test that negative count doesn't append extra resources.
    const composer = { extraResources: vi.fn() } as unknown as AsaMetadataRegistryComposer<unknown[]>
    const account = createMockSigningAccount()
    appendExtraResources(composer, { count: -5, sender: account.addr, signer: account.signer })
    expect(composer.extraResources).not.toHaveBeenCalled()
  })

  test('append extra resources multiple', () => {
    // Test appending multiple extra resource calls.
    const composer = { extraResources: vi.fn() } as unknown as AsaMetadataRegistryComposer<unknown[]>
    const account = createMockSigningAccount()
    appendExtraResources(composer, { count: 3, sender: account.addr, signer: account.signer })
    expect(composer.extraResources).toHaveBeenCalledTimes(3)
  })
})

// ================================================================
// AsaMetadataRegistryWrite Initialization Tests
// ================================================================

describe('writer initialization', () => {
  // Test AsaMetadataRegistryWrite constructor.
  test('init with client', () => {
    // Test successful initialization with client.
    const writer = new AsaMetadataRegistryWrite({ client: mockClient })
    expect(writer.client).toBe(mockClient)
    expect(writer.params).toBeNull()
  })

  test('init with client and params', () => {
    // Test initialization with both client and params.
    const params = getDefaultRegistryParams()
    const writer = new AsaMetadataRegistryWrite({ client: mockClient, params })
    expect(writer.client).toBe(mockClient)
    expect(writer.params).toBe(params)
  })

  test('init with null client raises error', () => {
    // Test that initializing with null client raises MissingAppClientError.
    expect(() => new AsaMetadataRegistryWrite({ client: null as unknown as AsaMetadataRegistryClient })).toThrow(
      MissingAppClientError,
    )
  })

  test('_params returns cached params', async () => {
    // Test that _params() returns cached params if available.
    const params = getDefaultRegistryParams()
    const writer = new AsaMetadataRegistryWrite({ client: mockClient, params })
    const result = await (writer as any)._params()
    expect(result).toBe(params)
  })

  test('_params fetches from on-chain if not cached', async () => {
    // Test that _params() fetches from on-chain if not cached.
    const writer = new AsaMetadataRegistryWrite({ client })
    const result = await (writer as any)._params()
    expect(result).toBeInstanceOf(RegistryParameters)
    expect(result.headerSize).toBeGreaterThan(0)
  })
})

// ================================================================
// Group Builder Tests
// ================================================================

describe('build group methods', () => {
  // Test group building methods.
  let assetManager: TransactionSignerAccount
  let assetId: bigint
  let writer: AsaMetadataRegistryWrite

  beforeEach(async () => {
    assetManager = await createFundedAccount(fixture)
    assetId = await createArc89Asa({ assetManager, appClient: client })
    writer = new AsaMetadataRegistryWrite({ client })
  })

  test('build create metadata group', async () => {
    // Test building create group for metadata.
    const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Test' } })
    const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata })
    expect(composer).not.toBeNull()
  })

  test('build delete metadata group', async () => {
    // Test building delete group.
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })
    const composer = await writer.buildDeleteMetadataGroup({ assetManager, assetId: metadata.assetId })
    expect(composer).not.toBeNull()
  })

  test('build delete with options', async () => {
    // Test building delete group with custom options.
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })
    const options: WriteOptions = { extraResources: 1, feePaddingTxns: 2, coverAppCallInnerTransactionFees: false }
    const composer = await writer.buildDeleteMetadataGroup({ assetManager, assetId: metadata.assetId, options })
    expect(composer).not.toBeNull()
  })
})

// ================================================================
// High-Level Send Method Tests
// ================================================================

describe('create metadata', () => {
  // Test createMetadata high-level method.
  let assetManager: TransactionSignerAccount
  let assetId: bigint
  let writer: AsaMetadataRegistryWrite
  let boxReader: AlgodBoxReader
  let reader: AsaMetadataRegistryRead

  beforeEach(async () => {
    assetManager = await createFundedAccount(fixture)
    assetId = await createArc89Asa({ assetManager, appClient: client })
    writer = new AsaMetadataRegistryWrite({ client })
    boxReader = new AlgodBoxReader(algorand.client.algod)
    reader = new AsaMetadataRegistryRead({ appId: client.appId, algod: boxReader })
  })

  test('create metadata returns mbr delta', async () => {
    // Test creating metadata returns MbrDelta.
    const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Test', description: 'Test metadata' } })
    const mbrDelta = await writer.createMetadata({ assetManager, metadata })
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
    expect(mbrDelta.isPositive).toBe(true)
  })

  test('create with simulate before send', async () => {
    // Test creating metadata with simulateBeforeSend=true.
    const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Test Simulate' } })
    const mbrDelta = await writer.createMetadata({ assetManager, metadata, simulateBeforeSend: true })
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
  })

  test('create empty metadata returns mbr delta', async () => {
    // Test creating empty metadata returns MbrDelta.
    const metadata = buildEmptyMetadata(assetId)
    const mbrDelta = await writer.createMetadata({ assetManager, metadata })
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
    expect(mbrDelta.isPositive).toBe(true)
  })

  test('create short metadata', async () => {
    // Test creating short metadata.
    const metadata = buildShortMetadata(assetId)
    const mbrDelta = await writer.createMetadata({ assetManager, metadata })
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
    expect(mbrDelta.isPositive).toBe(true)
    const boxValue = await reader.box.getAssetMetadataRecord({ assetId })
    expect(boxValue).not.toBeNull()
  })

  test('create large metadata', async () => {
    // Test creating large metadata.
    const metadata = buildMaxedMetadata(assetId)
    const mbrDelta = await writer.createMetadata({ assetManager, metadata })
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
    expect(mbrDelta.isPositive).toBe(true)
    const boxValue = await reader.box.getAssetMetadataRecord({ assetId })
    expect(boxValue).not.toBeNull()
  })

  test('create with custom simulate options', async () => {
    // Test creating metadata with custom SimulateOptions.
    const metadata = buildShortMetadata(assetId)
    const simulateOptions: SimulateOptions = {
      allowEmptySignatures: true,
      skipSignatures: true,
      allowMoreLogging: true,
    }
    const mbrDelta = await writer.createMetadata({ assetManager, metadata, simulateBeforeSend: true, simulateOptions })
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
    const boxValue = await reader.box.getAssetMetadataRecord({ assetId })
    expect(boxValue).not.toBeNull()
  })

  test('create with custom send params', async () => {
    // Test creating metadata with custom SendParams.
    const metadata = buildShortMetadata(assetId)
    const mbrDelta = await writer.createMetadata({
      assetManager,
      metadata,
      sendParams: { coverAppCallInnerTransactionFees: false },
    })
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
    const boxValue = await reader.box.getAssetMetadataRecord({ assetId })
    expect(boxValue).not.toBeNull()
  })
})

describe('delete metadata', () => {
  // Test deleteMetadata high-level method.
  test.todo('delete existing metadata')
})

describe('set reversible flag', () => {
  // Test setReversibleFlag method.

  // Flag index validation (unit-testable, throws before chain interaction).
  test('rejects negative flag index', async () => {
    const writer = new AsaMetadataRegistryWrite({ client: mockClient })
    const account = createMockSigningAccount()

    await expect(
      writer.setReversibleFlag({ assetManager: account, assetId: 123, flagIndex: -1, value: true }),
    ).rejects.toThrow(InvalidFlagIndexError)
  })

  test('rejects flag index > 7', async () => {
    const writer = new AsaMetadataRegistryWrite({ client: mockClient })
    const account = createMockSigningAccount()

    await expect(
      writer.setReversibleFlag({ assetManager: account, assetId: 123, flagIndex: 8, value: true }),
    ).rejects.toThrow(InvalidFlagIndexError)
  })

  // On-chain tests.
  test.todo('set reversible flag true')
  test.todo('set reversible flag false')
})

describe('set irreversible flag', () => {
  // Test setIrreversibleFlag method.

  // Flag index validation (unit-testable, throws before chain interaction).
  test('rejects creation-only indices (0, 1)', async () => {
    // Flags 0 (ARC3) and 1 (ARC89_NATIVE) are creation-only.
    const writer = new AsaMetadataRegistryWrite({ client: mockClient })
    const account = createMockSigningAccount()

    await expect(
      writer.setIrreversibleFlag({
        assetManager: account,
        assetId: 123,
        flagIndex: flags.IRR_FLG_ARC3,
      }),
    ).rejects.toThrow(InvalidFlagIndexError)

    await expect(
      writer.setIrreversibleFlag({
        assetManager: account,
        assetId: 123,
        flagIndex: flags.IRR_FLG_ARC89_NATIVE,
      }),
    ).rejects.toThrow(InvalidFlagIndexError)
  })

  test('rejects flag index > 7', async () => {
    const writer = new AsaMetadataRegistryWrite({ client: mockClient })
    const account = createMockSigningAccount()

    await expect(writer.setIrreversibleFlag({ assetManager: account, assetId: 123, flagIndex: 8 })).rejects.toThrow(
      InvalidFlagIndexError,
    )
  })

  // On-chain tests.
  test.todo('set irreversible flag')
})

describe('set immutable', () => {
  // Test setImmutable method.
  test.todo('set immutable')
})

// ================================================================
// Edge Cases and Error Handling
// ================================================================

describe('edge cases', () => {
  // Test edge cases and error handling.
  test.todo('create with large fee padding')
  test.todo('create with extra resources')
})

// ================================================================
// Integration-Style Tests
// ================================================================

describe('integration workflows', () => {
  // Integration-style tests for complete workflows.
  test.todo('create then delete workflow')
  test.todo('create set flags workflow')
})

// ================================================================
// Group Builder Tests (Detailed)
// ================================================================

describe('build create metadata group', () => {
  // Test buildCreateMetadataGroup method.
  test.todo('build create empty metadata')
  test.todo('build create short metadata')
  test.todo('build create with custom options')
  test.todo('build create large metadata')
})

describe('build replace metadata group', () => {
  // Test buildReplaceMetadataGroup method.
  test.todo('build replace smaller metadata')
  test.todo('build replace larger metadata')
  test.todo('build replace auto detect size')
  test.todo('build replace with options')
})

describe('build replace metadata slice group', () => {
  // Test buildReplaceMetadataSliceGroup method.
  test.todo('build slice small payload')
  test.todo('build slice large payload')
  test.todo('build slice with options')
})

describe('build delete metadata group', () => {
  // Test buildDeleteMetadataGroup method.
  test.todo('build delete')
  test.todo('build delete with options')
})

// ================================================================
// High-Level Send Method Tests (Replace)
// ================================================================

describe('replace metadata', () => {
  // Test replaceMetadata high-level method.
  test.todo('replace with smaller metadata')
  test.todo('replace with larger metadata')
  test.todo('replace auto detect current size')
  test.todo('replace with simulate')
})

describe('replace metadata slice', () => {
  // Test replaceMetadataSlice high-level method.
  test.todo('replace slice')
  test.todo('replace slice with simulate')
})
